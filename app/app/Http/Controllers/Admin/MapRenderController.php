<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\BuildAtlasRequest;
use App\Http\Requests\Admin\UpdateMapRenderQualityRequest;
use App\Http\Requests\Admin\UpdateMapRenderScheduleRequest;
use App\Http\Requests\Admin\UploadTexturepacksRequest;
use App\Models\MapRenderSetting;
use App\Services\AuditLogger;
use App\Services\MapRenderService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use ZipArchive;

class MapRenderController extends Controller
{
    public function __construct(
        private readonly MapRenderService $renderer,
        private readonly AuditLogger $auditLogger,
    ) {}

    public function enableEngine(Request $request): JsonResponse
    {
        if (! $this->renderer->isEngineInstalled()) {
            return response()->json([
                'message' => 'Render engine binary (pzmap2dzi) is not installed in this container.',
            ], 503);
        }

        $setting = MapRenderSetting::instance();
        $setting->engine_enabled = true;
        $setting->save();

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'map.render.engine_enabled',
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Render engine enabled']);
    }

    public function disableEngine(Request $request): JsonResponse
    {
        $setting = MapRenderSetting::instance();
        $setting->engine_enabled = false;
        $setting->save();

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'map.render.engine_disabled',
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Render engine disabled']);
    }

    public function startRender(Request $request): JsonResponse
    {
        if (! $this->renderer->isEngineEnabled()) {
            return response()->json(['message' => 'Render engine is disabled.'], 422);
        }

        if (! $this->renderer->isEngineInstalled()) {
            return response()->json(['message' => 'pzmap2dzi binary is missing from the container.'], 503);
        }

        if ($this->renderer->isRendering()) {
            return response()->json(['message' => 'A render is already in progress.'], 409);
        }

        $this->renderer->dispatchRender($request->user()->name ?? 'admin', $request->ip());

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'map.render.started',
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Render queued']);
    }

    public function pauseRender(Request $request): JsonResponse
    {
        if (! $this->renderer->isRendering()) {
            return response()->json(['message' => 'No render is currently running.'], 422);
        }

        if ($this->renderer->isPaused()) {
            return response()->json(['message' => 'Render is already paused.'], 422);
        }

        if (! $this->renderer->pauseRender()) {
            return response()->json(['message' => 'Failed to pause the queue container via Docker API.'], 500);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'map.render.paused',
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Render paused']);
    }

    public function resumeRender(Request $request): JsonResponse
    {
        if (! $this->renderer->isPaused()) {
            return response()->json(['message' => 'Render is not paused.'], 422);
        }

        if (! $this->renderer->resumeRender()) {
            return response()->json(['message' => 'Failed to resume the queue container via Docker API.'], 500);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'map.render.resumed',
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Render resumed']);
    }

    public function cancelRender(Request $request): JsonResponse
    {
        if (! $this->renderer->isRendering()) {
            return response()->json(['message' => 'No render is currently running.'], 422);
        }

        $this->renderer->requestCancel();
        $killed = $this->renderer->killRenderProcesses();

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'map.render.cancel_requested',
            details: ['kill_dispatched' => $killed],
            ip: $request->ip(),
        );

        return response()->json([
            'message' => $killed
                ? 'Cancel issued — pzmap2dzi processes were killed inside the queue container.'
                : 'Cancel flagged, but kill via Docker exec failed (check logs). The job will stop at the next stage boundary instead.',
            'kill_dispatched' => $killed,
        ]);
    }

    public function uploadTexturepacks(UploadTexturepacksRequest $request): JsonResponse
    {
        if ($this->renderer->isRendering()) {
            return response()->json(['message' => 'A render is in progress — cannot replace texturepacks now.'], 409);
        }

        $destination = $this->renderer->texturepacksPath();

        if (! is_dir($destination)) {
            if (! @mkdir($destination, 0755, true) && ! is_dir($destination)) {
                return response()->json(['message' => "Cannot create texturepacks directory at {$destination}"], 500);
            }
        }

        $required = ['Tiles2x.floor.pack', 'JumboTrees2x.pack', 'Overlays2x.pack', 'Tiles2x.pack'];
        $extracted = [];

        if ($request->hasFile('archive')) {
            $file = $request->file('archive');
            $extracted = $this->extractArchive($file->getRealPath(), $file->getClientOriginalName(), $destination);
            if ($extracted === null) {
                return response()->json(['message' => 'Could not extract uploaded archive.'], 422);
            }
        }

        if ($request->hasFile('files')) {
            foreach ((array) $request->file('files') as $packFile) {
                $basename = basename($packFile->getClientOriginalName());
                if (str_contains($basename, '..') || ! str_ends_with(strtolower($basename), '.pack')) {
                    continue;
                }
                $packFile->move($destination, $basename);
                $extracted[] = $basename;
            }
        }

        $existing = array_map('basename', (array) glob($destination.'/*.pack'));
        $missing = array_values(array_diff($required, $existing));

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'map.render.texturepacks_uploaded',
            details: ['extracted' => count($extracted), 'missing_required' => $missing],
            ip: $request->ip(),
        );

        if ($missing !== []) {
            return response()->json([
                'message' => 'Uploaded but required pack files still missing: '.implode(', ', $missing).'. Загрузите и их тоже.',
                'extracted' => $extracted,
                'missing_required' => $missing,
            ], 200);
        }

        return response()->json([
            'message' => 'Texturepacks uploaded',
            'extracted' => $extracted,
        ]);
    }

