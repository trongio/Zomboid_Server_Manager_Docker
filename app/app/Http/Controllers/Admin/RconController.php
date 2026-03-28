<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\ExecuteRconRequest;
use App\Services\AuditLogger;
use App\Services\RconClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Inertia\Inertia;
use Inertia\Response;

class RconController extends Controller
{
    public function __construct(
        private readonly RconClient $rcon,
        private readonly AuditLogger $auditLogger,
    ) {}

    public function index(): Response
    {
        return Inertia::render('admin/rcon');
    }

    public function execute(ExecuteRconRequest $request): JsonResponse
    {
        $command = $request->validated('command');

        try {
            $this->rcon->connect();
            $response = $this->rcon->command($command);
        } catch (\Throwable $e) {
            Log::error('RCON command failed', ['command_verb' => explode(' ', $command, 2)[0], 'error' => $e->getMessage()]);

            $errorMessage = app()->isProduction()
                ? 'RCON command failed — server may be offline'
                : 'RCON failed: '.$e->getMessage();

            return response()->json([
                'error' => $errorMessage,
                'command' => $command,
            ], 503);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'rcon.execute',
            target: $command,
            details: ['response_length' => strlen($response)],
            ip: $request->ip(),
        );

        return response()->json([
            'command' => $command,
            'response' => $response,
        ]);
    }
}
