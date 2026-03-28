<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\AdminSetPasswordRequest;
use App\Http\Requests\Admin\BanPlayerRequest;
use App\Http\Requests\Admin\KickPlayerRequest;
use App\Http\Requests\Admin\SetAccessLevelRequest;
use App\Models\PlayerStat;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\OnlinePlayersReader;
use App\Services\PzPasswordSyncService;
use App\Services\RconClient;
use App\Services\RconSanitizer;
use App\Services\RespawnDelayManager;
use Illuminate\Http\JsonResponse;
use Inertia\Inertia;
use Inertia\Response;

class PlayerController extends Controller
{
    public function __construct(
        private readonly RconClient $rcon,
        private readonly AuditLogger $auditLogger,
        private readonly OnlinePlayersReader $onlinePlayers,
        private readonly RespawnDelayManager $respawnDelay,
        private readonly PzPasswordSyncService $pzPasswordSync,
    ) {}

    public function index(): Response
    {
        $onlineNames = $this->onlinePlayers->getOnlineUsernames();

        $statsMap = PlayerStat::query()
            ->get()
            ->keyBy('username');

        $registeredUsernames = [];

        $players = User::query()
            ->select('id', 'username', 'role', 'created_at')
            ->orderBy('username')
            ->get()
            ->map(function (User $user) use ($onlineNames, $statsMap, &$registeredUsernames) {
                $registeredUsernames[] = $user->username;
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
            })
            ->toArray();

        // Add online-only unregistered players as pseudo-entries
        foreach ($onlineNames as $name) {
            if (! in_array($name, $registeredUsernames)) {
                $stats = $statsMap->get($name);

                $players[] = [
                    'id' => null,
                    'username' => $name,
                    'role' => 'unknown',
                    'isOnline' => true,
                    'createdAt' => null,
                    'stats' => $stats ? [
                        'zombie_kills' => $stats->zombie_kills,
                        'hours_survived' => $stats->hours_survived,
                        'profession' => $stats->profession,
                    ] : null,
                ];
            }
        }

        return Inertia::render('admin/players', [
            'players' => $players,
            'respawn_cooldowns' => $this->respawnDelay->getActiveCooldowns(),
            'respawn_config' => $this->respawnDelay->getConfig(),
        ]);
    }

    public function kick(KickPlayerRequest $request, string $name): JsonResponse
    {
        $name = RconSanitizer::playerName($name);
        $reason = RconSanitizer::message($request->validated('reason', ''));

        try {
            $this->rcon->connect();
            $command = $reason !== '' ? "kickuser \"{$name}\" -r \"{$reason}\"" : "kickuser \"{$name}\"";
            $response = $this->rcon->command($command);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'Failed: '.$e->getMessage()], 503);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'player.kick',
            target: $name,
            details: ['reason' => $reason, 'rcon_response' => $response, 'command' => $command],
            ip: $request->ip(),
        );

        return response()->json(['message' => "Kicked {$name}", 'rcon_response' => $response, 'command' => $command]);
    }

    public function ban(BanPlayerRequest $request, string $name): JsonResponse
    {
        $name = RconSanitizer::playerName($name);
        $reason = RconSanitizer::message($request->validated('reason', ''));
        $ipBan = $request->validated('ip_ban', false);

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

    public function setAccessLevel(SetAccessLevelRequest $request, string $name): JsonResponse
    {
        $name = RconSanitizer::playerName($name);
        $level = RconSanitizer::accessLevel($request->validated('level'));

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

    public function setPassword(AdminSetPasswordRequest $request, string $name): JsonResponse
    {
        $user = User::where('username', $name)->first();

        if (! $user) {
            return response()->json(['error' => "User {$name} not found"], 404);
        }

        $user->update(['password' => $request->password]);

        $this->pzPasswordSync->sync($name, $request->password);

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'player.setpassword',
            target: $name,
            details: [],
            ip: $request->ip(),
        );

        return response()->json(['message' => "Password set for {$name}"]);
    }
}
