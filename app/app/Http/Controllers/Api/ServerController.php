<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\BroadcastRequest;
use App\Http\Requests\Api\RestartServerRequest;
use App\Http\Requests\Api\ServerLogsRequest;
use App\Jobs\RestartGameServer;
use App\Jobs\SendServerWarning;
use App\Jobs\UpdateGameServer;
use App\Rules\RconSafeMessage;
use App\Services\AuditLogger;
use App\Services\DockerManager;
use App\Services\GameVersionReader;
use App\Services\RconClient;
use App\Services\RconSanitizer;
use App\Services\ServerStatusResolver;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ServerController
{
    public function __construct(
        private readonly RconClient $rcon,
        private readonly DockerManager $docker,
        private readonly AuditLogger $auditLogger,
        private readonly ServerStatusResolver $statusResolver,
        private readonly GameVersionReader $versionReader,
    ) {}

    public function status(): JsonResponse
    {
        $resolved = $this->statusResolver->resolve();

        return response()->json([
            'online' => $resolved['online'],
            'status' => $resolved['game_status'],
            'player_count' => $resolved['player_count'],
            'players' => $resolved['players'],
            'uptime' => $resolved['uptime'],
            'map' => $resolved['map'],
            'max_players' => $resolved['max_players'],
            'game_version' => $resolved['game_version'],
            'steam_branch' => $resolved['steam_branch'],
        ]);
    }

    public function start(): JsonResponse
    {
        try {
            $status = $this->docker->getContainerStatus();
        } catch (\Throwable) {
            return response()->json([
                'error' => 'Cannot connect to Docker daemon',
            ], 503);
        }

        if ($status['running']) {
            return response()->json([
                'error' => 'Server is already running',
            ], 409);
        }

        try {
            $this->docker->startContainer();
        } catch (\Throwable $e) {
            return response()->json([
                'error' => 'Failed to start server',
                'detail' => $e->getMessage(),
            ], 503);
        }

        return response()->json([
            'message' => 'Server starting',
        ]);
    }

    public function stop(): JsonResponse
    {
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
            return response()->json([
                'error' => 'Failed to stop server',
                'detail' => $e->getMessage(),
            ], 503);
        }

        return response()->json([
            'message' => 'Server stopped',
        ]);
    }

    public function restart(RestartServerRequest $request): JsonResponse
    {
        $countdown = $request->validated('countdown');
        $message = $request->validated('message');

        if ($countdown) {
            $warningMessage = RconSanitizer::message($message ?? "Server restarting in {$countdown} seconds");

            try {
                $this->rcon->connect();
                $this->rcon->command("servermsg \"{$warningMessage}\"");
            } catch (\Throwable) {
                // RCON unavailable — still schedule the restart
            }

            RestartGameServer::dispatch($request->ip())
                ->delay(now()->addSeconds($countdown));

            SendServerWarning::dispatchCountdownWarnings($countdown, 'restarting', 'server.pending_action:restart');

            return response()->json([
                'message' => "Server restart scheduled in {$countdown} seconds",
                'countdown' => $countdown,
            ]);
        }

        try {
            $this->rcon->connect();
            $this->rcon->command('save');
        } catch (\Throwable) {
            // RCON unavailable — proceed with restart
        }

        try {
            $this->docker->restartContainer(timeout: 30);
        } catch (\Throwable $e) {
            return response()->json([
                'error' => 'Failed to restart server',
                'detail' => $e->getMessage(),
            ], 503);
        }

        return response()->json([
            'message' => 'Server restarting',
        ]);
    }

    public function save(): JsonResponse
    {
        try {
            $this->rcon->connect();
            $this->rcon->command('save');
        } catch (\Throwable $e) {
            return response()->json([
                'error' => 'Failed to save: server may be offline',
                'detail' => $e->getMessage(),
            ], 503);
        }

        return response()->json([
            'message' => 'World saved',
        ]);
    }

    public function broadcast(BroadcastRequest $request): JsonResponse
    {
        $message = RconSanitizer::message($request->validated('message'));

        try {
            $this->rcon->connect();
            $this->rcon->command("servermsg \"{$message}\"");
        } catch (\Throwable $e) {
            return response()->json([
                'error' => 'Failed to broadcast: server may be offline',
                'detail' => $e->getMessage(),
            ], 503);
        }

        return response()->json([
            'message' => 'Broadcast sent',
        ]);
    }

    public function version(): JsonResponse
    {
        return response()->json([
            'game_version' => $this->versionReader->getCachedVersion(),
            'steam_branch' => $this->versionReader->getCurrentBranch(),
            'available_branches' => ['public', 'unstable', 'iwillbackupmysave'],
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        $request->validate([
            'branch' => ['sometimes', 'string', 'in:public,unstable,iwillbackupmysave'],
            'countdown' => ['sometimes', 'integer', 'min:10', 'max:3600'],
            'message' => ['sometimes', 'nullable', 'string', 'max:500', new RconSafeMessage],
        ]);

        $countdown = $request->input('countdown');
        $message = $request->input('message');
        $branch = $request->input('branch');

        if ($countdown) {
            $warningMessage = RconSanitizer::message($message ?? "Server updating in {$countdown} seconds");

            try {
                $this->rcon->connect();
                $this->rcon->command("servermsg \"{$warningMessage}\"");
            } catch (\Throwable) {
                // RCON unavailable — still schedule the update
            }

            SendServerWarning::dispatchCountdownWarnings($countdown, 'updating', 'server.pending_action:update');
        }

        UpdateGameServer::dispatch($request->ip(), $branch)
            ->delay($countdown ? now()->addSeconds($countdown) : null);

        return response()->json([
            'message' => $countdown
                ? "Server update scheduled in {$countdown} seconds"
                : 'Server update initiated',
        ]);
    }

    public function logs(ServerLogsRequest $request): JsonResponse
    {
        $tail = $request->validated('tail', 100);
        $since = $request->validated('since');

        $sinceTimestamp = $since ? (string) Carbon::parse($since)->timestamp : null;

        try {
            $lines = $this->docker->getContainerLogs($tail, $sinceTimestamp);
        } catch (\Throwable $e) {
            return response()->json([
                'error' => 'Cannot retrieve logs: Docker daemon unavailable',
                'detail' => $e->getMessage(),
            ], 503);
        }

        return response()->json([
            'lines' => $lines,
            'count' => count($lines),
        ]);
    }

}
