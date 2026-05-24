<?php

use App\Http\Controllers\Admin;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\PlayerProfileController;
use App\Http\Controllers\PortalController;
use App\Http\Controllers\RankingsController;
use App\Http\Controllers\ShopController;
use App\Http\Controllers\StatusController;
use App\Http\Controllers\WelcomeController;
use Illuminate\Support\Facades\Route;

Route::get('/', WelcomeController::class)->name('home');

Route::get('status', StatusController::class)->name('status');
Route::get('rankings', RankingsController::class)->name('rankings');
Route::get('rankings/{username}', PlayerProfileController::class)->name('rankings.player');

// Public shop browse (no auth required)
Route::prefix('shop')->name('shop.')->group(function () {
    Route::get('/', [ShopController::class, 'index'])->name('index');
    Route::get('bundle/{slug}', [ShopController::class, 'showBundle'])->name('bundle.show');
    Route::get('{slug}', [ShopController::class, 'show'])->name('show');
});

Route::middleware(['auth'])->group(function () {
    Route::get('portal', PortalController::class)->name('portal');

    // Auth-only shop actions
    Route::prefix('shop')->name('shop.')->group(function () {
        Route::get('my/purchases', [ShopController::class, 'myPurchases'])->name('my.purchases');
        Route::get('my/wallet', [ShopController::class, 'myWallet'])->name('my.wallet');
        Route::post('deposit', [ShopController::class, 'requestDeposit'])->name('deposit')->middleware('throttle:3,1');
        Route::get('deposit/status', [ShopController::class, 'depositStatus'])->name('deposit.status')->middleware('throttle:30,1');
        Route::get('purchase/{purchaseId}/status', [ShopController::class, 'purchaseStatus'])->name('purchase.status')->middleware('throttle:30,1');
        Route::post('bundle/{slug}/purchase', [ShopController::class, 'purchaseBundle'])->name('bundle.purchase')->middleware('throttle:10,1');
        Route::post('{slug}/purchase', [ShopController::class, 'purchaseItem'])->name('purchase')->middleware('throttle:10,1');
    });
});

