<?php

namespace App\Services;

use RuntimeException;

class ConfigStateManager
{
    /**
     * Settings that configure-server.sh overwrites from env vars on startup.
     * Only these keys are persisted to .config_state.
     *
     * RCON settings are excluded — changing them via UI without updating
     * Laravel's .env would break API connectivity.
     *
     * @var string[]
     */
    private const PERSISTABLE_KEYS = [
        'DefaultPort',
        'UDPPort',
        'MaxPlayers',
        'Map',
        'Public',
        'PauseEmpty',
        'SaveWorldEveryMinutes',
        'SteamVAC',
        'Open',
        'AutoCreateUserInWhiteList',
        'Password',
        'AdminPassword',
    ];

    /**
     * Persist web-UI config changes to .config_state so they survive container restarts.
     *
     * Only keys in the PERSISTABLE_KEYS allowlist are written. Multiple calls
     * merge into the existing state file (later values overwrite earlier ones).
     *
     * @param  array<string, string>  $settings  Keys changed by the user
     * @param  string  $iniPath  Path to the server.ini file (used to derive state file location)
     */
    public function persistSettings(array $settings, string $iniPath): void
    {
        $persistable = array_intersect_key($settings, array_flip(self::PERSISTABLE_KEYS));

        if ($persistable === []) {
            return;
        }

        $stateFile = $this->stateFilePath($iniPath);
        $stateDir = dirname($stateFile);
        $lockFile = $stateFile.'.lock';

        // Use flock() to prevent concurrent read-modify-write races
        $lockHandle = fopen($lockFile, 'c');

        if ($lockHandle === false) {
            throw new RuntimeException("Unable to open lock file $lockFile.");
        }

        try {
            if (! flock($lockHandle, LOCK_EX)) {
                throw new RuntimeException("Unable to acquire lock on $lockFile.");
            }

            // Merge with existing state so partial updates accumulate.
            // Filter existing keys by allowlist to discard any polluted entries.
            $existing = array_intersect_key($this->readStateFile($stateFile), array_flip(self::PERSISTABLE_KEYS));
            $merged = array_merge($existing, $persistable);

            $lines = [];
            foreach ($merged as $key => $value) {
                $safeValue = str_replace(["\n", "\r"], '', (string) $value);
                $lines[] = "$key=$safeValue";
            }

            $contents = implode("\n", $lines)."\n";

            // Atomic write: tempfile → rename
            $tempFile = tempnam($stateDir, '.config_state.');

            if ($tempFile === false) {
                throw new RuntimeException("Unable to create temporary config state file in $stateDir.");
            }

            try {
                if (file_put_contents($tempFile, $contents) === false) {
                    throw new RuntimeException("Unable to write temporary config state file $tempFile.");
                }

                if (! rename($tempFile, $stateFile)) {
                    throw new RuntimeException("Unable to atomically replace config state file $stateFile.");
                }

                chmod($stateFile, 0644);
            } finally {
                if (is_file($tempFile)) {
                    @unlink($tempFile);
                }
            }
        } finally {
            flock($lockHandle, LOCK_UN);
            fclose($lockHandle);
        }
    }

    /**
     * @return array<string, string>
     */
    private function readStateFile(string $path): array
    {
        if (! is_file($path)) {
            return [];
        }

        $lines = file($path, FILE_IGNORE_NEW_LINES);

        if ($lines === false) {
            return [];
        }

        $data = [];
        foreach ($lines as $line) {
            if ($line === '' || ! str_contains($line, '=')) {
                continue;
            }
            [$key, $value] = explode('=', $line, 2);
            $data[trim($key)] = $value;
        }

        return $data;
    }

    private function stateFilePath(string $iniPath): string
    {
        return dirname($iniPath, 2).'/.config_state';
    }
}
