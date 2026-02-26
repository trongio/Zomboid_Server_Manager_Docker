<?php

use App\Http\Controllers\Admin;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\PortalController;
use App\Http\Controllers\StatusController;
use Illuminate\Support\Facades\Route;
use Laravel\Fortify\Features;

Route::inertia('/', 'welcome', [
    'canRegister' => Features::enabled(Features::registration()),
])->name('home');

Route::get('status', StatusController::class)->name('status');

Route::middleware(['auth'])->group(function () {
    Route::get('portal', PortalController::class)->name('portal');
});

Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('dashboard', DashboardController::class)->name('dashboard');

    Route::prefix('admin')->name('admin.')->group(function () {
        // Players
        Route::get('players', [Admin\PlayerController::class, 'index'])->name('players');
        Route::post('players/{name}/kick', [Admin\PlayerController::class, 'kick'])->name('players.kick');
        Route::post('players/{name}/ban', [Admin\PlayerController::class, 'ban'])->name('players.ban');
        Route::post('players/{name}/access', [Admin\PlayerController::class, 'setAccessLevel'])->name('players.access');

        // Config
        Route::get('config', [Admin\ConfigController::class, 'index'])->name('config');
        Route::patch('config/server', [Admin\ConfigController::class, 'updateServer'])->name('config.server.update');
        Route::patch('config/sandbox', [Admin\ConfigController::class, 'updateSandbox'])->name('config.sandbox.update');

        // Mods
        Route::get('mods', [Admin\ModController::class, 'index'])->name('mods');
        Route::post('mods', [Admin\ModController::class, 'store'])->name('mods.store');
        Route::delete('mods/{workshopId}', [Admin\ModController::class, 'destroy'])->name('mods.destroy');
        Route::put('mods/order', [Admin\ModController::class, 'reorder'])->name('mods.reorder');

        // Backups
        Route::get('backups', [Admin\BackupController::class, 'index'])->name('backups');
        Route::post('backups', [Admin\BackupController::class, 'store'])->name('backups.store');
        Route::delete('backups/{backup}', [Admin\BackupController::class, 'destroy'])->name('backups.destroy');
        Route::post('backups/{backup}/rollback', [Admin\BackupController::class, 'rollback'])->name('backups.rollback');

        // Whitelist
        Route::get('whitelist', [Admin\WhitelistController::class, 'index'])->name('whitelist');
        Route::post('whitelist', [Admin\WhitelistController::class, 'store'])->name('whitelist.store');
        Route::delete('whitelist/{username}', [Admin\WhitelistController::class, 'destroy'])->name('whitelist.destroy');
        Route::post('whitelist/sync', [Admin\WhitelistController::class, 'sync'])->name('whitelist.sync');

        // Audit Log
        Route::get('audit', [Admin\AuditController::class, 'index'])->name('audit');

        // RCON Console
        Route::get('rcon', [Admin\RconController::class, 'index'])->name('rcon');
        Route::post('rcon', [Admin\RconController::class, 'execute'])->name('rcon.execute');

        // Server Logs
        Route::get('logs', [Admin\LogController::class, 'index'])->name('logs');
        Route::get('logs/fetch', [Admin\LogController::class, 'fetch'])->name('logs.fetch');

        // Server Control
        Route::post('server/start', [Admin\ServerController::class, 'start'])->name('server.start');
        Route::post('server/stop', [Admin\ServerController::class, 'stop'])->name('server.stop');
        Route::post('server/restart', [Admin\ServerController::class, 'restart'])->name('server.restart');
        Route::post('server/save', [Admin\ServerController::class, 'save'])->name('server.save');
    });
});

require __DIR__.'/settings.php';