    /**
     * Сохраняет custom URL для скачивания atlas tarball в MapRenderSetting.
     * Пустая строка / null сбрасывает override → используется env/config.
     */
    public function updateAtlasUrl(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'atlas_download_url' => ['nullable', 'string', 'max:500', 'url:http,https'],
        ]);

        $setting = MapRenderSetting::instance();
        $setting->atlas_download_url = $validated['atlas_download_url'] ?? null;
        $setting->save();

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'map.atlas.url_updated',
            details: ['atlas_download_url' => $setting->atlas_download_url],
            ip: $request->ip(),
        );

        return response()->json([
            'message' => 'Atlas download URL updated',
            'effective_url' => $setting->effectiveAtlasDownloadUrl(),
        ]);
    }

    /**
     * Извлекает .pack файлы из uploaded архива (.zip или .tar.gz/.tgz).
     * Возвращает список basename'ов извлечённых файлов, или null при ошибке.
     *
     * @return array<int, string>|null
     */
    private function extractArchive(string $sourcePath, string $clientName, string $destination): ?array
    {
        $extracted = [];
        $lowerName = strtolower($clientName);

        if (str_ends_with($lowerName, '.zip')) {
            $zip = new ZipArchive;
            if ($zip->open($sourcePath) !== true) {
                return null;
            }
            for ($i = 0; $i < $zip->numFiles; $i++) {
                $entry = $zip->statIndex($i);
                $name = $entry['name'] ?? '';
                if ($name === '' || str_ends_with($name, '/')) {
                    continue;
                }
                $basename = basename($name);
                if (str_contains($basename, '..') || str_contains($name, "\0")) {
                    continue;
                }
                if (! str_ends_with(strtolower($basename), '.pack')) {
                    continue;
                }
                $stream = $zip->getStream($name);
                if ($stream === false) {
                    continue;
                }
                $out = @fopen($destination.'/'.$basename, 'wb');
                if ($out === false) {
                    fclose($stream);

                    continue;
                }
                stream_copy_to_stream($stream, $out);
                fclose($out);
                fclose($stream);
                $extracted[] = $basename;
            }
            $zip->close();

            return $extracted;
        }

        if (str_ends_with($lowerName, '.tar.gz') || str_ends_with($lowerName, '.tgz')) {
            $cmd = sprintf(
                'tar -xzf %s -C %s --strip-components=0 --wildcards "*.pack" 2>&1',
                escapeshellarg($sourcePath),
                escapeshellarg($destination),
            );
            $output = [];
            $exitCode = 0;
            exec($cmd, $output, $exitCode);
            if ($exitCode !== 0) {
                return null;
            }
            $extracted = array_map('basename', (array) glob($destination.'/*.pack'));

            return array_values(array_filter($extracted, 'is_string'));
        }

        return null;
    }

    /**
     * Возвращает статус установки WebGL атласа: есть ли manifest.json на
     * диске, текущий effective URL для скачивания, идёт ли download прямо
     * сейчас. Используется фронтом для показа AtlasNotInstalledPanel когда
     * /pz-atlas/manifest.json возвращает 404.
     */
    public function atlasStatus(): JsonResponse
    {
        $tilesPath = rtrim((string) config('zomboid.map.tiles_path', '/map-tiles'), '/');
        $manifestPath = $tilesPath.'/web/manifest.json';
        $setting = MapRenderSetting::instance();

        $downloadLog = storage_path('logs/atlas-download.log');
        $buildLog = storage_path('logs/atlas-build.log');

        $tailOf = static function (string $path): ?string {
            if (! is_file($path)) {
                return null;
            }

            return mb_substr((string) @file_get_contents($path), -3000);
        };

        $isProcessRunning = static function (string $needle): bool {
            $output = [];
            @exec('pgrep -f '.escapeshellarg($needle).' 2>/dev/null', $output);

            return ! empty($output);
        };

        $texturepacksPath = $this->renderer->texturepacksPath();
        $texturepacks = is_dir($texturepacksPath)
            ? array_values(array_filter((array) glob($texturepacksPath.'/*.pack'), 'is_string'))
            : [];

        $buildLogMtime = is_file($buildLog) ? (int) @filemtime($buildLog) : 0;
        $buildLogAge = $buildLogMtime > 0 ? time() - $buildLogMtime : null;
        $downloadLogMtime = is_file($downloadLog) ? (int) @filemtime($downloadLog) : 0;
        $downloadLogAge = $downloadLogMtime > 0 ? time() - $downloadLogMtime : null;

        return response()->json([
            'installed' => is_file($manifestPath),
            'effective_url' => $setting->effectiveAtlasDownloadUrl(),
            'custom_url' => $setting->atlas_download_url,
            'default_url' => (string) config('zomboid.map.atlas_download_url'),
            'downloading' => $isProcessRunning('zomboid:download-atlas'),
            'building' => $isProcessRunning('pzpack_to_atlas')
                || $isProcessRunning('zomboid:build-atlas'),
            'download_log_tail' => $tailOf($downloadLog),
            'build_log_tail' => $tailOf($buildLog),
            'build_log_age_sec' => $buildLogAge,
            'download_log_age_sec' => $downloadLogAge,
            'texturepacks_count' => count($texturepacks),
            'texturepacks_names' => array_map('basename', $texturepacks),
        ]);
    }

    /**
     * Запускает фоновое построение atlas из texturepacks через artisan-команду.
     * Возвращает сразу — статус опрашивается через atlasStatus.
     */
    /**
     * Убивает текущий atlas build (process pzpack_to_atlas.py + parent PHP
     * artisan zomboid:build-atlas). Используется через UI Cancel button.
     */
    public function cancelBuildAtlas(Request $request): JsonResponse
    {
        $killed = [];
        foreach (['pzpack_to_atlas', 'zomboid:build-atlas'] as $needle) {
            $output = [];
            @exec('pgrep -f '.escapeshellarg($needle).' 2>/dev/null', $output);
            foreach ($output as $pid) {
                $pid = (int) trim((string) $pid);
                if ($pid > 1) {
                    @exec('kill -9 '.$pid.' 2>&1');
                    $killed[] = ['needle' => $needle, 'pid' => $pid];
                }
            }
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'map.atlas.build_cancelled',
            details: ['killed' => $killed],
            ip: $request->ip(),
        );

        return response()->json([
            'message' => $killed === []
                ? 'No active build process found.'
                : 'Build cancelled: killed '.count($killed).' process(es).',
            'killed' => $killed,
        ]);
    }

    /**
     * Standard preset = 2x map-related packs (vanilla + распространённые map-mods).
     * Exclude'ит UI/Icons/Mechanics/Clock что не нужны для карты, но включает
     * Apartment Complex / Blair / Bedford Falls / Eerie Country.
     *
     * @return list<string>
     */
    private const STANDARD_INCLUDE_PATTERNS = [
        'Tiles2x',
        'JumboTrees2x',
        'Overlays2x',
        'DepthMaps2x',
        'B42ChunkCaching2x',
        'blair',
        'ApCom',
        'bedford',
        'eerie',
    ];

    public function buildAtlas(BuildAtlasRequest $request): JsonResponse
    {
        if (! $this->renderer->hasTexturepacks()) {
            return response()->json([
                'message' => 'No texturepacks uploaded. Загрузите .pack файлы с клиента PZ '
                    .'(media/texturepacks из директории игры).',
            ], 422);
        }

        $preset = $request->preset();

        $extraArgs = match ($preset) {
            'minimal' => '',  // default filter в скрипте = vanilla 4 packs
            'standard' => implode(' ', array_map(
                static fn (string $p): string => '--include-pack '.escapeshellarg($p),
                self::STANDARD_INCLUDE_PATTERNS,
            )),
            'all' => '--all',
            default => '',
        };

        $cmd = sprintf(
            '(php %s zomboid:build-atlas %s > %s 2>&1 &)',
            escapeshellarg(base_path('artisan')),
            $extraArgs,
            escapeshellarg(storage_path('logs/atlas-build.log')),
        );
        @shell_exec($cmd);

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'map.atlas.build_started',
            details: ['preset' => $preset],
            ip: $request->ip(),
        );

        return response()->json([
            'message' => 'Atlas build started (preset: '.$preset.').',
            'preset' => $preset,
        ]);
    }

    public function downloadAtlas(Request $request): JsonResponse
    {
        $force = (bool) $request->boolean('force');
        $setting = MapRenderSetting::instance();
        $url = $setting->effectiveAtlasDownloadUrl();

        if ($url === null) {
            return response()->json([
                'message' => 'Atlas download URL не задан. Установите его в настройках или через PZ_MAP_ATLAS_DOWNLOAD_URL env.',
            ], 422);
        }

        // Запускаем команду в фоне, ответ не блокируется на 700 MB скачивании.
        $cmd = sprintf(
            '(php %s zomboid:download-atlas %s > %s 2>&1 &)',
            escapeshellarg(base_path('artisan')),
            $force ? '--force' : '',
            escapeshellarg(storage_path('logs/atlas-download.log')),
        );
        @shell_exec($cmd);

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'map.atlas.download_started',
            details: ['url' => $url, 'force' => $force],
            ip: $request->ip(),
        );

        return response()->json([
            'message' => 'Atlas download started in background. Watch storage/logs/atlas-download.log',
            'url' => $url,
        ]);
    }

    public function deleteTexturepacks(Request $request): JsonResponse
    {
        if ($this->renderer->isRendering()) {
            return response()->json(['message' => 'A render is in progress — cannot remove texturepacks now.'], 409);
        }

        $path = $this->renderer->texturepacksPath();

        if (is_dir($path)) {
            foreach ((array) glob($path.'/*.pack') as $file) {
                if (is_string($file) && is_file($file)) {
                    @unlink($file);
                }
            }
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'map.render.texturepacks_deleted',
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Texturepacks removed']);
    }

    public function updateQuality(UpdateMapRenderQualityRequest $request): JsonResponse
    {
        if ($this->renderer->isRendering()) {
            return response()->json(['message' => 'A render is in progress — cannot change quality settings now.'], 409);
        }

        $validated = $request->validated();
        $setting = MapRenderSetting::instance();

        $setting->quality_preset = $validated['quality_preset'];
        $setting->custom_tile_size = $validated['quality_preset'] === 'custom'
            ? ($validated['custom_tile_size'] ?? null)
            : null;
        $setting->custom_omit_levels = $validated['quality_preset'] === 'custom'
            ? ($validated['custom_omit_levels'] ?? null)
            : null;
        $setting->save();

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'map.render.quality_updated',
            details: [
                'preset' => $setting->quality_preset,
                'tile_size' => $setting->effectiveTileSize(),
                'omit_levels' => $setting->effectiveOmitLevels(),
            ],
            ip: $request->ip(),
        );

        return response()->json([
            'message' => 'Quality settings updated',
            'effective_tile_size' => $setting->effectiveTileSize(),
            'effective_omit_levels' => $setting->effectiveOmitLevels(),
        ]);
    }

    public function updateSchedule(UpdateMapRenderScheduleRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $setting = MapRenderSetting::instance();

        $setting->schedule_preset = $validated['schedule_preset'];
        $setting->cron_expression = $validated['schedule_preset'] === 'custom'
            ? ($validated['cron_expression'] ?? null)
            : null;
        $setting->save();

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'map.render.schedule_updated',
            details: [
                'preset' => $setting->schedule_preset,
                'cron_expression' => $setting->cron_expression,
            ],
            ip: $request->ip(),
        );

        return response()->json([
            'message' => 'Schedule updated',
            'effective_cron' => $setting->effectiveCronExpression(),
        ]);
    }
}
