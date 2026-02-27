<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Backup;
use App\Services\DockerManager;
use App\Services\GameStateReader;
use App\Services\RconClient;
use Carbon\Carbon;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    public function __construct(
        private readonly RconClient $rcon,
        private readonly DockerManager $docker,
        private readonly GameStateReader $gameStateReader,
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

            try {
                $this->rcon->connect();
                $playersResponse = $this->rcon->command('players');
                $parsed = $this->parsePlayers($playersResponse);
                $server['player_count'] = $parsed['count'];
                $server['players'] = $parsed['names'];
            } catch (\Throwable) {
                // RCON unavailable
            }

            $iniData = $this->readServerIni();
            $server['map'] = $iniData['Map'] ?? null;
            $server['max_players'] = isset($iniData['MaxPlayers']) ? (int) $iniData['MaxPlayers'] : null;
        }

        $recentAudit = AuditLog::query()
            ->orderByDesc('created_at')
            ->limit(10)
            ->get()
            ->map(fn (AuditLog $log) => [
                'id' => $log->id,
                'actor' => $log->actor,
                'action' => $log->action,
                'target' => $log->target,
                'details' => $log->details,
                'ip_address' => $log->ip_address,
                'created_at' => $log->created_at?->toIso8601String(),
            ])
            ->all();

        $backupQuery = Backup::query();
        $totalCount = $backupQuery->count();
        $totalSizeBytes = (int) $backupQuery->sum('size_bytes');
        $lastBackup = Backup::query()
            ->orderByDesc('created_at')
            ->first();

        $backupSummary = [
            'total_count' => $totalCount,
            'last_backup' => $lastBackup ? [
                'id' => $lastBackup->id,
                'filename' => $lastBackup->filename,
                'size_bytes' => $lastBackup->size_bytes,
                'size_human' => $this->formatBytes($lastBackup->size_bytes),
                'type' => $lastBackup->type->value,
                'notes' => $lastBackup->notes,
                'created_at' => $lastBackup->created_at?->toIso8601String(),
            ] : null,
            'total_size_human' => $this->formatBytes($totalSizeBytes),
        ];

        $gameState = $online ? $this->gameStateReader->getGameState() : null;

        return Inertia::render('dashboard', [
            'server' => $server,
            'game_state' => $gameState,
            'recent_audit' => Inertia::defer(fn () => $recentAudit),
            'backup_summary' => Inertia::defer(fn () => $backupSummary),
        ]);
    }

    /**
     * @return array{count: int, names: string[]}
     */
    private function parsePlayers(string $response): array
    {
        $lines = array_filter(array_map('trim', explode("\n", $response)));
        $names = [];

        foreach ($lines as $line) {
            if (str_starts_with($line, '-')) {
                $names[] = ltrim($line, '- ');
            }
        }

        $count = count($names);
        if (preg_match('/\((\d+)\)/', $response, $matches)) {
            $count = (int) $matches[1];
        }

        return ['count' => $count, 'names' => $names];
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

    private function formatBytes(int $bytes): string
    {
        if ($bytes >= 1073741824) {
            return round($bytes / 1073741824, 2).' GB';
        }

        if ($bytes >= 1048576) {
            return round($bytes / 1048576, 2).' MB';
        }

        if ($bytes >= 1024) {
            return round($bytes / 1024, 2).' KB';
        }

        return $bytes.' B';
    }
}
