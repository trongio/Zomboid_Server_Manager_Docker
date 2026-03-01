<?php

namespace App\Jobs;

use App\Enums\BackupType;
use App\Services\AuditLogger;
use App\Services\BackupManager;
use App\Services\DockerManager;
use App\Services\RconClient;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Process;

class WipeGameServer implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 600;

    public function __construct(
        private readonly string $ip,
    ) {}

    public function handle(RconClient $rcon, DockerManager $docker, BackupManager $backupManager): void
    {
        Cache::forget('server.pending_action:wipe');

        // 1. Create pre-wipe backup
        try {
            $result = $backupManager->createBackup(BackupType::PreRollback, 'Pre-wipe safety backup');

            Log::info('Pre-wipe backup created', [
                'filename' => $result['backup']->filename,
            ]);
        } catch (\Throwable $e) {
            Log::warning('Pre-wipe backup failed, proceeding with wipe', [
                'error' => $e->getMessage(),
            ]);
        }

        // 2. Graceful shutdown via RCON, fallback to Docker stop
        try {
            $rcon->connect();
            $rcon->command('save');
            sleep(5);
            $rcon->command('quit');
        } catch (\Throwable $e) {
            Log::warning('RCON unavailable during scheduled wipe, proceeding with Docker stop', [
                'error' => $e->getMessage(),
            ]);
        }

        $docker->stopContainer(timeout: 30);

        AuditLogger::record(
            actor: 'system',
            action: 'server.wipe.executed',
            target: config('zomboid.docker.container_name'),
            details: ['source' => 'scheduled_job'],
            ip: $this->ip,
        );

        // 3. Delete save data + PZ internal backups (PZ auto-restores from these on startup)
        $dataPath = config('zomboid.paths.data');
        $serverName = config('zomboid.server_name', 'ZomboidServer');
        $savePath = "{$dataPath}/Saves/Multiplayer/{$serverName}";
        $startupBackups = "{$dataPath}/backups/startup";
        $serverDb = "{$dataPath}/db/{$serverName}.db";

        if (is_dir($savePath)) {
            $deleteResult = Process::run(['rm', '-rf', $savePath]);

            if ($deleteResult->successful()) {
                Log::info('Save data deleted', ['path' => $savePath]);
            } else {
                Log::error('Failed to delete save data', [
                    'path' => $savePath,
                    'error' => $deleteResult->errorOutput(),
                ]);
            }
        } else {
            Log::info('Save directory does not exist, nothing to delete', ['path' => $savePath]);
        }

        // Remove PZ startup backups — PZ restores saves from these on boot
        if (is_dir($startupBackups)) {
            $backupResult = Process::run(['rm', '-rf', $startupBackups]);
            Log::info('PZ startup backups deleted', ['success' => $backupResult->successful()]);
        }

        // Remove player account database so accounts are reset
        if (file_exists($serverDb)) {
            Process::run(['rm', '-f', $serverDb]);
            Process::run(['rm', '-f', "{$serverDb}-shm", "{$serverDb}-wal"]);
            Log::info('Server player database deleted', ['path' => $serverDb]);
        }

        // 4. Start server
        $docker->startContainer();

        // 5. Wait for server ready
        WaitForServerReady::dispatch(
            'server.wipe.completed',
            'system',
            $this->ip,
        );
    }
}
