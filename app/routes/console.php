<?php

use App\Enums\BackupType;
use App\Jobs\CreateBackupJob;
use Illuminate\Support\Facades\Schedule;

Schedule::job(new CreateBackupJob(BackupType::Scheduled))
    ->hourly()
    ->when(function () {
        try {
            return cache()->get('backup.schedule.hourly_enabled', true);
        } catch (\Throwable) {
            return true;
        }
    });

Schedule::command('pz:sync-accounts')->everyFiveMinutes();

Schedule::job(new CreateBackupJob(BackupType::Daily))
    ->dailyAt('04:00')
    ->when(function () {
        try {
            return cache()->get('backup.schedule.daily_enabled', true);
        } catch (\Throwable) {
            return true;
        }
    });
