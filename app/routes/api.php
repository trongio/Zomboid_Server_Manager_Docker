<?php

use App\Http\Controllers\Api\AuditLogController;
use App\Http\Controllers\Api\HealthController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/health', HealthController::class);

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

Route::middleware(['auth.apikey', 'audit'])->group(function () {
    Route::get('/audit', [AuditLogController::class, 'index']);
});
