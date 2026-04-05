<?php

namespace App\Services;

use App\Enums\BackupType;
use App\Models\Backup;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Process;

class BackupManager
{
    public function __construct(
        private readonly RconClient $rcon,
        private readonly DockerManager $docker,
        private readonly GameVersionReader $versionReader,
    ) {}

    /**
     * Create a backup of PZ save data + config files.
     *
     * @return array{backup: Backup, cleanup_count: int}
     */
    public function createBackup(BackupType $type, ?string $notes = null): array
    {
        $this->triggerServerSave();

        $backupDir = config('zomboid.backups.path');
        $this->ensureDirectoryExists($backupDir);

        $timestamp = now()->format('Y-m-d_H-i-s');
        $filename = "backup_{$type->value}_{$timestamp}.tar.gz";
        $fullPath = rtrim($backupDir, '/').'/'.$filename;

        $this->createTarGz($fullPath);

        $sizeBytes = file_exists($fullPath) ? filesize($fullPath) : 0;

        $backup = Backup::create([
            'filename' => $filename,
            'path' => $fullPath,
            'size_bytes' => $sizeBytes,
            'type' => $type,
            'game_version' => $this->versionReader->getCachedVersion(),
            'steam_branch' => $this->versionReader->getCurrentBranch(),
            'notes' => $notes,
        ]);

        $cleanupCount = $this->cleanupRetention($type);

        return [
            'backup' => $backup,
            'cleanup_count' => $cleanupCount,
        ];
    }

    /**
     * Delete a backup file and its database record.
     */
    public function deleteBackup(Backup $backup): bool
    {
        if (file_exists($backup->path)) {
            @unlink($backup->path);
        }

        return $backup->delete();
    }

    /**
     * Enforce retention policy for a backup type.
     */
    public function cleanupRetention(BackupType $type): int
    {
        $keep = config("zomboid.backups.retention.{$type->value}", 10);

        $backups = Backup::where('type', $type->value)
            ->orderByDesc('created_at')
            ->get();

        if ($backups->count() <= $keep) {
            return 0;
        }

        $toDelete = $backups->slice($keep);
        $deleted = 0;

        foreach ($toDelete as $backup) {
            if (file_exists($backup->path)) {
                @unlink($backup->path);
            }
            $backup->delete();
            $deleted++;
        }

        return $deleted;
    }

    /**
     * Rollback to a backup: create pre-rollback safety backup, stop server, extract, start server.
     *
     * @return array{pre_rollback_backup: Backup, restored_from: Backup}
     */
    public function rollback(Backup $backup): array
    {
        $this->validateBackupFile($backup);

        // 1. Create pre-rollback safety backup
        $preRollback = $this->createBackup(BackupType::PreRollback, "Pre-rollback safety backup before restoring {$backup->filename}");

        // 2. Stop the game server and wait for file handles to be released
        $this->stopServer();
        sleep(3);

        // 3. Extract backup over save directory
        $this->extractBackup($backup);

        // 4. Start the game server
        $this->docker->startContainer();

        return [
            'pre_rollback_backup' => $preRollback['backup'],
            'restored_from' => $backup,
        ];
    }

    /**
     * Validate that a backup file exists and is a valid tar.gz.
     */
    public function validateBackupFile(Backup $backup): void
    {
        if (! file_exists($backup->path)) {
            throw new \RuntimeException("Backup file not found: {$backup->path}");
        }

        $result = Process::timeout(120)->run(['tar', '-tzf', $backup->path]);

        if (! $result->successful()) {
            throw new \RuntimeException("Backup file is corrupted or not a valid tar.gz: {$backup->filename}");
        }
    }

