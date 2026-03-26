<?php

namespace App\Services;

use Carbon\Carbon;

/**
 * Consolidates server status resolution logic used by multiple controllers.
 *
 * Determines both Docker container state and game server readiness by
 * combining container health checks with RCON/Lua bridge responsiveness.
 */
class ServerStatusResolver
{
    public function __construct(
        private readonly DockerManager $docker,
        private readonly OnlinePlayersReader $onlinePlayers,
        private readonly ServerIniParser $iniParser,
        private readonly GameVersionReader $versionReader,
    ) {}

    /**
     * Resolve full server status including container and game state.
     *
     * @return array{container_status: string, game_status: 'offline'|'starting'|'online', online: bool, player_count: int, players: string[], uptime: string|null, map: string|null, max_players: int|null, game_version: string|null, steam_branch: string, data_source: string}
     */
    public function resolve(): array
    {
        $containerStatus = $this->getContainerStatus();
        $running = $containerStatus['running'] ?? false;
        $containerState = $this->mapContainerState($containerStatus);

        $result = [
            'container_status' => $containerState,
            'game_status' => 'offline',
            'online' => false,
            'player_count' => 0,
            'players' => [],
            'uptime' => null,
            'map' => null,
            'max_players' => null,
            'game_version' => $this->versionReader->getCachedVersion() ?? $this->versionReader->refreshVersion(),
            'steam_branch' => $this->versionReader->getCurrentBranch(),
            'data_source' => 'none',
        ];

        if (! $running) {
            return $result;
        }

        $result['uptime'] = $this->calculateUptime($containerStatus['started_at'] ?? null);

        $playerData = $this->onlinePlayers->getOnlinePlayers();
        $result['players'] = $playerData['usernames'];
        $result['player_count'] = count($playerData['usernames']);
        $result['data_source'] = $playerData['source'];

        $result['game_status'] = $this->resolveGameStatus(
            $playerData['source'],
            $containerStatus['health_status'] ?? null,
        );
        $result['online'] = $result['game_status'] === 'online';

        $iniData = $this->readServerIni();
        $result['map'] = $iniData['Map'] ?? null;
        $result['max_players'] = isset($iniData['MaxPlayers']) ? (int) $iniData['MaxPlayers'] : null;

        return $result;
    }

    /**
     * @return array<string, mixed>
     */
    private function getContainerStatus(): array
    {
        try {
            return $this->docker->getContainerStatus();
        } catch (\Throwable) {
            return ['running' => false];
        }
    }

    /**
     * Map Docker container status to a simplified state string.
     */
    private function mapContainerState(array $containerStatus): string
    {
        if (! ($containerStatus['exists'] ?? false)) {
            return 'not_found';
        }

        return $containerStatus['status'] ?? 'unknown';
    }

    /**
     * Determine game server status based on data source and Docker health.
     *
     * If we got data from lua_bridge or rcon, the game server is truly responsive.
     * Otherwise, fall back to Docker health check.
     *
     * @return 'offline'|'starting'|'online'
     */
    private function resolveGameStatus(string $dataSource, ?string $healthStatus): string
    {
        if (in_array($dataSource, ['lua_bridge', 'rcon'], true)) {
            return 'online';
        }

        return $healthStatus === 'healthy' ? 'online' : 'starting';
    }

    private function calculateUptime(?string $startedAt): ?string
    {
        if ($startedAt === null) {
            return null;
        }

        try {
            return Carbon::parse($startedAt)->diffForHumans(syntax: true);
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * @return array<string, string>
     */
    private function readServerIni(): array
    {
        $path = config('zomboid.paths.server_ini');

        if (! is_string($path)) {
            return [];
        }

        return $this->iniParser->read($path);
    }
}
