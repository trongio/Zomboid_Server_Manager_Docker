<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;

/**
 * Bump the version field in /map-tiles/web/manifest.json when any save-game
 * binary file has been modified since the last check.
 *
 * The browser-side `useAtlasVersionPoll` hook polls manifest.json every 30 s.
 * When it detects a version change it invalidates the save-data cache so that
 * newly built player structures appear without a full page reload.
 *
 * The version field is a Unix timestamp (seconds) so it is monotonically
 * increasing and trivially comparable by the frontend.
 */
class BumpMapVersionCommand extends Command
{
    /** @var string */
    protected $signature = 'zomboid:bump-map-version';

    /** @var string */
    protected $description = 'Bump manifest.json version when save-game files have changed';

    public function handle(): int
    {
        $webDir = rtrim((string) config('zomboid.map.tiles_path', '/map-tiles'), '/').'/web';
        $manifest = $webDir.'/manifest.json';

        if (! is_file($manifest)) {
            // Atlas has not been built yet — nothing to bump
            return self::SUCCESS;
        }

        $saveRoot = $this->saveRoot();

        if (! is_dir($saveRoot)) {
            return self::SUCCESS;
        }

        // Find the latest mtime of any .bin save file
        $latestSaveMtime = $this->latestSaveMtime($saveRoot);

        if ($latestSaveMtime === null) {
            return self::SUCCESS;
        }

        // Read current manifest
        $json = file_get_contents($manifest);
        if ($json === false) {
            $this->error("Cannot read manifest: {$manifest}");

            return self::FAILURE;
        }

        /** @var array<string,mixed>|null $data */
        $data = json_decode($json, true);
        if (! is_array($data)) {
            $this->error('manifest.json is not valid JSON');

            return self::FAILURE;
        }

        // Use cache-stored mtime to detect changes without touching the manifest
        $cacheKey = 'zomboid.map.last_save_mtime';
        $lastKnownMtime = (int) cache()->get($cacheKey, 0);

        if ($latestSaveMtime <= $lastKnownMtime) {
            // No save files changed since last run
            return self::SUCCESS;
        }

        // Bump version to current timestamp
        $newVersion = 'v'.time();
        $data['version'] = $newVersion;
        $written = file_put_contents($manifest, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES)."\n");

        if ($written === false) {
            $this->error("Cannot write manifest: {$manifest}");

            return self::FAILURE;
        }

        cache()->put($cacheKey, $latestSaveMtime, now()->addDay());

        $this->info("Bumped manifest version to {$newVersion} (save mtime: {$latestSaveMtime})");

        return self::SUCCESS;
    }

    private function saveRoot(): string
    {
        $dataPath = rtrim((string) config('zomboid.paths.data', '/pz-data'), '/');
        $serverName = (string) config('zomboid.server_name', 'ZomboidServer');

        return $dataPath.'/Saves/Multiplayer/'.$serverName.'/map';
    }

    /**
     * Recursively find the highest mtime of any .bin file under $dir.
     * Returns null if no .bin files exist.
     */
    private function latestSaveMtime(string $dir): ?int
    {
        $latest = null;

        try {
            $iterator = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS),
            );

            foreach ($iterator as $file) {
                /** @var \SplFileInfo $file */
                if ($file->getExtension() !== 'bin') {
                    continue;
                }

                $mtime = $file->getMTime();
                if ($latest === null || $mtime > $latest) {
                    $latest = $mtime;
                }
            }
        } catch (\Throwable) {
            return null;
        }

        return $latest;
    }
}
