<?php

namespace App\Services;

use Illuminate\Support\Facades\Log;

/**
 * Determines which players are currently online by parsing PZ's user log.
 *
 * Checks three sources in priority order:
 * 1. Lua bridge players_live.json (real-time positions)
 * 2. RCON "players" command
 * 3. PZ user log file (parse connect/disconnect events)
 */
class OnlinePlayersReader
{
    public function __construct(
        private readonly PlayerPositionReader $positionReader,
        private readonly RconClient $rcon,
    ) {}

    /**
     * Get online players with data source information.
     *
     * The source indicates how reliable the data is for determining game server state:
     * - lua_bridge/rcon: game server is fully responsive
     * - user_log/none: game may still be starting (only Docker is alive)
     *
     * @return array{usernames: string[], source: 'lua_bridge'|'rcon'|'user_log'|'none'}
     */
    public function getOnlinePlayers(): array
    {
        // 1. Try Lua bridge (most accurate — has positions too)
        $liveData = $this->positionReader->getLivePositions();
        if ($liveData !== null && ! empty($liveData['players']) && ! $this->positionReader->isStale()) {
            return [
                'usernames' => array_map(
                    fn ($p) => $p['username'] ?? '',
                    $liveData['players'],
                ),
                'source' => 'lua_bridge',
            ];
        }

        // 2. Try RCON — a successful connect proves the game server is responsive
        try {
            $this->rcon->connect();
            $response = $this->rcon->command('players');

            return [
                'usernames' => $this->parseRconPlayers($response) ?? [],
                'source' => 'rcon',
            ];
        } catch (\Throwable) {
            // RCON unavailable
        }

        // 3. Fall back to user log parsing
        $logPlayers = $this->parseUserLog();

        return [
            'usernames' => $logPlayers,
            'source' => ! empty($logPlayers) ? 'user_log' : 'none',
        ];
    }

    /**
     * Get a list of currently online usernames.
     *
     * @return string[]
     */
    public function getOnlineUsernames(): array
    {
        return $this->getOnlinePlayers()['usernames'];
    }

    /**
     * Parse RCON "players" response into username list.
     *
     * PZ returns "Players connected (N):\n-player1\n-player2\n..."
     * Only trust the response if it contains the expected header.
     *
     * @return string[]|null
     */
    private function parseRconPlayers(string $response): ?array
    {
        if (! str_contains($response, 'Players connected')) {
            return null;
        }

        $lines = array_filter(array_map('trim', explode("\n", $response)));
        $players = [];

        foreach ($lines as $line) {
            if (str_starts_with($line, '-')) {
                $players[] = ltrim($line, '- ');
            }
        }

        return $players;
    }

    /**
     * Parse PZ user log to determine online players.
     *
     * Players with a "fully connected" event and no subsequent "disconnected" event are online.
     *
     * @return string[]
     */
    private function parseUserLog(): array
    {
        $logFile = $this->findCurrentUserLog();
        if ($logFile === null) {
            return [];
        }

        try {
            $content = file_get_contents($logFile);
            if ($content === false) {
                return [];
            }
        } catch (\Throwable) {
            return [];
        }

        $online = [];

        $lines = explode("\n", $content);
        foreach ($lines as $line) {
            // Match: "username" fully connected
            if (preg_match('/"([^"]+)" fully connected/', $line, $matches)) {
                $online[$matches[1]] = true;
            }
            // Match: "username" disconnected player
            if (preg_match('/"([^"]+)" disconnected player/', $line, $matches)) {
                unset($online[$matches[1]]);
            }
        }

        return array_keys($online);
    }

    /**
     * Find the current user log file (most recent *_user.txt).
     */
    private function findCurrentUserLog(): ?string
    {
        $logsDir = config('zomboid.paths.data', '/pz-data').'/Logs';

        if (! is_dir($logsDir)) {
            return null;
        }

        $files = glob($logsDir.'/*_user.txt');
        if (empty($files)) {
            return null;
        }

        // Most recent file (sorted by name, which includes timestamp)
        sort($files);

        return end($files);
    }
}
