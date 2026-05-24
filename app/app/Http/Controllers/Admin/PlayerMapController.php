<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\MapRenderSetting;
use App\Services\MapConfigBuilder;
use App\Services\MapRenderService;
use App\Services\OnlinePlayersReader;
use App\Services\PlayerPositionReader;
use App\Services\PlayersDbReader;
use App\Services\SafeZoneManager;
use App\Services\ServerStatusResolver;
use Illuminate\Http\Response;
use Inertia\Inertia;
use Inertia\Response as InertiaResponse;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class PlayerMapController extends Controller
{
    public function __construct(
        private readonly PlayersDbReader $playersDb,
        private readonly PlayerPositionReader $positionReader,
        private readonly OnlinePlayersReader $onlinePlayers,
        private readonly ServerStatusResolver $statusResolver,
        private readonly MapConfigBuilder $mapConfigBuilder,
        private readonly SafeZoneManager $safeZoneManager,
        private readonly MapRenderService $renderer,
    ) {}

    public function __invoke(): InertiaResponse
    {
        $resolved = $this->statusResolver->resolve();
        $dbPlayers = $this->playersDb->getAllPlayerPositions();
        $liveData = $this->positionReader->getLivePositions();

        // Use OnlinePlayersReader for reliable online detection (log → RCON → Lua)
        $onlineUsernames = $this->onlinePlayers->getOnlineUsernames();

        $livePositions = [];

        if ($liveData !== null && ! empty($liveData['players'])) {
            foreach ($liveData['players'] as $player) {
                $username = $player['username'] ?? '';
                $livePositions[$username] = $player;
            }
        }

        $markers = [];

        foreach ($dbPlayers as $player) {
            $username = $player['username'];
            $isOnline = in_array($username, $onlineUsernames);

            if ($isOnline && isset($livePositions[$username])) {
                $live = $livePositions[$username];
                $isDead = $live['is_dead'] ?? $player['is_dead'];

                $markers[] = [
                    'username' => $username,
                    'name' => $player['name'],
                    'x' => (float) $live['x'],
                    'y' => (float) $live['y'],
                    'z' => (int) ($live['z'] ?? 0),
                    'status' => $isDead ? 'dead' : 'online',
                    'is_online' => true,
                ];
            } elseif ($isOnline) {
                $markers[] = [
                    'username' => $username,
                    'name' => $player['name'],
                    'x' => $player['x'],
                    'y' => $player['y'],
                    'z' => $player['z'],
                    'status' => $player['is_dead'] ? 'dead' : 'online',
                    'is_online' => true,
                ];
            } else {
                $markers[] = [
                    'username' => $username,
                    'name' => $player['name'],
                    'x' => $player['x'],
                    'y' => $player['y'],
                    'z' => $player['z'],
                    'status' => $player['is_dead'] ? 'dead' : 'offline',
                    'is_online' => false,
                ];
            }
        }

        // Add any online players not in the DB (new connections or DB unavailable)
        foreach ($onlineUsernames as $username) {
            $alreadyAdded = collect($markers)->contains('username', $username);
            if (! $alreadyAdded) {
                $live = $livePositions[$username] ?? null;
                $markers[] = [
                    'username' => $username,
                    'name' => $live['name'] ?? $username,
                    'x' => $live ? (float) $live['x'] : 0.0,
                    'y' => $live ? (float) $live['y'] : 0.0,
                    'z' => $live ? (int) ($live['z'] ?? 0) : 0,
                    'status' => ($live && ($live['is_dead'] ?? false)) ? 'dead' : 'online',
                    'is_online' => true,
                ];
            }
        }

        $mapConfig = $this->mapConfigBuilder->build();
        $safeZoneConfig = $this->safeZoneManager->getConfig();
        $renderSetting = MapRenderSetting::instance();

        return Inertia::render('admin/player-map', [
            'markers' => $markers,
            'onlineCount' => $resolved['player_count'],
            'serverStatus' => $resolved['game_status'],
            'mapConfig' => $mapConfig,
            'hasTiles' => $mapConfig['tileUrl'] !== null,
            'tileProgress' => null,
            'tilesGenerating' => false,
            'safeZones' => $safeZoneConfig['enabled'] ? $safeZoneConfig['zones'] : [],
            'renderEngine' => [
                'installed' => $this->renderer->isEngineInstalled(),
                'enabled' => $renderSetting->engine_enabled,
                'rendering' => $this->renderer->isRendering(),
                'paused' => $this->renderer->isPaused(),
                'has_base_tiles' => $this->renderer->hasBaseTiles(),
                'progress' => $this->renderer->currentProgress(),
                'log_progress' => $this->renderer->parseProgressFromLog(),
                'schedule_preset' => $renderSetting->schedule_preset,
                'cron_expression' => $renderSetting->cron_expression,
                'effective_cron' => $renderSetting->effectiveCronExpression(),
                'last_run_at' => $renderSetting->last_run_at?->toIso8601String(),
                'last_run_status' => $renderSetting->last_run_status,
                'last_run_duration_seconds' => $renderSetting->last_run_duration_seconds,
                'last_run_error' => $renderSetting->last_run_error,
                'base_rendered_at' => $renderSetting->base_rendered_at?->toIso8601String(),
                'texturepacks' => [
                    'present' => $this->renderer->hasTexturepacks(),
                    'files' => $this->renderer->texturepackFiles(),
                ],
                'quality' => [
                    'preset' => $renderSetting->quality_preset,
                    'custom_tile_size' => $renderSetting->custom_tile_size,
                    'custom_omit_levels' => $renderSetting->custom_omit_levels,
                    'effective_tile_size' => $renderSetting->effectiveTileSize(),
                    'effective_omit_levels' => $renderSetting->effectiveOmitLevels(),
                ],
            ],
        ]);
    }

    /**
     * Serve a map tile from the configured tiles path.
     */
    public function tile(string $level, string $tile): BinaryFileResponse|Response
    {
        $tilesPath = config('zomboid.map.tiles_path');
        $dziPath = $tilesPath.'/html/map_data/base/layer0_files';

        // Try webp first, then jpg
        $baseTile = pathinfo($tile, PATHINFO_FILENAME);
        $filePath = null;
        $contentType = 'image/webp';

        foreach (['webp', 'jpg'] as $ext) {
            $candidate = $dziPath.'/'.$level.'/'.$baseTile.'.'.$ext;
            if (is_file($candidate)) {
                $filePath = $candidate;
                $contentType = $ext === 'jpg' ? 'image/jpeg' : 'image/webp';
                break;
            }
        }

        if ($filePath === null) {
            // Return transparent 1x1 PNG for missing tiles (avoids broken-image placeholders in Leaflet)
            return response(base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='), 200, [
                'Content-Type' => 'image/png',
                'Cache-Control' => 'public, max-age=86400',
            ]);
        }

        // Prevent path traversal
        $realTilesPath = realpath($tilesPath);
        $realFilePath = realpath($filePath);

        if ($realTilesPath === false || $realFilePath === false || ! str_starts_with($realFilePath, $realTilesPath)) {
            return response('Not found', 404);
        }

        return response()->file($realFilePath, [
            'Cache-Control' => 'public, max-age=86400',
            'Content-Type' => $contentType,
        ]);
    }

}
