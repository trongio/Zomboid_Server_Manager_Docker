<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\UpdateRespawnDelayRequest;
use App\Services\AuditLogger;
use App\Services\RespawnDelayManager;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RespawnDelayController extends Controller
{
    public function __construct(
        private readonly RespawnDelayManager $respawnDelay,
        private readonly AuditLogger $auditLogger,
    ) {}

    public function index(): JsonResponse
    {
        return response()->json([
            'config' => $this->respawnDelay->getConfig(),
            'cooldowns' => $this->respawnDelay->getActiveCooldowns(),
        ]);
    }

    public function update(UpdateRespawnDelayRequest $request): JsonResponse
    {
        $enabled = $request->boolean('enabled');
        $delayMinutes = (int) $request->validated('delay_minutes');

        $before = $this->respawnDelay->getConfig();
        $this->respawnDelay->updateConfig($enabled, $delayMinutes);

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'respawn_delay.update',
            target: 'respawn_config',
            details: [
                'before' => $before,
                'after' => ['enabled' => $enabled, 'delay_minutes' => $delayMinutes],
            ],
            ip: $request->ip(),
        );

        return response()->json([
            'message' => 'Respawn delay settings updated',
            'config' => $this->respawnDelay->getConfig(),
        ]);
    }

    public function reset(Request $request, string $username): JsonResponse
    {
        $this->respawnDelay->resetPlayer($username);

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'respawn_delay.reset',
            target: $username,
            ip: $request->ip(),
        );

        return response()->json([
            'message' => "Respawn timer reset for {$username}",
        ]);
    }
}
