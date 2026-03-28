<?php

namespace App\Services;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class GameVersionReader
{
    private const CACHE_KEY = 'pz.game_version';

    private const CACHE_TTL = 86400;

    public function __construct(
        private readonly GameStateReader $gameStateReader,
        private readonly DockerManager $docker,
    ) {}

    /**
     * Detect the current game version from Lua bridge, console log, or Docker logs.
     */
    public function detectVersion(): ?string
    {
        // Primary: read from game_state.json (Lua bridge, updated every minute)
        $state = $this->gameStateReader->getGameState();
        if (! empty($state['game_version'])) {
            return $this->extractVersionNumber($state['game_version']);
        }

        // Secondary: parse server-console.txt (works with screen sessions)
        $consoleVersion = $this->detectVersionFromConsoleLog();
        if ($consoleVersion !== null) {
            return $consoleVersion;
        }

        // Last resort: parse Docker container logs for version string
        return $this->detectVersionFromLogs();
    }

    /**
     * Get cached game version without hitting filesystem/Docker.
     */
    public function getCachedVersion(): ?string
    {
        return Cache::get(self::CACHE_KEY);
    }

    /**
     * Detect version and cache it for 24 hours.
     */
    public function refreshVersion(): ?string
    {
        $version = $this->detectVersion();

        if ($version !== null) {
            Cache::put(self::CACHE_KEY, $version, self::CACHE_TTL);
        }

        return $version;
    }

    /**
     * Get the current Steam branch from override file or config fallback.
     */
    public function getCurrentBranch(): string
    {
        $overridePath = config('zomboid.paths.data').'/.steam_branch';

        if (file_exists($overridePath)) {
            $branch = trim((string) file_get_contents($overridePath));
            if ($branch !== '') {
                return $branch;
            }
        }

        return config('zomboid.steam_branch', 'public');
    }

    /**
     * Extract the numeric version from a full PZ version string.
     *
     * PZ's getCore():getVersion() returns strings like:
     * "42.15.3 aa7f064af2a82d8070ccc6c7fa7c11f89da23b06 2026-03-20 09:33:06 (ZB)"
     * This extracts just "42.15.3".
     */
    private function extractVersionNumber(string $raw): string
    {
        if (preg_match('/^([0-9]+\.[0-9]+(?:\.[0-9]+)*)/', trim($raw), $matches)) {
            return $matches[1];
        }

        return trim($raw);
    }

    /**
     * Parse PZ's server-console.txt for version string.
     *
     * More reliable than Docker logs since PZ runs inside a screen session.
     */
    private function detectVersionFromConsoleLog(): ?string
    {
        $path = config('zomboid.paths.data').'/server-console.txt';

        if (! file_exists($path)) {
            return null;
        }

        try {
            $fp = fopen($path, 'r');
            if ($fp === false) {
                return null;
            }

            $chunk = fread($fp, 4096);
            fclose($fp);

            if ($chunk === false) {
                return null;
            }

            if (preg_match('/version\s*=\s*([0-9]+\.[0-9]+(?:\.[0-9]+)*)/', $chunk, $matches)) {
                return $matches[1];
            }
        } catch (\Throwable $e) {
            Log::debug('GameVersionReader: failed to read server-console.txt', [
                'error' => $e->getMessage(),
            ]);
        }

        return null;
    }

    /**
     * Parse Docker container logs for PZ version pattern.
     */
    private function detectVersionFromLogs(): ?string
    {
        try {
            $lines = $this->docker->getContainerLogs(200);
        } catch (\Throwable $e) {
            Log::debug('GameVersionReader: failed to read Docker logs', [
                'error' => $e->getMessage(),
            ]);

            return null;
        }

        // PZ logs version as "versionNumber=42.0.3" or similar patterns
        foreach (array_reverse($lines) as $line) {
            if (preg_match('/versionNumber\s*=\s*([0-9]+\.[0-9]+(?:\.[0-9]+)*)/', $line, $matches)) {
                return $matches[1];
            }
        }

        return null;
    }
}
