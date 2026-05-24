<?php

namespace App\Jobs;

use App\Models\MapRenderSetting;
use App\Services\AuditLogger;
use App\Services\MapRenderService;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Throwable;

class RenderMapJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 14400;

    public function __construct(
        private readonly string $actor,
        private readonly ?string $ip = null,
    ) {}

    public function handle(MapRenderService $renderer): void
    {
        if (! $renderer->acquireLock()) {
            Log::warning('RenderMapJob skipped: another render is already running');

            return;
        }

        $startedAt = now()->toIso8601String();
        $startTimestamp = microtime(true);
        $setting = MapRenderSetting::instance();
        $serverPath = config('zomboid.game_server_path');

        try {
            if (! is_dir($serverPath.'/media')) {
                throw new \RuntimeException("Game server files not ready (no media/ in {$serverPath})");
            }

            if (! $renderer->hasTexturepacks()) {
                throw new \RuntimeException(
                    'Texture packs are missing. Upload a zip of Project Zomboid client media/texturepacks '
                    .'(must contain Tiles2x.pack, Tiles2x.floor.pack, JumboTrees2x.pack and Overlays2x.pack) '
                    .'using the "Upload texturepacks" form on the map page before starting a render.'
                );
            }

            $renderer->writeProgress(MapRenderService::STAGE_UNPACK, 5, 'Preparing render pipeline', $startedAt);

            if (! $renderer->hasBaseTiles() || $setting->base_rendered_at === null) {
                $renderer->writeProgress(MapRenderService::STAGE_UNPACK, 10, 'Unpacking textures (one-time, may take 5-15 min)', $startedAt);

                if (! $renderer->runUnpack()) {
                    throw new \RuntimeException('pzmap2dzi unpack failed: '.($renderer->lastErrorTail() ?? 'no output'));
                }

                if ($renderer->isCancelRequested()) {
                    throw new \RuntimeException('Render cancelled by admin');
                }

                $renderer->writeProgress(MapRenderService::STAGE_BASE, 25, 'Rendering base map (this is the long step)', $startedAt);

                if (! $renderer->runBaseRender()) {
                    throw new \RuntimeException('pzmap2dzi render base failed: '.($renderer->lastErrorTail() ?? 'no output'));
                }

                $setting->forceFill(['base_rendered_at' => now()])->save();
            }

            if ($renderer->isCancelRequested()) {
                throw new \RuntimeException('Render cancelled by admin');
            }

            $savePath = $renderer->activeSavePath();

            if (! is_dir($savePath)) {
                throw new \RuntimeException("Save directory not found: {$savePath}");
            }

            $renderer->writeProgress(MapRenderService::STAGE_SAVEGAME, 75, 'Rendering save-game overlay', $startedAt);

            if (! $renderer->runSavegameRender($savePath)) {
                throw new \RuntimeException('pzmap2dzi savegame render failed: '.($renderer->lastErrorTail() ?? 'no output'));
            }

            $duration = (int) round(microtime(true) - $startTimestamp);

            $setting->forceFill([
                'last_run_at' => now(),
                'last_run_status' => 'success',
                'last_run_duration_seconds' => $duration,
                'last_run_error' => null,
            ])->save();

            $renderer->writeProgress(MapRenderService::STAGE_SAVEGAME, 100, 'Render complete', $startedAt);

            AuditLogger::record(
                actor: $this->actor,
                action: 'map.render.completed',
                details: ['duration_seconds' => $duration],
                ip: $this->ip,
            );

            Log::info('Map render completed', ['duration_seconds' => $duration, 'actor' => $this->actor]);
        } catch (Throwable $e) {
            $duration = (int) round(microtime(true) - $startTimestamp);
            $cancelled = $renderer->isCancelRequested();
            $status = $cancelled ? 'cancelled' : 'failed';

            $setting->forceFill([
                'last_run_at' => now(),
                'last_run_status' => $status,
                'last_run_duration_seconds' => $duration,
                'last_run_error' => $cancelled ? null : mb_substr($e->getMessage(), 0, 4000),
            ])->save();

            AuditLogger::record(
                actor: $this->actor,
                action: $cancelled ? 'map.render.cancelled' : 'map.render.failed',
                details: ['error' => $e->getMessage(), 'duration_seconds' => $duration],
                ip: $this->ip,
            );

            Log::warning('Map render ended without success', [
                'status' => $status,
                'error' => $e->getMessage(),
                'actor' => $this->actor,
            ]);
        } finally {
            $renderer->releaseLock();
            $renderer->clearProgress();
        }
    }
}
