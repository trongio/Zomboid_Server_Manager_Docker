<?php

namespace App\Services;

use App\Models\GameEvent;
use Illuminate\Support\Facades\Cache;

class LogExtenderParser
{
    private string $logsDir;

    public function __construct(?string $logsDir = null)
    {
        $this->logsDir = $logsDir ?? (config('zomboid.paths.data', '/pz-data').'/Logs');
    }

    /**
     * Parse all supported Log Extender files and insert new events.
     *
     * @return int Total events inserted
     */
    public function parseAll(): int
    {
        if (! is_dir($this->logsDir)) {
            return 0;
        }

        $total = 0;
        $total += $this->parsePlayerLog();
        $total += $this->parsePvpLog();
        $total += $this->parseCraftLog();

        return $total;
    }

    /**
     * Check if Log Extender appears to be installed.
     */
    public function isInstalled(): bool
    {
        if (! is_dir($this->logsDir)) {
            return false;
        }

        $files = glob($this->logsDir.'/*_player.txt');

        return ! empty($files);
    }

    /**
     * Parse _player.txt for death and connect/disconnect events.
     */
    private function parsePlayerLog(): int
    {
        $file = $this->findLatestLog('_player.txt');
        if ($file === null) {
            return 0;
        }

        $offset = $this->getOffset($file);
        $lines = $this->readFromOffset($file, $offset);
        $count = 0;

        foreach ($lines as $line) {
            $parsed = $this->parseTimestamp($line);
            if ($parsed === null) {
                continue;
            }

            [$timestamp, $rest] = $parsed;

            // Death event: contains "died" with optional coordinates
            if (preg_match('/"([^"]+)"\s+died(?:\s+at\s+(\d+),(\d+),\d+)?/', $rest, $matches)) {
                GameEvent::query()->create([
                    'event_type' => 'death',
                    'player' => $matches[1],
                    'x' => isset($matches[2]) ? (int) $matches[2] : null,
                    'y' => isset($matches[3]) ? (int) $matches[3] : null,
                    'details' => ['raw' => trim($rest)],
                    'game_time' => $timestamp,
                ]);
                $count++;

                continue;
            }

            // Connect event
            if (preg_match('/\d+\s+"([^"]+)"\s+connected\b/', $rest, $matches)) {
                GameEvent::query()->create([
                    'event_type' => 'connect',
                    'player' => $matches[1],
                    'game_time' => $timestamp,
                ]);
                $count++;

                continue;
            }

            // Disconnect event
            if (preg_match('/\d+\s+"([^"]+)"\s+disconnected\b/', $rest, $matches)) {
                GameEvent::query()->create([
                    'event_type' => 'disconnect',
                    'player' => $matches[1],
                    'game_time' => $timestamp,
                ]);
                $count++;
            }
        }

        $this->saveOffset($file);

        return $count;
    }

    /**
     * Parse _pvp.txt for PvP kill events.
     */
    private function parsePvpLog(): int
    {
        $file = $this->findLatestLog('_pvp.txt');
        if ($file === null) {
            return 0;
        }

        $offset = $this->getOffset($file);
        $lines = $this->readFromOffset($file, $offset);
        $count = 0;

        foreach ($lines as $line) {
            $parsed = $this->parseTimestamp($line);
            if ($parsed === null) {
                continue;
            }

            [$timestamp, $rest] = $parsed;

            // PvP: "user PlayerA (x,y,z) hit user PlayerB (x,y,z) with Weapon"
            if (preg_match('/user\s+(\S+)\s+\((\d+),(\d+),\d+\)\s+hit\s+user\s+(\S+)\s+\((\d+),(\d+),\d+\)\s+with\s+(.+?)(?:\s+damage\s+(.+))?$/i', $rest, $matches)) {
                GameEvent::query()->create([
                    'event_type' => 'pvp_kill',
                    'player' => $matches[1],
                    'target' => $matches[4],
                    'x' => (int) $matches[2],
                    'y' => (int) $matches[3],
                    'details' => [
                        'weapon' => trim($matches[7]),
                        'damage' => $matches[8] ?? null,
                        'victim_x' => (int) $matches[5],
                        'victim_y' => (int) $matches[6],
                    ],
                    'game_time' => $timestamp,
                ]);
                $count++;
            }
        }

        $this->saveOffset($file);

        return $count;
    }

    /**
     * Parse _craft.txt for crafting events.
     */
    private function parseCraftLog(): int
    {
        $file = $this->findLatestLog('_craft.txt');
        if ($file === null) {
            return 0;
        }

        $offset = $this->getOffset($file);
        $lines = $this->readFromOffset($file, $offset);
        $count = 0;

        foreach ($lines as $line) {
            $parsed = $this->parseTimestamp($line);
            if ($parsed === null) {
                continue;
            }

            [$timestamp, $rest] = $parsed;

            // Craft: SteamID "PlayerName" crafted quantity Base.ItemName with recipe "RecipeName"
            if (preg_match('/\d+\s+"([^"]+)"\s+crafted\s+(\d+)\s+(\S+)\s+with\s+recipe\s+"([^"]+)"/', $rest, $matches)) {
                GameEvent::query()->create([
                    'event_type' => 'craft',
                    'player' => $matches[1],
                    'details' => [
                        'quantity' => (int) $matches[2],
                        'item' => $matches[3],
                        'recipe' => $matches[4],
                    ],
                    'game_time' => $timestamp,
                ]);
                $count++;
            }
        }

        $this->saveOffset($file);

        return $count;
    }

    /**
     * Find the latest log file matching the suffix.
     */
    private function findLatestLog(string $suffix): ?string
    {
        $files = glob($this->logsDir.'/*'.$suffix);
        if (empty($files)) {
            return null;
        }

        sort($files);

        return end($files);
    }

    /**
     * Parse timestamp from Log Extender line.
     * Format: [DD-MM-YY HH:MM:SS.ms] rest...
     *
     * @return array{0: \DateTimeImmutable, 1: string}|null
     */
    private function parseTimestamp(string $line): ?array
    {
        if (! preg_match('/^\[(\d{2}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\.\d+\]\s*(.+)$/', $line, $matches)) {
            return null;
        }

        $timestamp = \DateTimeImmutable::createFromFormat('d-m-y H:i:s', $matches[1]);
        if ($timestamp === false) {
            return null;
        }

        return [$timestamp, $matches[2]];
    }

    /**
     * Read lines from a file starting at the stored offset.
     *
     * @return string[]
     */
    private function readFromOffset(string $file, int $offset): array
    {
        $handle = fopen($file, 'r');
        if ($handle === false) {
            return [];
        }

        if ($offset > 0) {
            fseek($handle, $offset);
        }

        $lines = [];
        while (($line = fgets($handle)) !== false) {
            $line = trim($line);
            if ($line !== '') {
                $lines[] = $line;
            }
        }

        // Store current position for next call
        $this->lastReadPosition = ftell($handle) ?: 0;
        fclose($handle);

        return $lines;
    }

    private int $lastReadPosition = 0;

    /**
     * Get the stored offset for a file.
     */
    private function getOffset(string $file): int
    {
        $key = 'log_extender_offset:'.md5($file);

        return (int) Cache::get($key, 0);
    }

    /**
     * Save the current offset for a file.
     */
    private function saveOffset(string $file): void
    {
        $key = 'log_extender_offset:'.md5($file);
        Cache::put($key, $this->lastReadPosition, now()->addDays(7));
    }
}
