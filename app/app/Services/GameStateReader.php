<?php

namespace App\Services;

class GameStateReader
{
    private string $gameStatePath;

    public function __construct(?string $gameStatePath = null)
    {
        $this->gameStatePath = $gameStatePath ?? config('zomboid.lua_bridge.game_state');
    }

    /**
     * Get the current game state.
     *
     * @return array{
     *     time: array{year: int, month: int, day: int, hour: int, minute: int, day_of_year: int, is_night: bool, formatted: string, date: string},
     *     season: string,
     *     weather: array{temperature: float, rain_intensity: float, fog_intensity: float, wind_intensity: float, snow_intensity: float, is_raining: bool, is_foggy: bool, is_snowing: bool, condition: string}|null,
     *     game_version: string|null,
     *     exported_at: string,
     * }|null
     */
    public function getGameState(): ?array
    {
        if (! file_exists($this->gameStatePath)) {
            return null;
        }

        $content = file_get_contents($this->gameStatePath);
        if ($content === false) {
            return null;
        }

        $data = json_decode($content, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            return null;
        }

        return $data;
    }

    /**
     * Check if game state data is stale (older than given seconds).
     */
    public function isStale(int $maxAgeSeconds = 120): bool
    {
        $data = $this->getGameState();
        if ($data === null || empty($data['exported_at'])) {
            return true;
        }

        $timestamp = strtotime($data['exported_at']);
        if ($timestamp === false) {
            return true;
        }

        return (time() - $timestamp) > $maxAgeSeconds;
    }
}
