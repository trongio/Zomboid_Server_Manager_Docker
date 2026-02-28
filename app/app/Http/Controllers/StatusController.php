<?php

namespace App\Http\Controllers;

use App\Services\DockerManager;
use App\Services\GameStateReader;
use App\Services\ModManager;
use App\Services\OnlinePlayersReader;
use Carbon\Carbon;
use Inertia\Inertia;
use Inertia\Response;

class StatusController extends Controller
{
    public function __construct(
        private readonly DockerManager $docker,
        private readonly ModManager $modManager,
        private readonly GameStateReader $gameStateReader,
        private readonly OnlinePlayersReader $onlinePlayers,
    ) {}

    public function __invoke(): Response
    {
        try {
            $containerStatus = $this->docker->getContainerStatus();
        } catch (\Throwable) {
            $containerStatus = ['running' => false];
        }
        $online = $containerStatus['running'] ?? false;

        $server = [
            'online' => $online,
            'player_count' => 0,
            'players' => [],
            'uptime' => null,
            'map' => null,
            'max_players' => null,
        ];

        if ($online) {
            $server['uptime'] = $this->calculateUptime($containerStatus['started_at'] ?? null);

            $onlineNames = $this->onlinePlayers->getOnlineUsernames();
            $server['players'] = $onlineNames;
            $server['player_count'] = count($onlineNames);
        }

        $iniData = $this->readServerIni();
        $server['map'] = $iniData['Map'] ?? null;
        $server['max_players'] = isset($iniData['MaxPlayers']) ? (int) $iniData['MaxPlayers'] : null;

        $mods = [];
        try {
            $iniPath = config('zomboid.paths.server_ini');
            $mods = $this->modManager->list($iniPath);
        } catch (\Throwable) {
            // Config file not available
        }

        $gameState = $online ? $this->gameStateReader->getGameState() : null;

        return Inertia::render('status', [
            'server' => $server,
            'game_state' => $gameState,
            'mods' => $mods,
            'server_name' => config('zomboid.server_name', 'ZomboidServer'),
        ]);
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

        if (! is_file($path)) {
            return [];
        }

        $data = [];
        $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);

        if ($lines === false) {
            return [];
        }

        foreach ($lines as $line) {
            if (str_starts_with($line, '#') || ! str_contains($line, '=')) {
                continue;
            }

            [$key, $value] = explode('=', $line, 2);
            $data[trim($key)] = trim($value);
        }

        return $data;
    }
}
