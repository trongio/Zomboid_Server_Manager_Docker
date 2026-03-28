<?php

use App\Http\Controllers\Api\AuditLogController;
use App\Http\Controllers\Api\BackupController;
use App\Http\Controllers\Api\ConfigController;
use App\Http\Controllers\Api\HealthController;
use App\Http\Controllers\Api\ModController;
use App\Http\Controllers\Api\PlayerController;
use App\Http\Controllers\Api\ServerController;
use App\Http\Controllers\Api\WhitelistController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/health', [HealthController::class, 'index']);
Route::get('/health/detailed', [HealthController::class, 'detailed'])->middleware('auth.apikey');

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
    Route::post('/server/update', [ServerController::class, 'update']);
    Route::get('/server/version', [ServerController::class, 'version']);
    Route::get('/server/logs', [ServerController::class, 'logs']);

    Route::get('/config/server', [ConfigController::class, 'showServer']);
    Route::patch('/config/server', [ConfigController::class, 'updateServer']);
    Route::get('/config/sandbox', [ConfigController::class, 'showSandbox']);
    Route::patch('/config/sandbox', [ConfigController::class, 'updateSandbox']);

    Route::get('/players', [PlayerController::class, 'index']);
    Route::get('/players/{name}', [PlayerController::class, 'show']);
    Route::post('/players/{name}/kick', [PlayerController::class, 'kick']);
    Route::post('/players/{name}/ban', [PlayerController::class, 'ban']);
    Route::delete('/players/{name}/ban', [PlayerController::class, 'unban']);
    Route::post('/players/{name}/setaccess', [PlayerController::class, 'setAccessLevel']);
    Route::post('/players/{name}/teleport', [PlayerController::class, 'teleport']);
    Route::post('/players/{name}/additem', [PlayerController::class, 'addItem']);
    Route::post('/players/{name}/addxp', [PlayerController::class, 'addXp']);
    Route::post('/players/{name}/godmode', [PlayerController::class, 'godmode']);

    Route::get('/config/mods', [ModController::class, 'index']);
    Route::post('/config/mods', [ModController::class, 'store']);
    Route::delete('/config/mods/{workshopId}', [ModController::class, 'destroy']);
    Route::put('/config/mods/order', [ModController::class, 'reorder']);

    Route::get('/backups', [BackupController::class, 'index']);
    Route::post('/backups', [BackupController::class, 'store']);
    Route::delete('/backups/{backup}', [BackupController::class, 'destroy']);
    Route::post('/backups/{backup}/rollback', [BackupController::class, 'rollback']);
    Route::get('/backups/schedule', [BackupController::class, 'schedule']);
    Route::put('/backups/schedule', [BackupController::class, 'updateSchedule']);

    Route::get('/whitelist', [WhitelistController::class, 'index']);
    Route::post('/whitelist', [WhitelistController::class, 'store']);
    Route::delete('/whitelist/{username}', [WhitelistController::class, 'destroy']);
    Route::get('/whitelist/{username}/status', [WhitelistController::class, 'status']);
    Route::post('/whitelist/sync', [WhitelistController::class, 'sync']);
});
