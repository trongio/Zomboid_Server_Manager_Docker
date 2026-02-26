<?php

namespace App\Services;

class ServerIniParser
{
    /**
     * Parse a PZ server.ini file into an associative array.
     *
     * @return array<string, string>
     */
    public function read(string $path): array
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
            if ($line === '' || str_starts_with($line, '#')) {
                continue;
            }

            if (! str_contains($line, '=')) {
                continue;
            }

            [$key, $value] = explode('=', $line, 2);
            $data[trim($key)] = $value;
        }

        return $data;
    }

    /**
     * Write an associative array back to a PZ server.ini file.
     * Only updates keys that exist in $updates, preserving all other lines.
     *
     * @param  array<string, string>  $updates
     */
    public function write(string $path, array $updates): void
    {
        if (! is_file($path)) {
            throw new \RuntimeException("Config file not found: {$path}");
        }

        $lines = file($path, FILE_IGNORE_NEW_LINES);

        if ($lines === false) {
            throw new \RuntimeException("Failed to read config file: {$path}");
        }

        $updatedKeys = [];
        $newLines = [];

        foreach ($lines as $line) {
            if ($line !== '' && ! str_starts_with($line, '#') && str_contains($line, '=')) {
                [$key] = explode('=', $line, 2);
                $key = trim($key);

                if (array_key_exists($key, $updates)) {
                    $newLines[] = "{$key}={$updates[$key]}";
                    $updatedKeys[] = $key;

                    continue;
                }
            }

            $newLines[] = $line;
        }

        // Append any new keys that didn't exist in the file
        foreach ($updates as $key => $value) {
            if (! in_array($key, $updatedKeys, true)) {
                $newLines[] = "{$key}={$value}";
            }
        }

        file_put_contents($path, implode("\n", $newLines)."\n");
    }
}
