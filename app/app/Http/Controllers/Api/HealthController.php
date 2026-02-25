<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\RconClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class HealthController extends Controller
{
    public function __invoke(RconClient $rcon): JsonResponse
    {
        $dbStatus = 'disconnected';
        try {
            DB::connection()->getPdo();
            $dbStatus = 'connected';
        } catch (\Throwable) {
            // DB unavailable
        }

        $rconStatus = 'disconnected';
        try {
            $rcon->connect();
            $rconStatus = 'connected';
        } catch (\Throwable) {
            // RCON unavailable
        }

        return response()->json([
            'status' => 'ok',
            'rcon' => $rconStatus,
            'db' => $dbStatus,
        ]);
    }
}
