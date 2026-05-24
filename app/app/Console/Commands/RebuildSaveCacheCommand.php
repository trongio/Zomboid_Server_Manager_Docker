<?php

namespace App\Console\Commands;

use App\Services\SaveCacheBuilder;
use Illuminate\Console\Command;

class RebuildSaveCacheCommand extends Command
{
    protected $signature = 'pz:rebuild-save-cache
        {--full : Force full rebuild instead of incremental}
        {--workers=4 : Number of parallel Python parser workers}';

    protected $description = 'Parse PZ save .bin chunks into packed Uint32Array files for WebGL renderer';

    public function handle(SaveCacheBuilder $builder): int
    {
        if (! $builder->isReady()) {
            $this->warn('Prerequisites missing:');
            $this->line('  save_dir: '.$builder->saveDir().' '.(is_dir($builder->saveDir()) ? 'OK' : 'MISSING'));
            $this->line('  sprites.json: '.$builder->spritesJsonPath().' '.(is_file($builder->spritesJsonPath()) ? 'OK' : 'MISSING'));
            $this->line('  pzmap2dzi: /opt/pzmap2dzi/main.py '.(is_file('/opt/pzmap2dzi/main.py') ? 'OK' : 'MISSING'));
            $this->line('  pzdataspec: /map-tiles/lib/pzdataspec '.(is_dir('/map-tiles/lib/pzdataspec') ? 'OK' : 'MISSING'));

            return self::FAILURE;
        }

        if (! $builder->acquireLock()) {
            $this->error('Another save-cache rebuild is already running');

            return self::FAILURE;
        }

        $workers = (int) $this->option('workers');
        $forceFull = (bool) $this->option('full');

        try {
            $startedAt = time();

            if ($forceFull || $builder->getLastRunAt() === null) {
                $this->info('Running full rebuild...');
                $result = $builder->runFullRebuild($workers);
            } else {
                $maxMtime = $builder->maxChunkMtime();
                $lastRun = $builder->getLastRunAt();
                if ($maxMtime <= $lastRun) {
                    $this->info('No changes since last run, nothing to do.');

                    return self::SUCCESS;
                }
                $this->info('Running incremental rebuild...');
                $result = $builder->runIncrementalRebuild($lastRun, $workers);
            }

            $this->line($result['output']);

            if ($result['success']) {
                $builder->setLastRunAt($startedAt);
                $this->info(sprintf('Done in %.2f sec', $result['duration_seconds']));

                return self::SUCCESS;
            }

            $this->error('Rebuild failed (exit code != 0)');

            return self::FAILURE;
        } finally {
            $builder->releaseLock();
        }
    }
}
