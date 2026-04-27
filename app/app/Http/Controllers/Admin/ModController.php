<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\AuditLogger;
use App\Services\ModManager;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Inertia\Inertia;
use Inertia\Response;
use RuntimeException;

class ModController extends Controller
{
    public function __construct(
        private readonly ModManager $modManager,
        private readonly AuditLogger $auditLogger,
    ) {}

    public function index(): Response
    {
        $mods = [];

        try {
            $mods = $this->modManager->list(config('zomboid.paths.server_ini'));
        } catch (\Throwable) {
            // Config not available
        }

        return Inertia::render('admin/mods', [
            'mods' => $mods,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'workshop_id' => 'required|string|max:20',
            'mod_id' => 'required|string|max:255',
            'map_folder' => 'nullable|string|max:255',
        ]);

        try {
            $this->modManager->add(
                config('zomboid.paths.server_ini'),
                $validated['workshop_id'],
                $validated['mod_id'],
                $validated['map_folder'] ?? null,
            );
        } catch (RuntimeException $e) {
            Log::error('Failed to add mod', ['exception' => $e, 'mod' => $validated]);

            return response()->json([
                'error' => 'Could not save mod to server config.',
            ], 500);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'mod.add',
            target: $validated['workshop_id'],
            details: $validated,
            ip: $request->ip(),
        );

        return response()->json([
            'added' => $validated,
            'restart_required' => true,
        ], 201);
    }

    public function destroy(Request $request, string $workshopId): JsonResponse
    {
        try {
            $removed = $this->modManager->remove(
                config('zomboid.paths.server_ini'),
                $workshopId,
            );
        } catch (RuntimeException $e) {
            Log::error('Failed to remove mod', ['exception' => $e, 'workshop_id' => $workshopId]);

            return response()->json([
                'error' => 'Could not save mod removal to server config.',
            ], 500);
        }

        if (! $removed) {
            return response()->json(['error' => 'Mod not found'], 404);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'mod.remove',
            target: $workshopId,
            details: $removed,
            ip: $request->ip(),
        );

        return response()->json([
            'removed' => $removed,
            'restart_required' => true,
        ]);
    }

    public function reorder(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'mods' => 'required|array',
            'mods.*.workshop_id' => 'required|string',
            'mods.*.mod_id' => 'required|string',
        ]);

        try {
            $this->modManager->reorder(
                config('zomboid.paths.server_ini'),
                $validated['mods'],
            );
        } catch (RuntimeException $e) {
            Log::error('Failed to reorder mods', ['exception' => $e]);

            return response()->json([
                'error' => 'Could not save mod order to server config.',
            ], 500);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'mod.reorder',
            details: ['count' => count($validated['mods'])],
            ip: $request->ip(),
        );

        return response()->json([
            'mods' => $this->modManager->list(config('zomboid.paths.server_ini')),
            'restart_required' => true,
        ]);
    }
}
