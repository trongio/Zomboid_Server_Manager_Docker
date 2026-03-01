<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\RestartServerRequest;
use App\Http\Requests\Admin\StopServerRequest;
use App\Http\Requests\Admin\WipeServerRequest;
use App\Jobs\RestartGameServer;
use App\Jobs\SendServerWarning;
use App\Jobs\StopGameServer;
use App\Jobs\WaitForServerReady;
use App\Jobs\WipeGameServer;
use App\Services\AuditLogger;
use App\Services\DockerManager;
use App\Services\RconClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use function Illuminate\Support\defer;

class ServerController extends Controller
{
    public function __construct(
        private readonly DockerManager $docker,
        private readonly RconClient $rcon,
        private readonly AuditLogger $auditLogger,
    ) {}

    public function start(Request $request): JsonResponse
    {
        try {
            $status = $this->docker->getContainerStatus();
        } catch (\Throwable) {
            return response()->json(['error' => 'Cannot connect to Docker daemon'], 503);
        }

        if ($status['running']) {
            return response()->json(['error' => 'Server is already running'], 409);
        }

        try {
            $this->docker->startContainer();
        } catch (\Throwable $e) {
            return response()->json(['error' => 'Failed to start server: '.$e->getMessage()], 503);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'server.start',
            ip: $request->ip(),
        );

        WaitForServerReady::dispatch(
            'server.start.completed',
            $request->user()->name ?? 'admin',
            $request->ip(),
        );

        return response()->json(['message' => 'Server starting']);
    }

    public function stop(StopServerRequest $request): JsonResponse
    {
        $countdown = $request->validated('countdown');
        $message = $request->validated('message');

        if ($countdown) {
            $warningMessage = $message ?? "Server shutting down in {$countdown} seconds";

            try {
                $this->rcon->connect();
                $this->rcon->command("servermsg \"{$warningMessage}\"");
            } catch (\Throwable) {
                // RCON unavailable — still schedule the stop
            }

            StopGameServer::dispatch($request->ip())
                ->delay(now()->addSeconds($countdown));

            SendServerWarning::dispatchCountdownWarnings($countdown, 'shutting down', 'server.pending_action:stop');

            $this->auditLogger->log(
                actor: $request->user()->name ?? 'admin',
                action: 'server.stop.scheduled',
                ip: $request->ip(),
                details: ['countdown' => $countdown],
            );

            return response()->json([
                'message' => "Server shutdown scheduled in {$countdown} seconds",
                'countdown' => $countdown,
            ]);
        }

        try {
            $this->rcon->connect();
            $this->rcon->command('save');
            sleep(5);
            $this->rcon->command('quit');
        } catch (\Throwable) {
            // RCON unavailable — proceed with Docker stop
        }

        try {
            $this->docker->stopContainer(timeout: 30);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'Failed to stop server: '.$e->getMessage()], 503);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'server.stop',
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Server stopped']);
    }

    public function restart(RestartServerRequest $request): JsonResponse
    {
        $countdown = $request->validated('countdown');
        $message = $request->validated('message');

        if ($countdown) {
            $warningMessage = $message ?? "Server restarting in {$countdown} seconds";

            try {
                $this->rcon->connect();
                $this->rcon->command("servermsg \"{$warningMessage}\"");
            } catch (\Throwable) {
                // RCON unavailable — still schedule the restart
            }

            RestartGameServer::dispatch($request->ip())
                ->delay(now()->addSeconds($countdown));

            SendServerWarning::dispatchCountdownWarnings($countdown, 'restarting', 'server.pending_action:restart');

            $this->auditLogger->log(
                actor: $request->user()->name ?? 'admin',
                action: 'server.restart.scheduled',
                ip: $request->ip(),
                details: ['countdown' => $countdown],
            );

            return response()->json([
                'message' => "Server restart scheduled in {$countdown} seconds",
                'countdown' => $countdown,
            ]);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'server.restart',
            ip: $request->ip(),
        );

        $docker = $this->docker;
        $rcon = $this->rcon;
        $ip = $request->ip();
        $actor = $request->user()->name ?? 'admin';

        defer(function () use ($docker, $rcon, $ip, $actor) {
            try {
                $rcon->connect();
                $rcon->command('save');
            } catch (\Throwable) {
                // RCON unavailable — proceed with restart
            }

            $docker->restartContainer(timeout: 30);

            WaitForServerReady::dispatch(
                'server.restart.completed',
                $actor,
                $ip,
            );
        });

        return response()->json(['message' => 'Server restarting']);
    }

    public function save(Request $request): JsonResponse
    {
        try {
            $this->rcon->connect();
            $this->rcon->command('save');
        } catch (\Throwable $e) {
            return response()->json([
                'error' => 'Failed to save: '.$e->getMessage(),
            ], 503);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'server.save',
            ip: $request->ip(),
        );

        return response()->json(['message' => 'World saved']);
    }

    public function wipe(WipeServerRequest $request): JsonResponse
    {
        $countdown = $request->validated('countdown');
        $message = $request->validated('message');

        if ($countdown) {
            $warningMessage = $message ?? "Server wiping in {$countdown} seconds — all save data will be deleted";

            try {
                $this->rcon->connect();
                $this->rcon->command("servermsg \"{$warningMessage}\"");
            } catch (\Throwable) {
                // RCON unavailable — still schedule the wipe
            }

            WipeGameServer::dispatch($request->ip())
                ->delay(now()->addSeconds($countdown));

            SendServerWarning::dispatchCountdownWarnings($countdown, 'wiping', 'server.pending_action:wipe');

            $this->auditLogger->log(
                actor: $request->user()->name ?? 'admin',
                action: 'server.wipe.scheduled',
                ip: $request->ip(),
                details: ['countdown' => $countdown],
            );

            return response()->json([
                'message' => "Server wipe scheduled in {$countdown} seconds",
                'countdown' => $countdown,
            ]);
        }

        // Immediate wipe — dispatch via queue for reliable execution
        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'server.wipe',
            ip: $request->ip(),
        );

        WipeGameServer::dispatch($request->ip());

        return response()->json(['message' => 'Server wipe in progress']);
    }
}
