<?php

namespace App\Jobs;

use App\Models\Backup;
use App\Services\AuditLogger;
use App\Services\BackupManager;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

class RollbackGameServer implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public function __construct(
        private readonly string $backupId,
        private readonly string $ip,
    ) {}

    public function handle(BackupManager $backupManager): void
    {
        $backup = Backup::findOrFail($this->backupId);

        $result = $backupManager->rollback($backup);

        AuditLogger::record(
            actor: 'system',
            action: 'backup.rollback.executed',
            target: $backup->filename,
            details: [
                'source' => 'scheduled_job',
                'pre_rollback_backup' => $result['pre_rollback_backup']->filename,
            ],
            ip: $this->ip,
        );
    }
}
