<?php

namespace App\Console\Commands;

use App\Services\RconClient;
use App\Services\RconSanitizer;
use App\Services\RespawnDelayManager;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class ProcessRespawnKicks extends Command
{
    protected $signature = 'zomboid:process-respawn-kicks';

    protected $description = 'Process respawn delay kick queue from Lua bridge and kick players via RCON';

    public function __construct(
        private readonly RconClient $rcon,
        private readonly RespawnDelayManager $respawnDelay,
    ) {
        parent::__construct();
    }

    public function handle(): int
    {
        $kicksFile = config('zomboid.lua_bridge.respawn_kicks');

        if (! file_exists($kicksFile)) {
            return self::SUCCESS;
        }

        $content = file_get_contents($kicksFile);
        if ($content === false || $content === '') {
            return self::SUCCESS;
        }

        $data = json_decode($content, true);
        if (! is_array($data) || empty($data['kicks'])) {
            return self::SUCCESS;
        }

        // Get current config to calculate accurate remaining time
        $config = $this->respawnDelay->getConfig();
        $deathsData = $this->readDeathRecords();
        $now = time();

        $kicked = 0;
        foreach ($data['kicks'] as $entry) {
            $username = $entry['username'] ?? null;

            if (! $username) {
                continue;
            }

            // Calculate accurate remaining time from death records
            $reason = $this->buildKickReason($username, $config, $deathsData, $now);

            try {
                $safeName = RconSanitizer::playerName($username);
                $safeReason = RconSanitizer::message($reason);
                $command = "kickuser \"{$safeName}\" -r \"{$safeReason}\"";
                $this->rcon->command($command);
                $kicked++;
                $this->info("Kicked {$username}: {$reason}");
            } catch (\Throwable $e) {
                Log::warning("RespawnKick: failed to kick {$username}", ['error' => $e->getMessage()]);
                $this->warn("Failed to kick {$username}: {$e->getMessage()}");
            }
        }

        // Clear the kicks file after processing
        file_put_contents($kicksFile, json_encode(['kicks' => []]));

        if ($kicked > 0) {
            Log::info("RespawnKick: kicked {$kicked} player(s)");
        }

        return self::SUCCESS;
    }

    /**
     * Build a kick reason with accurate remaining time.
     */
    private function buildKickReason(string $username, array $config, array $deaths, int $now): string
    {
        $deathTime = $deaths[$username] ?? null;
        if ($deathTime === null) {
            return 'Respawn cooldown active. Please wait.';
        }

        $delaySeconds = $config['delay_minutes'] * 60;
        $remaining = $delaySeconds - ($now - (int) $deathTime);

        if ($remaining <= 0) {
            return 'Respawn cooldown active. Please wait.';
        }

        $remainingMinutes = (int) ceil($remaining / 60);

        return "Respawn cooldown active. You can rejoin in {$remainingMinutes} minute(s).";
    }

    /**
     * Read death records from the Lua bridge file.
     */
    private function readDeathRecords(): array
    {
        $deathsFile = config('zomboid.lua_bridge.respawn_deaths');

        if (! file_exists($deathsFile)) {
            return [];
        }

        $content = file_get_contents($deathsFile);
        if ($content === false) {
            return [];
        }

        $data = json_decode($content, true);

        return $data['deaths'] ?? [];
    }
}
