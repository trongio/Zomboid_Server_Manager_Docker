<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

/**
 * Парсит PZ save .bin chunks через Python pzdataspec и пишет packed
 * Uint32Array файлы для WebGL рендера на клиенте.
 *
 * Используется существующая инфраструктура pzmap2dzi (`/opt/pzmap2dzi`)
 * и pzdataspec (`/map-tiles/lib`). Python-скрипт расположен в
 * `docker/scripts/rebuild_save_cache.py` и читается из контейнера.
 */
class SaveCacheBuilder
{
    public const LOCK_KEY = 'pz:save-cache:lock';

    public const LAST_RUN_KEY = 'pz:save-cache:last-run';

    public const EXTRA_NOISE_PREFIXES_KEY = 'pz:save-cache:extra-noise-prefixes';

    public const LOCK_TTL_SECONDS = 1800;

    public function __construct(private readonly string $scriptPath = '/var/www/html/docker/scripts/rebuild_save_cache.py') {}

    public function isLocked(): bool
    {
        return Cache::has(self::LOCK_KEY);
    }

    public function acquireLock(): bool
    {
        return Cache::add(self::LOCK_KEY, now()->toIso8601String(), self::LOCK_TTL_SECONDS);
    }

    public function releaseLock(): void
    {
        Cache::forget(self::LOCK_KEY);
    }

    public function getLastRunAt(): ?int
    {
        $value = Cache::get(self::LAST_RUN_KEY);

        return is_int($value) ? $value : null;
    }

    public function setLastRunAt(int $unixTime): void
    {
        Cache::forever(self::LAST_RUN_KEY, $unixTime);
    }

    /**
     * @return array<int, string>
     */
    public function getExtraNoisePrefixes(): array
    {
        $value = Cache::get(self::EXTRA_NOISE_PREFIXES_KEY);

        return is_array($value) ? array_values(array_filter($value, 'is_string')) : [];
    }

    /**
     * @param  array<int, string>  $prefixes
     */
    public function setExtraNoisePrefixes(array $prefixes): void
    {
        $clean = array_values(array_unique(array_filter(array_map(
            static fn ($p): string => is_string($p) ? trim($p) : '',
            $prefixes,
        ), static fn (string $p): bool => $p !== '' && preg_match('/^[a-zA-Z0-9_]+$/', $p) === 1)));

        Cache::forever(self::EXTRA_NOISE_PREFIXES_KEY, $clean);
    }

    public function saveDir(): string
    {
        $dataPath = rtrim((string) config('zomboid.paths.data', '/pz-data'), '/');
        $serverName = (string) config('zomboid.server_name', 'ZomboidServer');

        return $dataPath.'/Saves/Multiplayer/'.$serverName;
    }

    public function outputDir(): string
    {
        $tilesPath = rtrim((string) config('zomboid.map.tiles_path', '/map-tiles'), '/');

        return $tilesPath.'/save-cache';
    }

    public function spritesJsonPath(): string
    {
        $tilesPath = rtrim((string) config('zomboid.map.tiles_path', '/map-tiles'), '/');

        return $tilesPath.'/web/sprites.json';
    }

    public function isReady(): bool
    {
        return is_file($this->spritesJsonPath())
            && is_dir($this->saveDir())
            && is_file('/opt/pzmap2dzi/main.py')
            && is_dir('/map-tiles/lib/pzdataspec');
    }

    /**
     * Запустить полный rebuild (full scan). Вызывается из Job.
     *
     * @return array{success: bool, output: string, duration_seconds: float}
     */
    public function runFullRebuild(?int $workers = null): array
    {
        return $this->run($this->buildBaseArgs($workers));
    }

    /**
     * Запустить incremental rebuild — обновляет только cells, в которые входят
     * chunks с mtime > $since. Если $since равно null, поведение эквивалентно
     * full rebuild.
     *
     * @return array{success: bool, output: string, duration_seconds: float}
     */
    public function runIncrementalRebuild(int $since, ?int $workers = null): array
    {
        return $this->run([
            ...$this->buildBaseArgs($workers),
            '--since-mtime' => (string) $since,
        ]);
    }

    /**
     * @return array<string, string>
     */
    private function buildBaseArgs(?int $workers): array
    {
        $serverPath = rtrim((string) config('zomboid.game_server_path', '/pz-server'), '/');
        $mapName = (string) config('zomboid.map_name_primary', 'Muldraugh, KY');

        $args = [
            '--save-dir' => $this->saveDir(),
            '--pz-root' => $serverPath,
            '--output-dir' => $this->outputDir(),
            '--sprites-json' => $this->spritesJsonPath(),
            '--server-name' => (string) config('zomboid.server_name', 'ZomboidServer'),
            '--workers' => (string) max(1, $workers ?? $this->detectCpuCores()),
            '--base-map-path' => $serverPath.'/media/maps/'.$mapName,
        ];

        $extra = $this->getExtraNoisePrefixes();
        if ($extra !== []) {
            $args['--extra-noise-prefixes'] = implode(',', $extra);
        }

        return $args;
    }

    /**
     * Найти max(mtime) среди всех chunk-файлов в save директории.
     * Используется для принятия решения нужен ли rebuild.
     */
    public function maxChunkMtime(): int
    {
        $saveDir = $this->saveDir();
        $mapDir = $saveDir.'/map';
        if (! is_dir($mapDir)) {
            return 0;
        }

        $max = 0;
        $entries = @scandir($mapDir);
        if ($entries === false) {
            return 0;
        }

        foreach ($entries as $xEntry) {
            if (! ctype_digit($xEntry)) {
                continue;
            }
            $xDir = $mapDir.'/'.$xEntry;
            if (! is_dir($xDir)) {
                continue;
            }
            $yEntries = @scandir($xDir);
            if ($yEntries === false) {
                continue;
            }
            foreach ($yEntries as $yEntry) {
                if (preg_match('/^\d+\.bin$/', $yEntry) !== 1) {
                    continue;
                }
                $mtime = @filemtime($xDir.'/'.$yEntry);
                if ($mtime !== false && $mtime > $max) {
                    $max = $mtime;
                }
            }
        }

        return $max;
    }

    /**
     * @param  array<string, string>  $args
     * @return array{success: bool, output: string, duration_seconds: float}
     */
    private function run(array $args): array
    {
        $start = microtime(true);

        $cmdParts = ['python3', escapeshellarg($this->scriptPath)];
        foreach ($args as $flag => $value) {
            $cmdParts[] = escapeshellarg($flag);
            $cmdParts[] = escapeshellarg($value);
        }
        $cmd = implode(' ', $cmdParts).' 2>&1';

        $outputLines = [];
        $exitCode = 0;
        exec($cmd, $outputLines, $exitCode);
        $output = implode("\n", $outputLines);
        $duration = round(microtime(true) - $start, 2);

        $success = $exitCode === 0;
        if (! $success) {
            Log::error('rebuild_save_cache.py failed', [
                'exit_code' => $exitCode,
                'output_tail' => mb_substr($output, -2000),
            ]);
        }

        return [
            'success' => $success,
            'output' => $output,
            'duration_seconds' => $duration,
        ];
    }

    private function detectCpuCores(): int
    {
        if (function_exists('shell_exec')) {
            $result = (int) shell_exec('nproc 2>/dev/null') ?: 0;
            if ($result > 0) {
                return $result;
            }
        }

        return 4;
    }
}
