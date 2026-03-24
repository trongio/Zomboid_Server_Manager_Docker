<?php

namespace App\Jobs;

use App\Services\RconClient;
use App\Services\RconSanitizer;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Cache;

class SendServerWarning implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    /** @var int[] Reminder thresholds in seconds */
    private const THRESHOLDS = [1800, 900, 600, 300, 240, 180, 120, 60, 30];

    public function __construct(
        private readonly string $message,
        private readonly string $cacheKey,
    ) {}

    public function handle(RconClient $rcon): void
    {
        if (! Cache::has($this->cacheKey)) {
            return;
        }

        try {
            $rcon->connect();
            $rcon->command("servermsg \"".RconSanitizer::message($this->message)."\"");
        } catch (\Throwable) {
            // RCON unavailable — skip this warning silently
        }
    }

    /**
     * Schedule countdown warning jobs for a pending server action.
     */
    public static function dispatchCountdownWarnings(int $countdown, string $actionLabel, string $cacheKey): void
    {
        Cache::put($cacheKey, true, $countdown);

        foreach (self::THRESHOLDS as $threshold) {
            if ($threshold >= $countdown) {
                continue;
            }

            $message = 'Server '.$actionLabel.' in '.self::formatSeconds($threshold);
            $delay = $countdown - $threshold;

            self::dispatch($message, $cacheKey)
                ->delay(now()->addSeconds($delay));
        }
    }

    /**
     * Format seconds into a human-readable duration string.
     */
    private static function formatSeconds(int $seconds): string
    {
        if ($seconds >= 60) {
            $minutes = intdiv($seconds, 60);

            return $minutes === 1 ? '1 minute' : "{$minutes} minutes";
        }

        return "{$seconds} seconds";
    }
}