    /**
     * Extract a backup archive over the PZ data directory.
     *
     * Uses --touch and --no-same-owner to avoid utime/chmod failures
     * when www-data extracts over root-owned directories.
     * Exit code 1 with only "Cannot utime/change mode" warnings is non-fatal.
     */
    private function extractBackup(Backup $backup): void
    {
        $dataPath = config('zomboid.paths.data');

        // Validate archive contents to prevent tar slip (path traversal)
        $listResult = Process::timeout(30)->run(['tar', '-tzf', $backup->path]);
        if (! $listResult->successful()) {
            throw new \RuntimeException('Failed to list backup contents for validation: '.$listResult->errorOutput());
        }

        $entries = array_filter(explode("\n", trim($listResult->output())));
        foreach ($entries as $entry) {
            if (preg_match('#(^|/)\.\.(/|$)#', $entry) || str_starts_with($entry, '/')) {
                throw new \RuntimeException("Backup contains unsafe path: {$entry}");
            }
        }

        $result = Process::timeout(300)->run([
            'tar', '-xzf', $backup->path,
            '--overwrite',
            '--no-same-owner',
            '--no-same-permissions',
            '--no-absolute-names',
            '--touch',
            '-C', $dataPath,
        ]);

        if (! $result->successful()) {
            $stderr = $result->errorOutput();

            // Tar exits non-zero for harmless metadata warnings (utime, chmod)
            // on directories owned by root. Only fail on real extraction errors.
            $lines = array_filter(explode("\n", trim($stderr)));
            $fatalLines = array_filter($lines, function (string $line): bool {
                return $line !== ''
                    && ! str_contains($line, 'Cannot utime')
                    && ! str_contains($line, 'Cannot change mode')
                    && ! str_contains($line, 'Exiting with failure status due to previous errors');
            });

            if ($fatalLines !== []) {
                throw new \RuntimeException("Failed to extract backup: {$stderr}");
            }

            Log::warning('Backup extraction had non-fatal warnings', [
                'backup' => $backup->filename,
                'warnings' => $stderr,
            ]);
        }
    }

    /**
     * Stop the game server gracefully via RCON then Docker.
     */
    private function stopServer(): void
    {
        try {
            $this->rcon->connect();
            $this->rcon->command('save');
            sleep(3);
            $this->rcon->command('quit');
            sleep(2);
        } catch (\Throwable) {
            // Server may already be offline
        }

        $this->docker->stopContainer(timeout: 30);
    }

