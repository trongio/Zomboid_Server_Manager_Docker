<?php

namespace App\Console\Commands;

use App\Models\MapRenderSetting;
use App\Services\MapRenderService;
use Illuminate\Console\Command;

class GenerateMapTiles extends Command
{
    /** @var string */
    protected $signature = 'zomboid:generate-map-tiles
        {--force : Regenerate base tiles even if they already exist}
        {--savegame : Render the save-game overlay after the base map}
        {--workers= : Number of render workers (default: auto-detect CPU cores)}';

    /** @var string */
    protected $description = 'Generate DZI map tiles from PZ game data using pzmap2dzi';

    public function handle(MapRenderService $renderer): int
    {
        $serverPath = config('zomboid.game_server_path');

        if (! is_dir($serverPath)) {
            $this->error("Game server path does not exist: {$serverPath}");

            return self::FAILURE;
        }

        if (! is_dir($serverPath.'/media')) {
            $this->error("Game server files not ready yet (no media/ directory in {$serverPath})");

            return self::FAILURE;
        }

        if (! $renderer->isEngineInstalled()) {
            $this->error('pzmap2dzi not found at '.$renderer->pzmap2dziPath());

            return self::FAILURE;
        }

        $workers = $this->option('workers') !== null ? (int) $this->option('workers') : null;
        $setting = MapRenderSetting::instance();
        $renderBase = $this->option('force') || ! $renderer->hasBaseTiles() || $setting->base_rendered_at === null;

        if ($renderBase) {
            $this->info('Step 1/3: Unpacking textures...');
            if (! $renderer->runUnpack($workers)) {
                $this->error('pzmap2dzi unpack failed (see storage/logs/pzmap2dzi.log)');

                return self::FAILURE;
            }

            $this->info('Step 2/3: Rendering base map...');
            if (! $renderer->runBaseRender($workers)) {
                $this->error('pzmap2dzi render base failed (see storage/logs/pzmap2dzi.log)');

                return self::FAILURE;
            }

            $setting->forceFill(['base_rendered_at' => now()])->save();
        } else {
            $this->info('Base tiles already exist — skipping unpack/base render. Use --force to redo.');
        }

        if ($this->option('savegame')) {
            $savePath = $renderer->activeSavePath();

            if (! is_dir($savePath)) {
                $this->error("Save directory not found: {$savePath}");

                return self::FAILURE;
            }

            $this->info('Step 3/3: Rendering save-game overlay...');
            if (! $renderer->runSavegameRender($savePath, $workers)) {
                $this->error('pzmap2dzi savegame render failed (see storage/logs/pzmap2dzi.log)');

                return self::FAILURE;
            }
        }

        $this->info('Map tile generation completed.');

        return self::SUCCESS;
    }
}
