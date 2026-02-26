<?php

namespace Database\Factories;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<AuditLog> */
class AuditLogFactory extends Factory
{
    protected $model = AuditLog::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'actor' => 'api-key',
            'action' => fake()->randomElement([
                'server.start',
                'server.stop',
                'server.restart',
                'server.save',
                'server.broadcast',
                'config.update',
                'player.kick',
                'player.ban',
                'mod.add',
                'mod.remove',
            ]),
            'target' => fake()->optional()->word(),
            'details' => ['method' => 'POST', 'path' => '/api/server/start'],
            'ip_address' => fake()->ipv4(),
            'created_at' => fake()->dateTimeBetween('-30 days'),
        ];
    }
}
