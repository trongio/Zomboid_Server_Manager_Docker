<?php

namespace App\Services;

use App\Models\PlayerStat;

class PlayerStatsService
{
    private string $statsPath;

    public function __construct(?string $statsPath = null)
    {
        $this->statsPath = $statsPath ?? config('zomboid.lua_bridge.player_stats');
    }

    /**
     * Read stats JSON from the Lua bridge and upsert into the database.
     *
     * @return int Number of player records upserted
     */
    public function sync(): int
    {
        $data = $this->readStatsFile();
        if ($data === null || empty($data['players'])) {
            return 0;
        }

        $count = 0;
        foreach ($data['players'] as $playerData) {
            $username = $playerData['username'] ?? null;
            if ($username === null || $username === 'unknown') {
                continue;
            }

            PlayerStat::query()->updateOrCreate(
                ['username' => $username],
                [
                    'zombie_kills' => (int) ($playerData['zombie_kills'] ?? 0),
                    'hours_survived' => (float) ($playerData['hours_survived'] ?? 0),
                    'profession' => $playerData['profession'] ?? null,
                    'skills' => $playerData['skills'] ?? null,
                    'is_dead' => (bool) ($playerData['is_dead'] ?? false),
                ],
            );

            $count++;
        }

        return $count;
    }

    /**
     * Get the top players by a given stat.
     *
     * @return array<int, array{username: string, zombie_kills: int, hours_survived: float, profession: string|null}>
     */
    public function getLeaderboard(string $stat = 'zombie_kills', int $limit = 10): array
    {
        return PlayerStat::query()
            ->orderByDesc($stat)
            ->limit($limit)
            ->get(['username', 'zombie_kills', 'hours_survived', 'profession'])
            ->toArray();
    }

    /**
     * Read and parse the stats JSON file.
     *
     * @return array{timestamp: string, player_count: int, players: array<int, array{username: string, zombie_kills: int, hours_survived: float, profession: string|null, skills: array<string, int>, is_dead: bool}>}|null
     */
    private function readStatsFile(): ?array
    {
        if (! file_exists($this->statsPath)) {
            return null;
        }

        $content = file_get_contents($this->statsPath);
        if ($content === false) {
            return null;
        }

        $data = json_decode($content, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            return null;
        }

        return $data;
    }
}
