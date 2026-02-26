<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\AddModRequest;
use App\Http\Requests\Api\ReorderModsRequest;
use App\Services\AuditLogger;
use App\Services\ModManager;
use Illuminate\Http\JsonResponse;

class ModController
{
    public function __construct(
        private readonly ModManager $modManager,
        private readonly AuditLogger $auditLogger,
    ) {}

    public function index(): JsonResponse
    {
        $path = config('zomboid.paths.server_ini');

        if (! is_file($path)) {
            return response()->json([
                'error' => 'Server config not found',
            ], 404);
        }

        return response()->json([
            'mods' => $this->modManager->list($path),
        ]);
    }

    public function store(AddModRequest $request): JsonResponse
    {
        $path = config('zomboid.paths.server_ini');

        if (! is_file($path)) {
            return response()->json([
                'error' => 'Server config not found',
            ], 404);
        }

        $workshopId = $request->validated('workshop_id');
        $modId = $request->validated('mod_id');
        $mapFolder = $request->validated('map_folder');

        $this->modManager->add($path, $workshopId, $modId, $mapFolder);

        $this->auditLogger->log(
            actor: 'api-key',
            action: 'mod.add',
            target: $workshopId,
            details: [
                'workshop_id' => $workshopId,
                'mod_id' => $modId,
                'map_folder' => $mapFolder,
            ],
            ip: $request->ip(),
        );

        return response()->json([
            'added' => ['workshop_id' => $workshopId, 'mod_id' => $modId],
            'restart_required' => true,
        ]);
    }

    public function destroy(string $workshopId): JsonResponse
    {
        $path = config('zomboid.paths.server_ini');

        if (! is_file($path)) {
            return response()->json([
                'error' => 'Server config not found',
            ], 404);
        }

        $removed = $this->modManager->remove($path, $workshopId);

        if ($removed === null) {
            return response()->json([
                'error' => 'Mod not found',
            ], 404);
        }

        $this->auditLogger->log(
            actor: 'api-key',
            action: 'mod.remove',
            target: $workshopId,
            details: $removed,
            ip: request()->ip(),
        );

        return response()->json([
            'removed' => $removed,
            'restart_required' => true,
        ]);
    }

    public function reorder(ReorderModsRequest $request): JsonResponse
    {
        $path = config('zomboid.paths.server_ini');

        if (! is_file($path)) {
            return response()->json([
                'error' => 'Server config not found',
            ], 404);
        }

        $mods = $request->validated('mods');

        $this->modManager->reorder($path, $mods);

        $this->auditLogger->log(
            actor: 'api-key',
            action: 'mod.reorder',
            target: null,
            details: ['mods' => $mods],
            ip: $request->ip(),
        );

        return response()->json([
            'mods' => $this->modManager->list($path),
            'restart_required' => true,
        ]);
    }
}
