<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Http;

class DownloadItemIcons extends Command
{
    /** @var string */
    protected $signature = 'zomboid:download-item-icons
        {--force : Re-download icons that already exist}
        {--catalog= : Path to items_catalog.json (default: from config)}
        {--concurrency=5 : Number of concurrent downloads}';

    /** @var string */
    protected $description = 'Download PZ item icons from PZwiki into public/images/items/';

    private const PZWIKI_URL = 'https://pzwiki.net/wiki/Special:FilePath/';

    public function handle(): int
    {
        $catalogPath = $this->option('catalog') ?: config('zomboid.lua_bridge.items_catalog');
        $outputDir = public_path('images/items');
        $force = (bool) $this->option('force');

        if (! file_exists($catalogPath)) {
            $this->error("Item catalog not found at: {$catalogPath}");
            $this->info('The Lua mod exports this file on server startup. Start the game server first.');

            return self::FAILURE;
        }

        $catalog = json_decode(file_get_contents($catalogPath), true);
        if (json_last_error() !== JSON_ERROR_NONE || ! isset($catalog['items'])) {
            $this->error('Failed to parse item catalog JSON.');

            return self::FAILURE;
        }

        if (! is_dir($outputDir)) {
            mkdir($outputDir, 0755, true);
        }

        $items = $catalog['items'];
        $total = count($items);
        $downloaded = 0;
        $skipped = 0;
        $failed = 0;

        $this->info("Downloading icons for {$total} items...");
        $bar = $this->output->createProgressBar($total);
        $bar->start();

        foreach ($items as $item) {
            $iconName = $item['icon_name'] ?? '';
            if ($iconName === '') {
                $bar->advance();
                $skipped++;

                continue;
            }

            $filename = $iconName.'.png';
            $outputPath = $outputDir.'/'.$filename;

            if (! $force && file_exists($outputPath)) {
                $bar->advance();
                $skipped++;

                continue;
            }

            $url = self::PZWIKI_URL.$filename;

            try {
                $response = Http::timeout(10)
                    ->withOptions(['allow_redirects' => true])
                    ->get($url);

                if ($response->successful() && str_starts_with($response->header('Content-Type'), 'image/')) {
                    file_put_contents($outputPath, $response->body());
                    $downloaded++;
                } else {
                    $failed++;
                }
            } catch (\Throwable) {
                $failed++;
            }

            $bar->advance();
        }

        $bar->finish();
        $this->newLine(2);

        $this->info("Downloaded: {$downloaded}");
        $this->info("Skipped (existing): {$skipped}");
        if ($failed > 0) {
            $this->warn("Failed: {$failed}");
        }

        return self::SUCCESS;
    }
}
