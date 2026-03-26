<?php

use App\Enums\BackupType;
use App\Jobs\CreateBackupJob;
use Illuminate\Support\Facades\Schedule;

Schedule::job(new CreateBackupJob(BackupType::Scheduled))
    ->everyFourHours()
    ->when(function () {
        try {
            return cache()->get('backup.schedule.hourly_enabled', true);
        } catch (\Throwable) {
            return true;
        }
    });

Schedule::command('pz:sync-accounts')->everyFiveMinutes();

Schedule::command('zomboid:sync-player-stats')->everyTenMinutes();

Schedule::command('zomboid:auto-restart-check')->everyMinute();

Schedule::command('zomboid:import-pvp-violations')->everyFiveMinutes();

Schedule::command('zomboid:import-pvp-kills')->everyFiveMinutes();

Schedule::command('zomboid:process-respawn-kicks')->everyFiveMinutes();

Schedule::command('zomboid:parse-game-events')->everyFiveMinutes();

Schedule::command('zomboid:process-shop-deliveries')->everyMinute();

Schedule::command('zomboid:process-money-deposits')->everyMinute();

Schedule::command('zomboid:generate-map-tiles')
    ->everyThirtyMinutes()
    ->when(fn () => ! is_dir(config('zomboid.map.tiles_path').'/html/map_data/base/layer0_files'))
    ->runInBackground();

Schedule::command('zomboid:download-item-icons')
    ->hourly()
    ->when(function () {
        $catalog = config('zomboid.lua_bridge.items_catalog');

        return file_exists($catalog) && ! glob(public_path('images/items/*.png'));
    })
    ->runInBackground();

Schedule::job(new CreateBackupJob(BackupType::Daily))
    ->dailyAt('04:00')
    ->when(function () {
        try {
            return cache()->get('backup.schedule.daily_enabled', true);
        } catch (\Throwable) {
            return true;
        }
    });
