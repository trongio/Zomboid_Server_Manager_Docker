<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\PlayerStat;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\OnlinePlayersReader;
use App\Services\RconClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class PlayerController extends Controller
{
    public function __construct(
        private readonly RconClient $rcon,
        private readonly AuditLogger $auditLogger,
        private readonly OnlinePlayersReader $onlinePlayers,
    ) {}

    public function index(): Response
    {
        $onlineNames = $this->onlinePlayers->getOnlineUsernames();
        $onlinePlayers = array_map(fn ($name) => ['name' => $name], $onlineNames);

        $statsMap = PlayerStat::query()
            ->get()
            ->keyBy('username');

        $registeredUsers = User::query()
            ->select('id', 'username', 'role', 'created_at')
            ->orderBy('username')
            ->get()
            ->map(function (User $user) use ($onlineNames, $statsMap) {
                $stats = $statsMap->get($user->username);

                return [
                    'id' => $user->id,
                    'username' => $user->username,
                    'role' => $user->role->value,
                    'isOnline' => in_array($user->username, $onlineNames),
                    'createdAt' => $user->created_at->toISOString(),
                    'stats' => $stats ? [
                        'zombie_kills' => $stats->zombie_kills,
                        'hours_survived' => $stats->hours_survived,
                        'profession' => $stats->profession,
                    ] : null,
                ];
            });

        return Inertia::render('admin/players', [
            'players' => $onlinePlayers,
            'registeredUsers' => Inertia::defer(fn () => $registeredUsers),
        ]);
    }

    public function kick(Request $request, string $name): JsonResponse
    {
        $reason = $request->input('reason', '');

        try {
            $this->rcon->connect();
            $command = $reason ? "kickuser \"{$name}\" \"{$reason}\"" : "kickuser \"{$name}\"";
            $this->rcon->command($command);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'Failed: '.$e->getMessage()], 503);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'player.kick',
            target: $name,
            details: ['reason' => $reason],
            ip: $request->ip(),
        );

        return response()->json(['message' => "Kicked {$name}"]);
    }

    public function ban(Request $request, string $name): JsonResponse
    {
        $reason = $request->input('reason', '');
        $ipBan = $request->boolean('ip_ban');

        try {
            $this->rcon->connect();
            $this->rcon->command("banuser \"{$name}\"");
            if ($ipBan) {
                $this->rcon->command("banid \"{$name}\"");
            }
        } catch (\Throwable $e) {
            return response()->json(['error' => 'Failed: '.$e->getMessage()], 503);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'player.ban',
            target: $name,
            details: ['reason' => $reason, 'ip_ban' => $ipBan],
            ip: $request->ip(),
        );

        return response()->json(['message' => "Banned {$name}"]);
    }

    public function setAccessLevel(Request $request, string $name): JsonResponse
    {
        $level = $request->input('level', 'none');

        try {
            $this->rcon->connect();
            $this->rcon->command("setaccesslevel \"{$name}\" \"{$level}\"");
        } catch (\Throwable $e) {
            return response()->json(['error' => 'Failed: '.$e->getMessage()], 503);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'player.setaccess',
            target: $name,
            details: ['level' => $level],
            ip: $request->ip(),
        );

        return response()->json(['message' => "Set {$name} access to {$level}"]);
    }

    /**
     * @return array<int, array{name: string}>
     */
    private function parsePlayers(string $response): array
    {
        $lines = array_filter(array_map('trim', explode("\n", $response)));
        $players = [];

        foreach ($lines as $line) {
            if (str_starts_with($line, '-')) {
                $players[] = ['name' => ltrim($line, '- ')];
            }
        }

        return $players;
    }
}
