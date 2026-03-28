<?php

namespace App\Http\Controllers\Api;

use App\Services\RconClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class HealthController
{
    public function index(RconClient $rcon): JsonResponse
    {
        [$dbOk, $rconOk] = $this->checkServices($rcon);

        return response()->json([
            'status' => ($dbOk && $rconOk) ? 'ok' : 'degraded',
        ]);
    }

    public function detailed(RconClient $rcon): JsonResponse
    {
        [$dbOk, $rconOk] = $this->checkServices($rcon);

        return response()->json([
            'status' => ($dbOk && $rconOk) ? 'ok' : 'degraded',
            'rcon' => $rconOk ? 'connected' : 'disconnected',
            'db' => $dbOk ? 'connected' : 'disconnected',
        ]);
    }

    /**
     * @return array{bool, bool}
     */
    private function checkServices(RconClient $rcon): array
    {
        $dbOk = false;
        try {
            DB::connection()->getPdo();
            $dbOk = true;
        } catch (\Throwable) {
            // DB unavailable
        }

        $rconOk = false;
        try {
            $rcon->connect();
            $rconOk = true;
        } catch (\Throwable) {
            // RCON unavailable
        }

        return [$dbOk, $rconOk];
    }
}
