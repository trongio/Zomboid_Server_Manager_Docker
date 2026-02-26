<?php

use App\Http\Controllers\Api\AuditLogController;
use App\Http\Controllers\Api\ConfigController;
use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\ServerController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/health', HealthController::class);

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

// Public — no auth, no audit
Route::get('/server/status', [ServerController::class, 'status']);

// Admin — requires API key, all actions audited
Route::middleware(['auth.apikey', 'audit'])->group(function () {
    Route::get('/audit', [AuditLogController::class, 'index']);

    Route::post('/server/start', [ServerController::class, 'start']);
    Route::post('/server/stop', [ServerController::class, 'stop']);
    Route::post('/server/restart', [ServerController::class, 'restart']);
    Route::post('/server/save', [ServerController::class, 'save']);
    Route::post('/server/broadcast', [ServerController::class, 'broadcast']);
    Route::get('/server/logs', [ServerController::class, 'logs']);

    Route::get('/config/server', [ConfigController::class, 'showServer']);
    Route::patch('/config/server', [ConfigController::class, 'updateServer']);
    Route::get('/config/sandbox', [ConfigController::class, 'showSandbox']);
    Route::patch('/config/sandbox', [ConfigController::class, 'updateSandbox']);
});
