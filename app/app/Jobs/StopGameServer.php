<?php

namespace App\Jobs;

use App\Services\AuditLogger;
use App\Services\DockerManager;
use App\Services\RconClient;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

class StopGameServer implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public function __construct(
        private readonly string $ip,
    ) {}

    public function handle(RconClient $rcon, DockerManager $docker): void
    {
        try {
            $rcon->connect();
            $rcon->command('save');
            sleep(5);
            $rcon->command('quit');
        } catch (\Throwable $e) {
            Log::warning('RCON unavailable during scheduled stop, proceeding with Docker stop', [
                'error' => $e->getMessage(),
            ]);
        }

        $docker->stopContainer(timeout: 30);

        AuditLogger::record(
            actor: 'system',
            action: 'server.stop.executed',
            target: config('zomboid.docker.container_name'),
            details: ['source' => 'scheduled_job'],
            ip: $this->ip,
        );
    }
}
