<?php

namespace App\Console\Commands;

use App\Services\PlayerStatsService;
use Illuminate\Console\Command;

class SyncPlayerStats extends Command
{
    protected $signature = 'zomboid:sync-player-stats';

    protected $description = 'Sync player stats from Lua bridge JSON to the database';

    public function handle(PlayerStatsService $service): int
    {
        $count = $service->sync();

        if ($count > 0) {
            $this->info("Synced stats for {$count} player(s).");
        } else {
            $this->info('No player stats to sync (file missing or empty).');
        }

        return self::SUCCESS;
    }
}