Route::middleware(['auth', 'admin', 'throttle:admin'])->group(function () {
    Route::get('dashboard', DashboardController::class)->name('dashboard');

    Route::prefix('admin')->name('admin.')->group(function () {
        // Players
        Route::get('players', [Admin\PlayerController::class, 'index'])->name('players');
        Route::get('players/map', Admin\PlayerMapController::class)->name('players.map');

        // Player Inventory
        Route::get('players/{username}/inventory', [Admin\InventoryController::class, 'show'])->name('players.inventory');
        Route::post('players/{username}/inventory/give', [Admin\InventoryController::class, 'giveItem'])->name('players.inventory.give');
        Route::post('players/{username}/inventory/remove', [Admin\InventoryController::class, 'removeItem'])->name('players.inventory.remove');
        Route::get('players/{username}/inventory/status', [Admin\InventoryController::class, 'deliveryStatus'])->name('players.inventory.status');

        // Map Tiles — Leaflet pulls dozens of tiles per viewport, override the
        // shared 60/min admin throttle with a much higher per-second limit so a
        // pan/zoom burst doesn't trip a 429.
        Route::get('map-tiles/{level}/{tile}', [Admin\PlayerMapController::class, 'tile'])
            ->name('map.tile')
            ->where('tile', '.*')
            ->withoutMiddleware('throttle:admin')
            ->middleware('throttle:600,1');

        // WebGL renderer data API — sprite atlas (served by nginx alias for atlas/sprites,
        // PHP only handles cell binary lookup which needs traversal protection).
        // Cell endpoints get their own high-rate throttle: a single canvas tile
        // fans out to ~10-20 cells × 2 binaries, and a fresh 5×5 viewport easily
        // bursts 500+ requests in the first second. The shared 60/min admin
        // limiter would 429 on the first pan. Browser cache (max-age=300/3600)
        // absorbs repeated requests, so this limiter only catches the initial
        // burst and a few cache misses per pan.
        Route::prefix('api/pz-map')->name('api.pz-map.')->group(function () {
            Route::get('manifest.json', [Admin\PzMapDataController::class, 'manifest'])->name('manifest');
            Route::get('cells.json', [Admin\PzMapDataController::class, 'cellsManifest'])->name('cells');
            Route::get('sprites.json', [Admin\PzMapDataController::class, 'spritesIndex'])->name('sprites');
            Route::get('atlas/{page}.webp', [Admin\PzMapDataController::class, 'atlas'])->name('atlas')->where('page', '[A-Za-z0-9_.-]+');

            Route::middleware(['throttle:1200,1'])->withoutMiddleware('throttle:admin')->group(function () {
                Route::get('cell/{x}/{y}/header', [Admin\PzMapDataController::class, 'cellHeader'])->name('cell.header')->where(['x' => '\d+', 'y' => '\d+']);
                Route::get('cell/{x}/{y}/lotpack', [Admin\PzMapDataController::class, 'cellLotpack'])->name('cell.lotpack')->where(['x' => '\d+', 'y' => '\d+']);
                Route::get('cell/{x}/{y}/save', [Admin\PzMapDataController::class, 'saveCellData'])->name('cell.save')->where(['x' => '\d+', 'y' => '\d+']);
                Route::get('cells/bulk', [Admin\PzMapDataController::class, 'cellsBulk'])->name('cells.bulk');
                Route::get('save/noise-prefixes', [Admin\PzSaveFilterController::class, 'show'])->name('save.noise.show');
                Route::post('save/noise-prefixes', [Admin\PzSaveFilterController::class, 'update'])->name('save.noise.update');
            });
        });

        // Map Render schedule + quality (non-destructive)
        Route::put('map/render/schedule', [Admin\MapRenderController::class, 'updateSchedule'])->name('map.render.schedule.update');
        Route::put('map/render/quality', [Admin\MapRenderController::class, 'updateQuality'])->name('map.render.quality.update');
        Route::get('map/render/atlas-status', [Admin\MapRenderController::class, 'atlasStatus'])->name('map.render.atlas.status');
        Route::post('map/render/atlas/build', [Admin\MapRenderController::class, 'buildAtlas'])->name('map.render.atlas.build');
        Route::post('map/render/atlas/build/cancel', [Admin\MapRenderController::class, 'cancelBuildAtlas'])->name('map.render.atlas.build.cancel');

        // Config
        Route::get('config', [Admin\ConfigController::class, 'index'])->name('config');
        Route::patch('config/server', [Admin\ConfigController::class, 'updateServer'])->name('config.server.update');
        Route::patch('config/sandbox', [Admin\ConfigController::class, 'updateSandbox'])->name('config.sandbox.update');
        Route::post('config/import/preview', [Admin\ConfigController::class, 'importPreview'])->name('config.import.preview');
        Route::post('config/import/apply', [Admin\ConfigController::class, 'importApply'])->name('config.import.apply');
        Route::get('config/export/{type}', [Admin\ConfigController::class, 'export'])->name('config.export')->where('type', 'server|sandbox');

        // Mods
        Route::get('mods', [Admin\ModController::class, 'index'])->name('mods');
        Route::post('mods/lookup', [Admin\ModController::class, 'lookup'])->name('mods.lookup');
        Route::post('mods', [Admin\ModController::class, 'store'])->name('mods.store');
        Route::delete('mods/{workshopId}', [Admin\ModController::class, 'destroy'])->name('mods.destroy');
        Route::put('mods/order', [Admin\ModController::class, 'reorder'])->name('mods.reorder');

        // Backups
        Route::get('backups', [Admin\BackupController::class, 'index'])->name('backups');
        Route::get('backups/{backup}/download', [Admin\BackupController::class, 'download'])->name('backups.download');
        Route::post('backups', [Admin\BackupController::class, 'store'])->name('backups.store');
        Route::delete('backups', [Admin\BackupController::class, 'destroyBulk'])->name('backups.destroy-bulk');
        Route::delete('backups/{backup}', [Admin\BackupController::class, 'destroy'])->name('backups.destroy');

        // Whitelist
        Route::get('whitelist', [Admin\WhitelistController::class, 'index'])->name('whitelist');
        Route::patch('whitelist/settings', [Admin\WhitelistController::class, 'updateSettings'])->name('whitelist.settings');
        Route::post('whitelist', [Admin\WhitelistController::class, 'store'])->name('whitelist.store');
        Route::delete('whitelist/{username}', [Admin\WhitelistController::class, 'destroy'])->name('whitelist.destroy');
        Route::post('whitelist/{username}/toggle', [Admin\WhitelistController::class, 'toggle'])->name('whitelist.toggle');
        Route::post('whitelist/sync', [Admin\WhitelistController::class, 'sync'])->name('whitelist.sync');

        // Audit Log
        Route::get('audit', [Admin\AuditController::class, 'index'])->name('audit');

        // RCON Console
        Route::get('rcon', [Admin\RconController::class, 'index'])->name('rcon');

        // Server Logs
        Route::get('logs', [Admin\LogController::class, 'index'])->name('logs');
        Route::get('logs/fetch', [Admin\LogController::class, 'fetch'])->name('logs.fetch');

        // Discord Webhook
        Route::get('discord', [Admin\DiscordWebhookController::class, 'index'])->name('discord');
        Route::patch('discord', [Admin\DiscordWebhookController::class, 'update'])->name('discord.update');
        Route::post('discord/test', [Admin\DiscordWebhookController::class, 'test'])->name('discord.test');

        // Auto Restart
        Route::get('auto-restart', [Admin\AutoRestartController::class, 'index'])->name('auto-restart');
        Route::patch('auto-restart', [Admin\AutoRestartController::class, 'update'])->name('auto-restart.update');
        Route::post('auto-restart/times', [Admin\AutoRestartController::class, 'storeTime'])->name('auto-restart.times.store');
        Route::delete('auto-restart/times/{time}', [Admin\AutoRestartController::class, 'destroyTime'])->name('auto-restart.times.destroy');
        Route::post('auto-restart/times/{time}/toggle', [Admin\AutoRestartController::class, 'toggleTime'])->name('auto-restart.times.toggle');

        // Respawn Delay
        Route::get('respawn-delay', [Admin\RespawnDelayController::class, 'index'])->name('respawn-delay.index');
        Route::patch('respawn-delay', [Admin\RespawnDelayController::class, 'update'])->name('respawn-delay.update');
        Route::post('respawn-delay/{username}/reset', [Admin\RespawnDelayController::class, 'reset'])->name('respawn-delay.reset');

        // Moderation
        Route::get('moderation', [Admin\ModerationController::class, 'index'])->name('moderation');

        // Safe Zones
        Route::get('safe-zones', [Admin\SafeZoneController::class, 'index'])->name('safe-zones.index');
        Route::patch('safe-zones/config', [Admin\SafeZoneController::class, 'updateConfig'])->name('safe-zones.config.update');
        Route::post('safe-zones', [Admin\SafeZoneController::class, 'store'])->name('safe-zones.store');
        Route::delete('safe-zones/{zoneId}', [Admin\SafeZoneController::class, 'destroy'])->name('safe-zones.destroy');
        Route::post('safe-zones/violations/{id}/resolve', [Admin\SafeZoneController::class, 'resolveViolation'])->name('safe-zones.violations.resolve');

        // Shop Management
        Route::get('shop', [Admin\ShopController::class, 'index'])->name('shop');
        Route::post('shop/categories', [Admin\ShopController::class, 'storeCategory'])->name('shop.categories.store');
        Route::patch('shop/categories/{category}', [Admin\ShopController::class, 'updateCategory'])->name('shop.categories.update');
        Route::delete('shop/categories/{category}', [Admin\ShopController::class, 'destroyCategory'])->name('shop.categories.destroy');
        Route::post('shop/items', [Admin\ShopController::class, 'storeItem'])->name('shop.items.store');
        Route::patch('shop/items/{item}', [Admin\ShopController::class, 'updateItem'])->name('shop.items.update');
        Route::delete('shop/items/{item}', [Admin\ShopController::class, 'destroyItem'])->name('shop.items.destroy');
        Route::post('shop/items/{item}/toggle', [Admin\ShopController::class, 'toggleItem'])->name('shop.items.toggle');

        // Shop Purchases (admin)
        Route::get('shop/purchases', [Admin\ShopPurchaseController::class, 'index'])->name('shop.purchases');

        // Shop Bundles
        Route::get('shop/bundles', [Admin\ShopBundleController::class, 'index'])->name('shop.bundles');
        Route::post('shop/bundles', [Admin\ShopBundleController::class, 'store'])->name('shop.bundles.store');
        Route::patch('shop/bundles/{bundle}', [Admin\ShopBundleController::class, 'update'])->name('shop.bundles.update');
        Route::delete('shop/bundles/{bundle}', [Admin\ShopBundleController::class, 'destroy'])->name('shop.bundles.destroy');

        // Shop Promotions
        Route::get('shop/promotions', [Admin\ShopPromotionController::class, 'index'])->name('shop.promotions');
        Route::post('shop/promotions', [Admin\ShopPromotionController::class, 'store'])->name('shop.promotions.store');
        Route::patch('shop/promotions/{promotion}', [Admin\ShopPromotionController::class, 'update'])->name('shop.promotions.update');
        Route::delete('shop/promotions/{promotion}', [Admin\ShopPromotionController::class, 'destroy'])->name('shop.promotions.destroy');
        Route::post('shop/promotions/{promotion}/toggle', [Admin\ShopPromotionController::class, 'toggle'])->name('shop.promotions.toggle');

        // Wallets
        Route::get('wallets', [Admin\WalletController::class, 'index'])->name('wallets');
        Route::post('wallets/{user}/credit', [Admin\WalletController::class, 'credit'])->name('wallets.credit');
        Route::post('wallets/{user}/reset', [Admin\WalletController::class, 'resetBalance'])->name('wallets.reset');
        Route::get('wallets/{user}/transactions', [Admin\WalletController::class, 'transactions'])->name('wallets.transactions');

        // Server Settings (connection info)
        Route::patch('server-settings', [Admin\ServerSettingController::class, 'update'])->name('server-settings.update');

        // Site Settings (branding, landing page, theme)
        Route::get('site-settings', [Admin\SiteSettingController::class, 'index'])->name('site-settings');

        // Translations & Languages (read-only)
        Route::get('translations', [Admin\TranslationController::class, 'index'])->name('translations');
        Route::get('translations/export/{locale}', [Admin\TranslationController::class, 'exportLocale'])->name('translations.export');

        // Sensitive admin actions — stricter rate limit
        Route::middleware('throttle:admin-sensitive')->group(function () {
            // Site Settings (write)
            Route::post('site-settings', [Admin\SiteSettingController::class, 'update'])->name('site-settings.update');
            Route::delete('site-settings/logo', [Admin\SiteSettingController::class, 'removeLogo'])->name('site-settings.remove-logo');
            Route::delete('site-settings/favicon', [Admin\SiteSettingController::class, 'removeFavicon'])->name('site-settings.remove-favicon');

            // Translations & Languages (write)
            Route::patch('translations', [Admin\TranslationController::class, 'updateTranslation'])->name('translations.update');
            Route::delete('translations', [Admin\TranslationController::class, 'deleteTranslation'])->name('translations.delete');
            Route::post('translations/import', [Admin\TranslationController::class, 'importLocale'])->name('translations.import');
            Route::post('languages', [Admin\TranslationController::class, 'storeLanguage'])->name('languages.store');
            Route::patch('languages/{language}', [Admin\TranslationController::class, 'updateLanguage'])->name('languages.update');
            Route::delete('languages/{language}', [Admin\TranslationController::class, 'destroyLanguage'])->name('languages.destroy');

            Route::post('backups/import', [Admin\BackupController::class, 'importWorld'])->name('backups.import');
            Route::post('players/{name}/access', [Admin\PlayerController::class, 'setAccessLevel'])->name('players.access');
            Route::post('players/{name}/kick', [Admin\PlayerController::class, 'kick'])->name('players.kick');
            Route::post('players/{name}/ban', [Admin\PlayerController::class, 'ban'])->name('players.ban');
            Route::post('players/{name}/password', [Admin\PlayerController::class, 'setPassword'])->name('players.password');
            Route::post('backups/{backup}/rollback', [Admin\BackupController::class, 'rollback'])->name('backups.rollback');
            Route::post('rcon', [Admin\RconController::class, 'execute'])->name('rcon.execute');
            Route::post('server/start', [Admin\ServerController::class, 'start'])->name('server.start');
            Route::post('server/stop', [Admin\ServerController::class, 'stop'])->name('server.stop');
            Route::post('server/restart', [Admin\ServerController::class, 'restart'])->name('server.restart');
            Route::post('server/save', [Admin\ServerController::class, 'save'])->name('server.save');
            Route::post('server/update', [Admin\ServerController::class, 'update'])->name('server.update');

            // Map render engine
            Route::post('map/render/engine/enable', [Admin\MapRenderController::class, 'enableEngine'])->name('map.render.engine.enable');
            Route::post('map/render/engine/disable', [Admin\MapRenderController::class, 'disableEngine'])->name('map.render.engine.disable');
            Route::post('map/render/start', [Admin\MapRenderController::class, 'startRender'])->name('map.render.start');
            Route::post('map/render/cancel', [Admin\MapRenderController::class, 'cancelRender'])->name('map.render.cancel');
            Route::post('map/render/pause', [Admin\MapRenderController::class, 'pauseRender'])->name('map.render.pause');
            Route::post('map/render/resume', [Admin\MapRenderController::class, 'resumeRender'])->name('map.render.resume');
            Route::post('map/render/texturepacks', [Admin\MapRenderController::class, 'uploadTexturepacks'])->name('map.render.texturepacks.upload');
            Route::delete('map/render/texturepacks', [Admin\MapRenderController::class, 'deleteTexturepacks'])->name('map.render.texturepacks.delete');
            Route::put('map/render/atlas-url', [Admin\MapRenderController::class, 'updateAtlasUrl'])->name('map.render.atlas.url.update');
            Route::post('map/render/atlas/download', [Admin\MapRenderController::class, 'downloadAtlas'])->name('map.render.atlas.download');
        });

        // Destructive actions — very strict rate limit
        Route::post('server/wipe', [Admin\ServerController::class, 'wipe'])
            ->name('server.wipe')
            ->middleware('throttle:admin-destructive');
    });
});

require __DIR__.'/settings.php';
