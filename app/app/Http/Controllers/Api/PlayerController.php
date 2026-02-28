<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\AddItemRequest;
use App\Http\Requests\Api\AddXpRequest;
use App\Http\Requests\Api\BanPlayerRequest;
use App\Http\Requests\Api\KickPlayerRequest;
use App\Http\Requests\Api\SetAccessLevelRequest;
use App\Http\Requests\Api\TeleportPlayerRequest;
use App\Services\AuditLogger;
use App\Services\OnlinePlayersReader;
use App\Services\RconClient;
use Illuminate\Http\JsonResponse;

class PlayerController
{
    public function __construct(
        private readonly RconClient $rcon,
        private readonly AuditLogger $auditLogger,
        private readonly OnlinePlayersReader $onlinePlayers,
    ) {}

    public function index(): JsonResponse
    {
        $onlineNames = $this->onlinePlayers->getOnlineUsernames();
        $players = array_map(fn (string $name) => ['name' => $name], $onlineNames);

        return response()->json([
            'players' => $players,
            'count' => count($players),
        ]);
    }

    public function show(string $name): JsonResponse
    {
        $onlineNames = $this->onlinePlayers->getOnlineUsernames();

        if (! in_array($name, $onlineNames, true)) {
            return response()->json(['error' => 'Player not found or not online'], 404);
        }

        return response()->json(['name' => $name]);
    }

    public function kick(string $name, KickPlayerRequest $request): JsonResponse
    {
        $reason = $request->validated('reason');

        return $this->executePlayerCommand(
            name: $name,
            command: "kickuser \"{$name}\"".($reason ? " \"{$reason}\"" : ''),
            action: 'player.kick',
            details: ['reason' => $reason],
            ip: $request->ip(),
            successMessage: "Player '{$name}' kicked",
        );
    }

    public function ban(string $name, BanPlayerRequest $request): JsonResponse
    {
        $reason = $request->validated('reason');
        $ipBan = $request->validated('ip_ban', false);

        try {
            $this->rcon->connect();
            $this->rcon->command("banuser \"{$name}\"");

            if ($ipBan) {
                $this->rcon->command("banid \"{$name}\"");
            }
        } catch (\Throwable $e) {
            return response()->json([
                'error' => 'Failed to ban player: server may be offline',
                'detail' => $e->getMessage(),
            ], 503);
        }

        $this->auditLogger->log(
            actor: 'api-key',
            action: 'player.ban',
            target: $name,
            details: ['reason' => $reason, 'ip_ban' => $ipBan],
            ip: $request->ip(),
        );

        return response()->json([
            'message' => "Player '{$name}' banned".($ipBan ? ' (IP ban)' : ''),
        ]);
    }

    public function unban(string $name): JsonResponse
    {
        return $this->executePlayerCommand(
            name: $name,
            command: "unbanuser \"{$name}\"",
            action: 'player.unban',
            details: [],
            ip: request()->ip(),
            successMessage: "Player '{$name}' unbanned",
        );
    }

    public function setAccessLevel(string $name, SetAccessLevelRequest $request): JsonResponse
    {
        $level = $request->validated('level');

        return $this->executePlayerCommand(
            name: $name,
            command: "setaccesslevel \"{$name}\" \"{$level}\"",
            action: 'player.setaccess',
            details: ['level' => $level],
            ip: $request->ip(),
            successMessage: "Access level for '{$name}' set to '{$level}'",
        );
    }

    public function teleport(string $name, TeleportPlayerRequest $request): JsonResponse
    {
        $targetPlayer = $request->validated('target_player');

        if ($targetPlayer) {
            $command = "teleportto \"{$name}\" \"{$targetPlayer}\"";
            $details = ['target_player' => $targetPlayer];
        } else {
            $x = $request->validated('x');
            $y = $request->validated('y');
            $z = $request->validated('z', '0');
            $command = "teleport \"{$name}\" {$x},{$y},{$z}";
            $details = ['x' => $x, 'y' => $y, 'z' => $z];
        }

        return $this->executePlayerCommand(
            name: $name,
            command: $command,
            action: 'player.teleport',
            details: $details,
            ip: $request->ip(),
            successMessage: "Player '{$name}' teleported",
        );
    }

    public function addItem(string $name, AddItemRequest $request): JsonResponse
    {
        $itemId = $request->validated('item_id');
        $count = $request->validated('count', 1);

        return $this->executePlayerCommand(
            name: $name,
            command: "additem \"{$name}\" \"{$itemId}\" {$count}",
            action: 'player.additem',
            details: ['item_id' => $itemId, 'count' => $count],
            ip: $request->ip(),
            successMessage: "Added {$count}x '{$itemId}' to '{$name}'",
        );
    }

    public function addXp(string $name, AddXpRequest $request): JsonResponse
    {
        $skill = $request->validated('skill');
        $amount = $request->validated('amount');

        return $this->executePlayerCommand(
            name: $name,
            command: "addxp \"{$name}\" {$skill}={$amount}",
            action: 'player.addxp',
            details: ['skill' => $skill, 'amount' => $amount],
            ip: $request->ip(),
            successMessage: "Added {$amount} XP in '{$skill}' to '{$name}'",
        );
    }

    public function godmode(string $name): JsonResponse
    {
        return $this->executePlayerCommand(
            name: $name,
            command: "godmod \"{$name}\"",
            action: 'player.godmode',
            details: [],
            ip: request()->ip(),
            successMessage: "Godmode toggled for '{$name}'",
        );
    }

    /**
     * @param  array<string, mixed>  $details
     */
    private function executePlayerCommand(
        string $name,
        string $command,
        string $action,
        array $details,
        ?string $ip,
        string $successMessage,
    ): JsonResponse {
        try {
            $this->rcon->connect();
            $this->rcon->command($command);
        } catch (\Throwable $e) {
            return response()->json([
                'error' => 'Command failed: server may be offline',
                'detail' => $e->getMessage(),
            ], 503);
        }

        $this->auditLogger->log(
            actor: 'api-key',
            action: $action,
            target: $name,
            details: $details,
            ip: $ip,
        );

        return response()->json(['message' => $successMessage]);
    }

}
