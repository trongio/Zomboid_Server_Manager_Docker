<?php

namespace App\Console\Commands;

use App\Models\MapRenderSetting;
use App\Services\AuditLogger;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;
use PharData;

/**
 * Скачивает prebuilt WebGL atlas tarball (gzip'd tar) и атомарно
 * распаковывает в config('zomboid.map.tiles_path').'/web'.
 *
 * Источник URL:
 *   1. --url= параметр командной строки
 *   2. MapRenderSetting.atlas_download_url (DB-настройка через админ UI)
 *   3. config('zomboid.map.atlas_download_url') (env PZ_MAP_ATLAS_DOWNLOAD_URL)
 *
 * Tarball должен содержать manifest.json, sprites.json, cell-pages.json
 * и набор atlas-vXXX-N-lodL.webp/.ktx2 в корне (структура `/map-tiles/web/`).
 */
class DownloadAtlasCommand extends Command
{
    /** @var string */
    protected $signature = 'zomboid:download-atlas
        {--url= : Override download URL (otherwise DB setting → env → default)}
        {--force : Перезаписать существующие атласы}';

    /** @var string */
    protected $description = 'Скачать prebuilt WebGL atlas tarball и распаковать в /map-tiles/web';

    public function __construct(private readonly AuditLogger $auditLogger)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        $setting = MapRenderSetting::instance();
        $url = (string) ($this->option('url') ?: $setting->effectiveAtlasDownloadUrl());

        if ($url === '') {
            $this->error('Atlas download URL не задан. Укажите --url= или установите PZ_MAP_ATLAS_DOWNLOAD_URL.');

            return self::FAILURE;
        }

        $tilesPath = rtrim((string) config('zomboid.map.tiles_path', '/map-tiles'), '/');
        $webDir = $tilesPath.'/web';
        $manifestPath = $webDir.'/manifest.json';

        if (is_file($manifestPath) && ! $this->option('force')) {
            $this->warn("Атласы уже установлены в {$webDir} (есть manifest.json).");
            $this->line('Используйте --force для перезаписи.');

            return self::SUCCESS;
        }

        $this->line('Источник: '.$url);
        $tmpFile = tempnam(sys_get_temp_dir(), 'atlas-').'.tar.gz';

        try {
            $this->line('Скачивание…');
            $start = microtime(true);
            $response = Http::timeout(600)
                ->connectTimeout(15)
                ->withOptions([
                    'sink' => $tmpFile,
                    'progress' => function ($total, $downloaded) {
                        if ($total > 0) {
                            $pct = round(($downloaded / $total) * 100, 1);
                            $this->output->write("\r  {$pct}% (".$this->humanBytes($downloaded).' / '.$this->humanBytes($total).')   ');
                        }
                    },
                ])
                ->get($url);

            $this->output->writeln('');

            if (! $response->successful()) {
                $this->error('Сервер ответил '.$response->status());

                return self::FAILURE;
            }

            $size = filesize($tmpFile) ?: 0;
            $this->info('Скачано '.$this->humanBytes($size).' за '.round(microtime(true) - $start, 1).'s');

            $this->line('Распаковка…');
            $stagingDir = $tilesPath.'/web-new-'.bin2hex(random_bytes(4));
            if (! mkdir($stagingDir, 0775, true) && ! is_dir($stagingDir)) {
                $this->error('Не могу создать staging директорию: '.$stagingDir);

                return self::FAILURE;
            }

            // Стримим через системный tar чтобы не держать 700+ MB архив
            // в PHP памяти (PharData загружает весь файл — упирается в memory_limit).
            $tarCmd = sprintf(
                'tar -xzf %s -C %s 2>&1',
                escapeshellarg($tmpFile),
                escapeshellarg($stagingDir),
            );
            $tarOutput = [];
            $tarExit = 0;
            exec($tarCmd, $tarOutput, $tarExit);
            if ($tarExit !== 0) {
                $this->error('tar -xzf завершилась с кодом '.$tarExit);
                $this->line(implode("\n", array_slice($tarOutput, -10)));
                $this->cleanup($tmpFile, $stagingDir);

                return self::FAILURE;
            }

            if (! is_file($stagingDir.'/manifest.json')) {
                $this->error('В архиве нет manifest.json — формат неверный.');
                $this->cleanup($tmpFile, $stagingDir);

                return self::FAILURE;
            }

            // Атомарный swap: web → web-old, web-new → web.
            $backupDir = $tilesPath.'/web-old-'.date('Ymd-His');
            if (is_dir($webDir)) {
                if (! rename($webDir, $backupDir)) {
                    $this->error('Не могу переименовать старый web в backup.');
                    $this->cleanup($tmpFile, $stagingDir);

                    return self::FAILURE;
                }
            }

            if (! rename($stagingDir, $webDir)) {
                $this->error('Не могу переименовать staging в web. Восстанавливаю backup.');
                if (is_dir($backupDir)) {
                    @rename($backupDir, $webDir);
                }
                $this->cleanup($tmpFile, $stagingDir);

                return self::FAILURE;
            }

            // Чтение нового manifest для записи метаданных в DB.
            $manifest = json_decode((string) file_get_contents($manifestPath), true) ?: [];
            $setting->atlas_built_at = now();
            $setting->atlas_version = (string) ($manifest['version'] ?? 'unknown');
            $setting->atlas_size_bytes = $this->dirSize($webDir);
            $setting->atlas_sprite_count = (int) ($manifest['sprite_count'] ?? 0);
            $setting->atlas_page_count = (int) ($manifest['page_count'] ?? 0);
            $setting->atlas_lod_count = (int) ($manifest['lods'] ?? 1);
            $setting->atlas_has_ktx2 = (bool) ($manifest['ktx2'] ?? false);
            $setting->save();

            $this->info('Готово. Backup старых атласов: '.($backupDir !== null && is_dir($backupDir) ? $backupDir : 'нет'));

            $this->auditLogger->log(
                actor: 'cli',
                action: 'map.atlas.downloaded',
                details: ['url' => $url, 'size_bytes' => $size, 'version' => $setting->atlas_version],
                ip: '127.0.0.1',
            );

            @unlink($tmpFile);

            return self::SUCCESS;
        } catch (\Throwable $e) {
            $this->error('Ошибка: '.$e->getMessage());
            @unlink($tmpFile);

            return self::FAILURE;
        }
    }

    private function cleanup(string $tmpFile, string $stagingDir): void
    {
        @unlink($tmpFile);
        if (is_dir($stagingDir)) {
            $this->rmrf($stagingDir);
        }
    }

    private function rmrf(string $path): void
    {
        if (! is_dir($path)) {
            @unlink($path);

            return;
        }
        foreach (scandir($path) ?: [] as $entry) {
            if ($entry === '.' || $entry === '..') {
                continue;
            }
            $this->rmrf($path.'/'.$entry);
        }
        @rmdir($path);
    }

    private function dirSize(string $path): int
    {
        $total = 0;
        $iter = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator($path, \FilesystemIterator::SKIP_DOTS));
        foreach ($iter as $file) {
            if ($file->isFile()) {
                $total += $file->getSize();
            }
        }

        return $total;
    }

    private function humanBytes(int $bytes): string
    {
        $units = ['B', 'KB', 'MB', 'GB'];
        $i = 0;
        $v = (float) $bytes;
        while ($v >= 1024 && $i < count($units) - 1) {
            $v /= 1024;
            $i++;
        }

        return round($v, 1).' '.$units[$i];
    }
}
