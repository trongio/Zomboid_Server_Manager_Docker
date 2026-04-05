<?php

namespace App\Http\Controllers\Admin;

use App\Enums\BackupType;
use App\Http\Controllers\Concerns\SortsQuery;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\ImportWorldRequest;
use App\Http\Resources\BackupResource;
use App\Jobs\CreateBackupJob;
use App\Jobs\ImportWorldSave;
use App\Jobs\RollbackGameServer;
use App\Jobs\SendServerWarning;
use App\Models\Backup;
use App\Rules\RconSafeMessage;
use App\Services\AuditLogger;
use App\Services\BackupManager;
use App\Services\GameVersionReader;
use App\Services\RconClient;
use App\Services\RconSanitizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class BackupController extends Controller
{
    use SortsQuery;

    public function __construct(
        private readonly BackupManager $backupManager,
        private readonly AuditLogger $auditLogger,
        private readonly RconClient $rcon,
        private readonly GameVersionReader $versionReader,
    ) {}

    public function index(Request $request): Response
    {
        $query = Backup::query();

        if ($type = $request->query('type')) {
            $query->where('type', $type);
        }

        $sortParams = $this->applySort($query, $request, ['filename', 'type', 'size_bytes', 'created_at']);

        $perPage = min((int) $request->query('per_page', 15), 50);
        $backups = $query->paginate($perPage)->withQueryString()
            ->through(fn ($backup) => (new BackupResource($backup))->resolve());

        return Inertia::render('admin/backups', [
            'backups' => Inertia::defer(fn () => $backups),
            'current_version' => $this->versionReader->getCachedVersion(),
            'current_branch' => $this->versionReader->getCurrentBranch(),
            'filters' => $sortParams,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $request->validate([
            'notes' => 'nullable|string|max:500',
            'notify_players' => 'sometimes|boolean',
            'message' => ['sometimes', 'nullable', 'string', 'max:500', new RconSafeMessage],
        ]);

        if ($request->boolean('notify_players')) {
            $message = RconSanitizer::message($request->input('message', 'Backup in progress — expect a brief lag'));
            try {
                $this->rcon->connect();
                $this->rcon->command("servermsg \"{$message}\"");
            } catch (\Throwable) {
                // RCON unavailable — proceed with backup
            }
        }

        CreateBackupJob::dispatch(
            BackupType::Manual,
            $request->input('notes'),
            $request->user()->name ?? 'admin',
            $request->ip(),
        );

        return response()->json([
            'message' => 'Backup started — it will appear in the list shortly',
        ], 202);
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

    public function destroyBulk(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'ids' => 'required|array|min:1',
            'ids.*' => 'required|uuid|exists:backups,id',
        ]);

        $backups = Backup::query()->whereIn('id', $validated['ids'])->get();
        $count = $backups->count();

        foreach ($backups as $backup) {
            $this->backupManager->deleteBackup($backup);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'backup.delete.bulk',
            target: "{$count} backups",
            details: ['ids' => $validated['ids']],
            ip: $request->ip(),
        );

        return response()->json(['message' => "Deleted {$count} backup(s)"]);
    }

    public function rollback(Request $request, Backup $backup): JsonResponse
    {
        $validated = $request->validate([
            'confirm' => 'required|boolean|accepted',
            'countdown' => 'sometimes|integer|min:10|max:3600',
            'message' => ['sometimes', 'nullable', 'string', 'max:500', new RconSafeMessage],
            'switch_branch' => 'sometimes|nullable|string|in:public,unstable,iwillbackupmysave',
        ]);

        // Validate backup file exists before dispatching job
        $this->backupManager->validateBackupFile($backup);

        $countdown = $validated['countdown'] ?? null;

        if ($countdown) {
            $warningMessage = RconSanitizer::message(
                ($validated['message'] ?? null)
                ?? "Server rolling back in {$countdown} seconds — you will be disconnected"
            );

            try {
                $this->rcon->connect();
                $this->rcon->command("servermsg \"{$warningMessage}\"");
            } catch (\Throwable) {
                // RCON unavailable — still schedule the rollback
            }

            SendServerWarning::dispatchCountdownWarnings($countdown, 'rolling back', 'server.pending_action:rollback');

            $this->auditLogger->log(
                actor: $request->user()->name ?? 'admin',
                action: 'backup.rollback.scheduled',
                target: $backup->filename,
                details: ['countdown' => $countdown],
                ip: $request->ip(),
            );
        } else {
            $this->auditLogger->log(
                actor: $request->user()->name ?? 'admin',
                action: 'backup.rollback.initiated',
                target: $backup->filename,
                ip: $request->ip(),
            );
        }

        $switchBranch = $validated['switch_branch'] ?? null;

        // Always dispatch via queue — queue worker runs as root,
        // which is required to overwrite game server files.
        RollbackGameServer::dispatch($backup->id, $request->ip(), $switchBranch)
            ->delay($countdown ? now()->addSeconds($countdown) : null);

        return response()->json([
            'message' => $countdown
                ? "Rollback scheduled in {$countdown} seconds"
                : 'Rollback initiated — server will restart shortly',
        ]);
    }

    public function importWorld(ImportWorldRequest $request): JsonResponse
    {
        $file = $request->file('file');

        $backupDir = config('zomboid.backups.path');
        $importsDir = rtrim($backupDir, '/').'/imports';

        if (! is_dir($importsDir)) {
            mkdir($importsDir, 0755, true);
        }

        $filename = 'import_'.now()->format('Y-m-d_H-i-s').'.zip';
        $storedPath = $file->move($importsDir, $filename)->getPathname();

        try {
            $metadata = $this->backupManager->validateImportZip($storedPath);
        } catch (\Throwable $e) {
            @unlink($storedPath);

            return response()->json(['error' => $e->getMessage()], 422);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'world.import.initiated',
            target: $file->getClientOriginalName(),
            details: [
                'layout' => $metadata['layout'],
                'entry_count' => $metadata['entry_count'],
                'detected_server_name' => $metadata['detected_server_name'],
            ],
            ip: $request->ip(),
        );

        ImportWorldSave::dispatch(
            $storedPath,
            $request->user()->name ?? 'admin',
            $request->ip(),
        );

        return response()->json([
            'message' => 'World import started — server will restart shortly',
            'layout' => $metadata['layout'],
        ], 202);
    }
}
