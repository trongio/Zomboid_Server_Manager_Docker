<?php

namespace App\Jobs;

use App\Services\SaveCacheBuilder;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Парсит PZ save chunks через Python pzdataspec и пишет packed файлы.
 *
 * Запускается через Scheduler каждые 30 сек или вручную через
 * `php artisan pz:rebuild-save-cache`.
 *
 * Incremental: первый запуск — full rebuild (long, ~50-100 сек), все следующие —
 * только cells затронутые chunks с mtime > last_run.
 */
class RebuildSaveCacheJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 1800;

    public function __construct(public readonly bool $forceFull = false) {}

    public function handle(SaveCacheBuilder $builder): void
    {
        if (! $builder->isReady()) {
            Log::info('save-cache rebuild skipped — prerequisites missing', [
                'save_dir_exists' => is_dir($builder->saveDir()),
                'sprites_json_exists' => is_file($builder->spritesJsonPath()),
            ]);

            return;
        }

        if (! $builder->acquireLock()) {
            Log::info('save-cache rebuild skipped — another rebuild in progress');

            return;
        }

        try {
            $lastRunAt = $builder->getLastRunAt();
            $forceFull = $this->forceFull || $lastRunAt === null;

            $startedAt = time();

            if ($forceFull) {
                Log::info('save-cache: starting full rebuild');
                $result = $builder->runFullRebuild();
            } else {
                $maxMtime = $builder->maxChunkMtime();
                if ($maxMtime <= $lastRunAt) {
                    Log::debug('save-cache: no changes since last run', [
                        'last_run' => $lastRunAt,
                        'max_mtime' => $maxMtime,
                    ]);

                    return;
                }
                Log::info('save-cache: starting incremental rebuild', [
                    'since' => $lastRunAt,
                    'max_mtime' => $maxMtime,
                ]);
                $result = $builder->runIncrementalRebuild($lastRunAt);
            }

            if ($result['success']) {
                $builder->setLastRunAt($startedAt);
                Log::info('save-cache rebuild done', [
                    'duration_seconds' => $result['duration_seconds'],
                    'mode' => $forceFull ? 'full' : 'incremental',
                ]);
            } else {
                Log::warning('save-cache rebuild failed', [
                    'duration_seconds' => $result['duration_seconds'],
                    'output_tail' => mb_substr($result['output'], -500),
                ]);
            }
        } catch (Throwable $e) {
            Log::error('save-cache rebuild crashed', [
                'error' => $e->getMessage(),
            ]);
        } finally {
            $builder->releaseLock();
        }
    }
}
