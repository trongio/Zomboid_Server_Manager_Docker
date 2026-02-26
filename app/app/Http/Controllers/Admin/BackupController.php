<?php

namespace App\Http\Controllers\Admin;

use App\Enums\BackupType;
use App\Http\Controllers\Controller;
use App\Http\Resources\BackupResource;
use App\Models\Backup;
use App\Services\AuditLogger;
use App\Services\BackupManager;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class BackupController extends Controller
{
    public function __construct(
        private readonly BackupManager $backupManager,
        private readonly AuditLogger $auditLogger,
    ) {}

    public function index(Request $request): Response
    {
        $query = Backup::query()->orderByDesc('created_at');

        if ($type = $request->query('type')) {
            $query->where('type', $type);
        }

        $backups = $query->paginate(15);

        return Inertia::render('admin/backups', [
            'backups' => BackupResource::collection($backups),
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'notes' => 'nullable|string|max:500',
        ]);

        $result = $this->backupManager->createBackup(
            BackupType::Manual,
            $request->input('notes'),
        );

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'backup.create',
            target: $result['backup']->filename,
            details: [
                'type' => BackupType::Manual->value,
                'size_bytes' => $result['backup']->size_bytes,
            ],
            ip: $request->ip(),
        );

        return response()->json([
            'backup' => new BackupResource($result['backup']),
            'cleanup_count' => $result['cleanup_count'],
        ], 201);
    }

    public function destroy(Request $request, Backup $backup): JsonResponse
    {
        $filename = $backup->filename;
        $this->backupManager->deleteBackup($backup);

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'backup.delete',
            target: $filename,
            ip: $request->ip(),
        );

        return response()->json(['message' => "Deleted {$filename}"]);
    }

    public function rollback(Request $request, Backup $backup): JsonResponse
    {
        $request->validate([
            'confirm' => 'required|boolean|accepted',
        ]);

        $result = $this->backupManager->rollback($backup);

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'backup.rollback',
            target: $backup->filename,
            details: [
                'pre_rollback_backup' => $result['pre_rollback_backup']->filename,
            ],
            ip: $request->ip(),
        );

        return response()->json([
            'message' => 'Rollback completed',
            'restored_from' => new BackupResource($backup),
            'pre_rollback_backup' => new BackupResource($result['pre_rollback_backup']),
        ]);
    }
}
