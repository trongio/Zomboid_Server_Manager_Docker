<?php

namespace App\Services;

use App\Jobs\RenderMapJob;
use App\Models\MapRenderSetting;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class MapRenderService
{
    public const PROGRESS_CACHE_KEY = 'map.render.progress';

    public const LOCK_CACHE_KEY = 'map.render.lock';

    public const CANCEL_CACHE_KEY = 'map.render.cancel';

    public const LOCK_TTL_SECONDS = 14400;

    public const STAGE_UNPACK = 'unpack';

    public const STAGE_BASE = 'render_base';

    public const STAGE_SAVEGAME = 'savegame';

    /**
     * Last log file content captured from the most recent pzmap2dzi invocation.
     */
    private ?string $lastErrorTail = null;

    /**
     * Whether the pzmap2dzi renderer binary is present in the container.
     */
    public function isEngineInstalled(): bool
    {
        return is_file($this->pzmap2dziPath());
    }

    /**
     * Whether the render engine has been switched on by an admin.
     */
    public function isEngineEnabled(): bool
    {
        return MapRenderSetting::instance()->engine_enabled;
    }

    /**
     * Whether a render job is currently running (best-effort, based on lock).
     */
    public function isRendering(): bool
    {
        return Cache::has(self::LOCK_CACHE_KEY);
    }

    /**
     * Whether base map tiles exist on disk.
     */
    public function hasBaseTiles(): bool
    {
        return is_dir($this->baseTilesPath().'/0');
    }

    /**
     * @return array{stage: string, percent: int, message: string|null, started_at: string|null}|null
     */
    public function currentProgress(): ?array
    {
        $payload = Cache::get(self::PROGRESS_CACHE_KEY);

        if (! is_array($payload)) {
            return null;
        }

        return [
            'stage' => (string) ($payload['stage'] ?? 'unknown'),
            'percent' => (int) ($payload['percent'] ?? 0),
            'message' => $payload['message'] ?? null,
            'started_at' => $payload['started_at'] ?? null,
        ];
    }

    public function writeProgress(string $stage, int $percent, ?string $message = null, ?string $startedAt = null): void
    {
        Cache::put(self::PROGRESS_CACHE_KEY, [
            'stage' => $stage,
            'percent' => max(0, min(100, $percent)),
            'message' => $message,
            'started_at' => $startedAt,
            'updated_at' => now()->toIso8601String(),
        ], self::LOCK_TTL_SECONDS);
    }

    public function clearProgress(): void
    {
        Cache::forget(self::PROGRESS_CACHE_KEY);
    }

    public function acquireLock(): bool
    {
        return Cache::add(self::LOCK_CACHE_KEY, now()->toIso8601String(), self::LOCK_TTL_SECONDS);
    }

    public function releaseLock(): void
    {
        Cache::forget(self::LOCK_CACHE_KEY);
        Cache::forget(self::CANCEL_CACHE_KEY);
    }

    public function requestCancel(): void
    {
        Cache::put(self::CANCEL_CACHE_KEY, true, self::LOCK_TTL_SECONDS);
    }

    /**
     * Kill all pzmap2dzi processes inside the queue container via Docker Exec API.
     * Without this, a Cancel button click only flags the queued job; the
     * blocking exec() inside the worker keeps pzmap2dzi running until it
     * finishes the current sub-command on its own (hours).
     */
    public function killRenderProcesses(): bool
    {
        $proxyUrl = rtrim((string) config('zomboid.docker.proxy_url'), '/');

        if ($proxyUrl === '') {
            return false;
        }

        $container = $this->queueContainerName();

        // If the container is paused (via the Pause button), Docker Exec
        // won't actually run anything until we unpause it first.
        if ($this->isPaused()) {
            $this->resumeRender();
        }

        try {
            $createUrl = $proxyUrl.'/containers/'.$container.'/exec';
            $createResponse = Http::timeout(10)
                ->asJson()
                ->post($createUrl, [
                    'AttachStdout' => false,
                    'AttachStderr' => false,
                    'Tty' => false,
                    'Cmd' => ['sh', '-c', 'pkill -KILL -f pzmap2dzi/main.py'],
                ]);
        } catch (\Throwable $e) {
            Log::error('Docker exec create failed', ['error' => $e->getMessage()]);

            return false;
        }

        if (! $createResponse->successful()) {
            Log::error('Docker exec create rejected', ['status' => $createResponse->status(), 'body' => $createResponse->body()]);

            return false;
        }

        $execId = $createResponse->json('Id');

        if (! is_string($execId) || $execId === '') {
            return false;
        }

        try {
            $startResponse = Http::timeout(10)
                ->asJson()
                ->post($proxyUrl.'/exec/'.$execId.'/start', ['Detach' => true, 'Tty' => false]);
        } catch (\Throwable $e) {
            Log::error('Docker exec start failed', ['error' => $e->getMessage()]);

            return false;
        }

        return $startResponse->successful() || $startResponse->status() === 200;
    }

    public function isCancelRequested(): bool
    {
        return (bool) Cache::get(self::CANCEL_CACHE_KEY, false);
    }

    /**
     * Dispatch a render job onto the queue. Returns false if a render is already running,
     * the engine is disabled, or pzmap2dzi is missing.
     */
    public function dispatchRender(string $actor, ?string $ip = null): bool
    {
        if ($this->isRendering()) {
            return false;
        }

        if (! $this->isEngineEnabled() || ! $this->isEngineInstalled()) {
            return false;
        }

        Bus::dispatch(new RenderMapJob($actor, $ip));

        return true;
    }

    /**
     * Run pzmap2dzi `unpack` subcommand against the game server media files.
     */
    public function runUnpack(?int $workers = null): bool
    {
        return $this->runPzmap('unpack', $workers);
    }

    /**
     * Run pzmap2dzi `render base` subcommand.
     */
    public function runBaseRender(?int $workers = null): bool
    {
        return $this->runPzmap('render base', $workers);
    }

    /**
     * Run pzmap2dzi save-game render. The save-game list is resolved by pzmap2dzi
     * from the configured save_game_root (set in ensureGeneratedConfig).
     */
    public function runSavegameRender(string $savePath, ?int $workers = null): bool
    {
        return $this->runPzmap('render save', $workers);
    }

    /**
     * Resolved save path for the active multiplayer server.
     */
    public function activeSavePath(): string
    {
        $data = rtrim(config('zomboid.paths.data', '/pz-data'), '/');
        $serverName = config('zomboid.server_name', 'ZomboidServer');

        return $data.'/Saves/Multiplayer/'.$serverName;
    }

    public function pzmap2dziPath(): string
    {
        return '/opt/pzmap2dzi/main.py';
    }

    /**
     * Name of the queue container that runs pzmap2dzi (paused/unpaused via Docker API).
     */
    public function queueContainerName(): string
    {
        return (string) config('zomboid.docker.queue_container_name', 'pz-queue');
    }

    /**
     * Pause the queue container (and the pzmap2dzi processes inside it) via Docker API.
     */
    public function pauseRender(): bool
    {
        return $this->callDocker('pause');
    }

    public function resumeRender(): bool
    {
        return $this->callDocker('unpause');
    }

    public function isPaused(): bool
    {
        $proxyUrl = rtrim((string) config('zomboid.docker.proxy_url'), '/');

        if ($proxyUrl === '') {
            return false;
        }

        try {
            $response = Http::timeout(5)->get($proxyUrl.'/containers/'.$this->queueContainerName().'/json');
        } catch (\Throwable) {
            return false;
        }

        if (! $response->successful()) {
            return false;
        }

        $status = $response->json('State.Status');

        return $status === 'paused';
    }

    /**
     * Parse the latest "job: X/Y" progress line, preferring the live per-step temp
     * log (written by pzmap2dzi while it runs) and falling back to the persisted log.
     *
     * @return array{completed: int, total: int, percent: int, active_workers: int, total_workers: int}|null
     */
    public function parseProgressFromLog(): ?array
    {
        $candidates = [];

        $shared = storage_path('logs/pzmap2dzi_live.log');
        if (is_file($shared)) {
            $candidates[] = $shared;
        }

        foreach ((array) glob(sys_get_temp_dir().'/pzmap2dzi_*') as $tmp) {
            if (is_string($tmp) && is_file($tmp)) {
                $candidates[] = $tmp;
            }
        }

        $candidates[] = storage_path('logs/pzmap2dzi.log');

        // Newest mtime first — live stepLog is being appended right now.
        usort($candidates, static fn (string $a, string $b) => (int) (@filemtime($b) ?: 0) - (int) (@filemtime($a) ?: 0));

        foreach ($candidates as $path) {
            $progress = $this->parseProgressFromFile($path);
            if ($progress !== null) {
                return $progress;
            }
        }

        return null;
    }

    /**
     * @return array{completed: int, total: int, percent: int, active_workers: int, total_workers: int}|null
     */
    private function parseProgressFromFile(string $path): ?array
    {
        if (! is_file($path)) {
            return null;
        }

        $size = (int) @filesize($path);

        if ($size === 0) {
            return null;
        }

        $offset = max(0, $size - 8192);
        $tail = @file_get_contents($path, false, null, $offset);

        if ($tail === false || $tail === '') {
            return null;
        }

        $segments = preg_split('/[\r\n]+/', $tail) ?: [];

        foreach (array_reverse($segments) as $segment) {
            if (preg_match('/job:\s*(\d+)\/(\d+)\s+worker:\s*(\d+)\/(\d+)/', $segment, $m) === 1) {
                $completed = (int) $m[1];
                $total = (int) $m[2];

                return [
                    'completed' => $completed,
                    'total' => $total,
                    'percent' => $total > 0 ? (int) round($completed / $total * 100) : 0,
                    'active_workers' => (int) $m[3],
                    'total_workers' => (int) $m[4],
                ];
            }
        }

        return null;
    }

    private function callDocker(string $action): bool
    {
        $proxyUrl = rtrim((string) config('zomboid.docker.proxy_url'), '/');

        if ($proxyUrl === '') {
            return false;
        }

        try {
            $response = Http::timeout(15)->post(
                $proxyUrl.'/containers/'.$this->queueContainerName().'/'.$action,
            );
        } catch (\Throwable $e) {
            Log::error('Docker '.$action.' failed', ['error' => $e->getMessage()]);

            return false;
        }

        return $response->successful() || $response->status() === 304;
    }

    public function texturepacksPath(): string
    {
        return rtrim(config('zomboid.map.texturepacks_path', '/pz-data/texturepacks'), '/');
    }

    /**
     * Whether the writable texturepacks directory contains the required pack files.
     */
    public function hasTexturepacks(): bool
    {
        $path = $this->texturepacksPath();

        if (! is_dir($path)) {
            return false;
        }

        $required = ['Tiles2x.floor.pack', 'JumboTrees2x.pack', 'Overlays2x.pack', 'Tiles2x.pack'];

        foreach ($required as $file) {
            if (! is_file($path.'/'.$file)) {
                return false;
            }
        }

        return true;
    }

    /**
     * @return array<int, array{name: string, size: int}>
     */
    public function texturepackFiles(): array
    {
        $path = $this->texturepacksPath();

        if (! is_dir($path)) {
            return [];
        }

        $files = [];
        foreach ((array) glob($path.'/*.pack') as $file) {
            if (! is_string($file)) {
                continue;
            }
            $files[] = [
                'name' => basename($file),
                'size' => (int) filesize($file),
            ];
        }

        return $files;
    }

    /**
     * Return the last captured pzmap2dzi log tail (used for richer error messages).
     */
    public function lastErrorTail(): ?string
    {
        return $this->lastErrorTail;
    }

    private function baseTilesPath(): string
    {
        return rtrim(config('zomboid.map.tiles_path'), '/').'/html/map_data/base/layer0_files';
    }

    /**
     * Execute a pzmap2dzi subcommand with the generated config.
     */
    private function runPzmap(string $subcommand, ?int $workers = null): bool
    {
        $pzmap2dziPath = $this->pzmap2dziPath();

        if (! is_file($pzmap2dziPath)) {
            Log::error('pzmap2dzi entry script missing', ['path' => $pzmap2dziPath]);

            return false;
        }

        $confPath = $this->ensureGeneratedConfig($workers);
        $pzmap2dziDir = dirname($pzmap2dziPath);
        $logFile = storage_path('logs/pzmap2dzi.log');
        $stepLog = storage_path('logs/pzmap2dzi_live.log');
        @file_put_contents($stepLog, '');

        $command = sprintf(
            'cd %s && python3 %s -c %s %s > %s 2>&1',
            escapeshellarg($pzmap2dziDir),
            escapeshellarg($pzmap2dziPath),
            escapeshellarg($confPath),
            $subcommand,
            escapeshellarg($stepLog),
        );

        $result = 0;
        exec($command, $output, $result);

        $stepContent = is_file($stepLog) ? (string) file_get_contents($stepLog) : '';

        if ($stepContent !== '') {
            file_put_contents($logFile, $stepContent, FILE_APPEND);
        }

        if (is_file($stepLog)) {
            @unlink($stepLog);
        }

        if ($result !== 0 || str_contains($stepContent, 'Traceback') || str_contains($stepContent, 'invalid texture_path')) {
            $this->lastErrorTail = $this->tailLog($stepContent);

            Log::error('pzmap2dzi command failed', [
                'subcommand' => $subcommand,
                'exit_code' => $result,
                'tail' => $this->lastErrorTail,
            ]);

            return false;
        }

        $this->lastErrorTail = null;

        return true;
    }

    /**
     * Return the last meaningful lines of a pzmap2dzi step log.
     */
    private function tailLog(string $content): string
    {
        $lines = array_filter(
            preg_split('/\r?\n/', trim($content)) ?: [],
            static fn (string $line): bool => $line !== '',
        );

        $tail = array_slice($lines, -10);

        return implode("\n", $tail);
    }

    /**
     * Write the pzmap2dzi YAML config inside pzmap2dzi/conf/ and return its absolute path.
     */
    private function ensureGeneratedConfig(?int $workers = null): string
    {
        $serverPath = config('zomboid.game_server_path');
        $tilesPath = config('zomboid.map.tiles_path');
        $texturepacks = $this->texturepacksPath();
        $dataPath = rtrim(config('zomboid.paths.data', '/pz-data'), '/');
        $modRoot = $serverPath.'/steamapps/workshop/content/108600';
        $saveGameRoot = $dataPath.'/Saves';
        $workerCount = max(1, (int) ($workers ?? $this->detectCpuCores()));

        $setting = MapRenderSetting::instance();
        $tileSize = $setting->effectiveTileSize();
        $omitLevels = $setting->effectiveOmitLevels();

        $this->writeVanillaOverride($serverPath, $texturepacks);

        $config = <<<YAML
        pz_root: |-
            {$serverPath}

        output_root: |-
            {$tilesPath}

        mod_root: |-
            {$modRoot}

        custom_root: |-
            .

        save_game_root: |-
            {$saveGameRoot}

        output_entry: default
        output_route: map_data/

        map_conf_default: default.txt
        map_conf:
            - generated-vanilla.txt

        use_depend_texture_only: false

        base_map: default

        save_games: all

        render_conf:
            verbose: true
            profile: false
            worker_count: {$workerCount}
            break_key: ''
            tile_size: {$tileSize}
            tile_align_levels: 3
            layer_range: [0, 1]
            hash_method: null
            cell_range: all
            omit_levels: {$omitLevels}
            image_fmt: jpg
            image_fmt_base_layer0: jpg
            image_save_options: {}
            enable_cache: false
            cache_limit_mb: 0
            top_view_square_size: 1
            top_view_color_mode: avg
            use_mark: false
            zombie_count: false
            default_font: arial.ttf
            default_font_size: 20
            save_game_parser_tag: latest
            save_game_parser_path: ''
            plants_conf:
                snow: false
                large_bush: false
                flower: false
                season: summer2
                tree_size: 2
                jumbo_tree_size: 4
                jumbo_tree_type: 1
                no_ground_cover: false
                unify_tree_type: 0
        YAML;

        $confDir = dirname($this->pzmap2dziPath()).'/conf';

        if (! is_dir($confDir)) {
            mkdir($confDir, 0755, true);
        }

        $confPath = $confDir.'/generated.yaml';
        file_put_contents($confPath, $config);

        return $confPath;
    }

    private function detectCpuCores(): int
    {
        if (is_readable('/proc/cpuinfo')) {
            return max(1, substr_count((string) file_get_contents('/proc/cpuinfo'), 'processor'));
        }

        return 4;
    }

    /**
     * Write a map config override that points texture_path to our writable directory.
     */
    private function writeVanillaOverride(string $serverPath, string $texturepacksPath): void
    {
        $confDir = dirname($this->pzmap2dziPath()).'/conf';

        if (! is_dir($confDir)) {
            mkdir($confDir, 0755, true);
        }

        $vanilla = <<<YAML
        # generated-vanilla — autogenerated, do not edit by hand.
        # Overrides texture_path so pzmap2dzi reads texturepacks from a writable volume
        # instead of the read-only dedicated-server media directory.
        default:
            map_path: '{$serverPath}/media/maps/Muldraugh, KY'
            texture: true
            texture_path: '{$texturepacksPath}'
            texture_files:
                - Tiles2x[.]floor.pack
                - JumboTrees2x[.]pack
                - Overlays2x[.]pack
                - Tiles2x[.]pack
        YAML;

        file_put_contents($confDir.'/generated-vanilla.txt', $vanilla);
    }
}
