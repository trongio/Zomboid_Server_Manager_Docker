<?php

namespace App\Jobs;

use App\Services\AuditLogger;
use App\Services\BackupManager;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

class ImportWorldSave implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 600;

    public function __construct(
        private readonly string $zipPath,
        private readonly string $actor,
        private readonly string $ip,
    ) {}

    public function handle(BackupManager $backupManager): void
    {
        $result = $backupManager->importWorld($this->zipPath);

        AuditLogger::record(
            actor: $this->actor,
            action: 'world.import.executed',
            details: [
                'pre_import_backup' => $result['pre_import_backup']->filename,
                'layout' => $result['metadata']['layout'],
                'entry_count' => $result['metadata']['entry_count'],
                'detected_server_name' => $result['metadata']['detected_server_name'],
            ],
            ip: $this->ip,
        );

        // Clean up uploaded zip
        if (file_exists($this->zipPath)) {
            @unlink($this->zipPath);
        }

        WaitForServerReady::dispatch(
            'world.import.completed',
            $this->actor,
            $this->ip,
        );
    }

    public function failed(?\Throwable $exception): void
    {
        Log::error('World import job failed', [
            'zip' => $this->zipPath,
            'error' => $exception?->getMessage(),
        ]);

        AuditLogger::record(
            actor: $this->actor,
            action: 'world.import.failed',
            details: ['error' => $exception?->getMessage()],
            ip: $this->ip,
        );

        // Clean up uploaded zip on failure
        if (file_exists($this->zipPath)) {
            @unlink($this->zipPath);
        }
    }
}