    /**
     * Trigger RCON save before backup. Non-fatal if server is offline.
     */
    private function triggerServerSave(): void
    {
        try {
            $this->rcon->connect();
            $this->rcon->command('save');
            sleep(3);
        } catch (\Throwable $e) {
            Log::info('RCON save skipped during backup — server may be offline', [
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Create a tar.gz archive of PZ data directory contents.
     */
    private function createTarGz(string $outputPath): void
    {
        $dataPath = config('zomboid.paths.data');

        if (! is_dir($dataPath)) {
            throw new \RuntimeException("PZ data directory not found: {$dataPath}");
        }

        $result = Process::timeout(300)->run([
            'tar', '-czf', $outputPath,
            '-C', $dataPath,
            'Server', 'Saves', 'db',
        ]);

        if (! $result->successful()) {
            // Partial backup is acceptable — some dirs may not exist yet
            Log::warning('Backup tar command had warnings', [
                'output' => $result->output(),
                'error' => $result->errorOutput(),
                'exit_code' => $result->exitCode(),
            ]);
        }
    }

    /**
     * Validate an uploaded zip file for world import.
     *
     * Detects the zip layout (full backup, save-only, or flat save) and
     * checks for path traversal attacks.
     *
     * @return array{layout: string, detected_server_name: ?string, entry_count: int, has_server_config: bool, has_db: bool}
     */
    public function validateImportZip(string $zipPath): array
    {
        if (! file_exists($zipPath)) {
            throw new \RuntimeException('Import zip file not found.');
        }

        $result = Process::timeout(30)->run(['unzip', '-l', $zipPath]);

        if (! $result->successful()) {
            throw new \RuntimeException('File is not a valid zip archive.');
        }

        // Parse unzip -l output: skip header (3 lines) and footer (2 lines)
        $lines = array_filter(explode("\n", trim($result->output())));
        $entries = [];

        foreach ($lines as $line) {
            // unzip -l format: "  Length  Date  Time  Name" — extract the name (last column)
            if (preg_match('/^\s*\d+\s+\d{2}-\d{2}-\d{2,4}\s+\d{2}:\d{2}\s+(.+)$/', $line, $m)) {
                $entry = trim($m[1]);
                if ($entry !== '') {
                    $entries[] = $entry;
                }
            }
        }

        if ($entries === []) {
            throw new \RuntimeException('Zip archive is empty.');
        }

        // Path traversal check (mirrors tar validation pattern)
        foreach ($entries as $entry) {
            if (preg_match('#(^|/)\.\.(/|$)#', $entry) || str_starts_with($entry, '/')) {
                throw new \RuntimeException("Zip contains unsafe path: {$entry}");
            }
        }

        // Detect layout
        $hasServer = false;
        $hasSaves = false;
        $hasDb = false;
        $detectedServerName = null;

        foreach ($entries as $entry) {
            if (str_starts_with($entry, 'Server/')) {
                $hasServer = true;
            }
            if (str_starts_with($entry, 'Saves/')) {
                $hasSaves = true;
            }
            if (str_starts_with($entry, 'db/')) {
                $hasDb = true;
            }
            // Detect server name from save directory path
            if (preg_match('#^Saves/Multiplayer/([^/]+)/#', $entry, $m)) {
                $detectedServerName = $m[1];
            }
        }

        if ($hasSaves) {
            $layout = $hasServer ? 'full' : 'save_only';
        } elseif ($hasServer || $hasDb) {
            throw new \RuntimeException('Zip contains config/db files but no save data (Saves/ directory). Use config import for server settings.');
        } else {
            // Check for flat save layout (map files, players.db at root)
            $hasSaveFiles = false;
            foreach ($entries as $entry) {
                if (str_starts_with($entry, 'map_') || $entry === 'players.db' || str_starts_with($entry, 'worldZone-')) {
                    $hasSaveFiles = true;
                    break;
                }
            }

            if (! $hasSaveFiles) {
                throw new \RuntimeException('Zip does not contain recognizable PZ save data. Expected Server/, Saves/, or map files.');
            }

            $layout = 'flat_save';
        }

        return [
            'layout' => $layout,
            'detected_server_name' => $detectedServerName,
            'entry_count' => count($entries),
            'has_server_config' => $hasServer,
            'has_db' => $hasDb,
        ];
    }

    /**
     * Import a world save from a zip file.
     *
     * Creates a pre-import safety backup, stops the server, extracts the zip,
     * handles server name mismatches, and starts the server.
     *
     * @return array{pre_import_backup: Backup, metadata: array}
     */
    public function importWorld(string $zipPath): array
    {
        $metadata = $this->validateImportZip($zipPath);
        $dataPath = config('zomboid.paths.data');
        $serverName = config('zomboid.server_name', env('PZ_SERVER_NAME', 'ZomboidServer'));

        // 1. Create pre-import safety backup
        $preImport = $this->createBackup(BackupType::PreImport, 'Pre-import safety backup');

        // 2. Stop the game server
        $this->stopServer();

        try {
            sleep(3);

            // 3. Extract zip based on detected layout
            $this->extractImportZip($zipPath, $metadata, $dataPath, $serverName);
        } finally {
            // 4. Start the game server even if extraction fails
            $this->docker->startContainer();
        }

        return [
            'pre_import_backup' => $preImport['backup'],
            'metadata' => $metadata,
        ];
    }

    /**
     * Extract an import zip to the appropriate location based on layout.
     */
    private function extractImportZip(string $zipPath, array $metadata, string $dataPath, string $serverName): void
    {
        $layout = $metadata['layout'];

        if ($layout === 'full' || $layout === 'save_only') {
            // Extract directly to the PZ data directory
            $result = Process::timeout(300)->run([
                'unzip', '-o', $zipPath, '-d', $dataPath,
            ]);
        } else {
            // Flat save: extract into the save directory
            $saveDir = "{$dataPath}/Saves/Multiplayer/{$serverName}";
            $this->ensureDirectoryExists($saveDir);

            $result = Process::timeout(300)->run([
                'unzip', '-o', $zipPath, '-d', $saveDir,
            ]);
        }

        if (! $result->successful()) {
            $stderr = $result->errorOutput();
            // unzip returns 1 for warnings (e.g., overwrite confirmations) — only fail on code >= 2
            if ($result->exitCode() >= 2) {
                throw new \RuntimeException("Failed to extract import zip: {$stderr}");
            }

            Log::warning('Import zip extraction had warnings', ['warnings' => $stderr]);
        }

        // Handle server name mismatch for save_only layout
        if ($layout === 'save_only' && $metadata['detected_server_name'] !== null && $metadata['detected_server_name'] !== $serverName) {
            $oldPath = "{$dataPath}/Saves/Multiplayer/{$metadata['detected_server_name']}";
            $newPath = "{$dataPath}/Saves/Multiplayer/{$serverName}";

            if (is_dir($oldPath)) {
                // Remove existing target if present (backup was already created)
                if (is_dir($newPath)) {
                    Process::timeout(30)->run(['rm', '-rf', $newPath]);
                }
                rename($oldPath, $newPath);

                Log::info('Import: renamed server save directory', [
                    'from' => $metadata['detected_server_name'],
                    'to' => $serverName,
                ]);
            }
        }
    }

    private function ensureDirectoryExists(string $path): void
    {
        if (! is_dir($path)) {
            mkdir($path, 0755, true);
        }
    }
}
