<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\ImportModsRequest;
use App\Http\Requests\Admin\LookupWorkshopModRequest;
use App\Http\Requests\Admin\RelinkModsRequest;
use App\Http\Requests\Admin\RemoveModRequest;
use App\Services\AuditLogger;
use App\Services\DockerManager;
use App\Services\ModManager;
use App\Services\SteamWorkshopClient;
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
        private readonly DockerManager $dockerManager,
        private readonly SteamWorkshopClient $workshopClient,
    ) {}

    public function index(): Response
    {
        $mods = [];
        $pendingRestart = false;
        $serverRunning = false;

        try {
            $serverRunning = (bool) ($this->dockerManager->getContainerStatus()['running'] ?? false);
        } catch (\Throwable) {
            // Docker socket unreachable — treat server as stopped, keep rendering
        }

        try {
            $status = $this->modManager->listWithStatus(
                config('zomboid.paths.server_ini'),
                $serverRunning,
            );
            $mods = $status['mods'];
            $pendingRestart = $status['pending_restart'];
        } catch (\Throwable) {
            // Config not available — render empty list rather than 500
        }

        return Inertia::render('admin/mods', [
            'mods' => $mods,
            'protectedWorkshopIds' => array_keys(ModManager::PROTECTED_MODS),
            'pendingRestart' => $pendingRestart,
            'serverRunning' => $serverRunning,
        ]);
    }

    public function lookup(LookupWorkshopModRequest $request): JsonResponse
    {
        $workshopId = $request->validated('workshop_id');
        $details = $this->workshopClient->getDetails($workshopId);

        if ($details === null) {
            return response()->json([
                'found' => false,
                'workshop_id' => $workshopId,
            ], 404);
        }

        return response()->json([
            'found' => true,
            'workshop_id' => $details['workshop_id'],
            'title' => $details['title'],
            'preview_url' => $details['preview_url'],
            'mod_ids' => $details['mod_ids'],
            'map_folders' => $details['map_folders'],
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
                'error' => 'Could not write the server config. The server may still be starting, or the config volume is not writable.',
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
        return $this->removeMod($request, $workshopId, null);
    }

    /**
     * Remove a mod row identified by Workshop ID, mod ID, or both.
     *
     * The list page can hold rows that carry only one of the two — a Workshop item
     * with no known mod ID, or a mod with no Workshop item behind it — and those rows
     * cannot address the `{workshopId}` route at all: an empty segment collapses the
     * URL onto the collection route, which has no DELETE verb. This endpoint takes
     * both identifiers in the body so every row is removable.
     */
    public function destroyEntry(RemoveModRequest $request): JsonResponse
    {
        return $this->removeMod(
            $request,
            $request->validated('workshop_id'),
            $request->validated('mod_id'),
        );
    }

    private function removeMod(Request $request, ?string $workshopId, ?string $modId): JsonResponse
    {
        if (($workshopId !== null && ModManager::isProtected($workshopId))
            || ($modId !== null && ModManager::isProtectedModId($modId))) {
            return response()->json([
                'error' => 'This mod is required by the manager and cannot be removed.',
            ], 422);
        }

        try {
            $removed = $this->modManager->removeEntry(
                config('zomboid.paths.server_ini'),
                $workshopId,
                $modId,
            );
        } catch (RuntimeException $e) {
            Log::error('Failed to remove mod', ['exception' => $e, 'workshop_id' => $workshopId, 'mod_id' => $modId]);

            return response()->json([
                'error' => 'Could not write the server config. The server may still be starting, or the config volume is not writable.',
            ], 500);
        }

        if (! $removed) {
            return response()->json(['error' => 'Mod not found'], 404);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'mod.remove',
            target: $workshopId !== null && $workshopId !== '' ? $workshopId : (string) $modId,
            details: $removed,
            ip: $request->ip(),
        );

        return response()->json([
            'removed' => $removed,
            'restart_required' => true,
        ]);
    }

    /**
     * Persist Workshop-item-to-mod-ID pairings resolved by the browser.
     *
     * Repairs the mod list of a server whose mods were imported before pairings were
     * recorded: the page resolves every installed Workshop ID through Steam and posts
     * the result here. Only pairing metadata is written — the installed lists are
     * untouched, so nothing is enabled or disabled by a repair.
     */
    public function relink(RelinkModsRequest $request): JsonResponse
    {
        /** @var array<string, list<string>> $links */
        $links = $request->validated('links');

        try {
            $this->modManager->recordWorkshopLinks(config('zomboid.paths.server_ini'), $links);
        } catch (RuntimeException $e) {
            Log::error('Failed to record mod links', ['exception' => $e]);

            return response()->json([
                'error' => 'Could not write the mod link file. The config volume may not be writable.',
            ], 500);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'mod.relink',
            target: 'server.ini',
            details: ['workshop_items' => count($links)],
            ip: $request->ip(),
        );

        $serverRunning = false;

        try {
            $serverRunning = (bool) ($this->dockerManager->getContainerStatus()['running'] ?? false);
        } catch (\Throwable) {
            // Docker socket unreachable — report the list without live status
        }

        $status = $this->modManager->listWithStatus(config('zomboid.paths.server_ini'), $serverRunning);

        return response()->json([
            'mods' => $status['mods'],
            'pending_restart' => $status['pending_restart'],
            'linked' => count($links),
        ]);
    }

    public function reorder(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'mods' => 'required|array',
            'mods.*.workshop_id' => 'present|string',
            'mods.*.mod_id' => 'present|string',
        ]);

        try {
            $this->modManager->reorder(
                config('zomboid.paths.server_ini'),
                $validated['mods'],
            );
        } catch (RuntimeException $e) {
            Log::error('Failed to reorder mods', ['exception' => $e]);

            return response()->json([
                'error' => 'Could not write the server config. The server may still be starting, or the config volume is not writable.',
            ], 500);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'mod.reorder',
            details: ['count' => count($validated['mods'])],
            ip: $request->ip(),
        );

        $serverRunning = (bool) ($this->dockerManager->getContainerStatus()['running'] ?? false);
        $status = $this->modManager->listWithStatus(
            config('zomboid.paths.server_ini'),
            $serverRunning,
        );

        return response()->json([
            'mods' => $status['mods'],
            'pending_restart' => $status['pending_restart'],
            'restart_required' => true,
        ]);
    }

    /**
     * Merge a pasted modpack (Workshop/Mods pairs + optional map folders) into the
     * current list in one write. The result lands in `.mod_state` so it survives
     * container restarts; map folders are persisted to `.config_state` too.
     */
    public function import(ImportModsRequest $request): JsonResponse
    {
        $workshopIds = $request->validated('workshop_ids', []);
        $modIds = $request->validated('mod_ids', []);
        $mapFolders = $request->validated('map', []);
        $links = $request->validated('links', []);

        try {
            $summary = $this->modManager->bulkImport(
                config('zomboid.paths.server_ini'),
                $workshopIds,
                $modIds,
                $mapFolders,
                $links,
            );
        } catch (RuntimeException $e) {
            Log::error('Failed to bulk import mods', ['exception' => $e]);

            return response()->json([
                'error' => 'Could not write the server config. The server may still be starting, or the config volume is not writable.',
            ], 500);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'mod.import',
            target: 'server.ini',
            details: $summary,
            ip: $request->ip(),
        );

        $serverRunning = false;

        try {
            $serverRunning = (bool) ($this->dockerManager->getContainerStatus()['running'] ?? false);
        } catch (\Throwable) {
            // Docker socket unreachable — report the list without live status
        }

        $status = $this->modManager->listWithStatus(
            config('zomboid.paths.server_ini'),
            $serverRunning,
        );

        return response()->json([
            'mods' => $status['mods'],
            'pending_restart' => $status['pending_restart'],
            'summary' => $summary,
            'restart_required' => true,
        ], 201);
    }
}
