<?php

namespace Database\Factories;

use App\Models\GameEvent;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<GameEvent> */
class GameEventFactory extends Factory
{
    protected $model = GameEvent::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'event_type' => fake()->randomElement(['death', 'pvp_kill', 'connect', 'disconnect']),
            'player' => fake()->userName(),
            'target' => null,
            'details' => null,
            'x' => fake()->numberBetween(5000, 15000),
            'y' => fake()->numberBetween(5000, 15000),
            'game_time' => fake()->dateTimeBetween('-7 days'),
        ];
    }

    public function pvpKill(): static
    {
        return $this->state([
            'event_type' => 'pvp_kill',
            'target' => fake()->userName(),
            'details' => [
                'weapon' => fake()->randomElement(['Base.Axe', 'Base.Shotgun', 'Base.BaseballBat']),
                'damage' => fake()->randomFloat(1, 10, 100),
                'victim_x' => fake()->numberBetween(5000, 15000),
                'victim_y' => fake()->numberBetween(5000, 15000),
            ],
        ]);
    }

    public function death(): static
    {
        return $this->state([
            'event_type' => 'death',
            'target' => null,
            'details' => ['raw' => 'died at '.fake()->numberBetween(5000, 15000).','.fake()->numberBetween(5000, 15000).',0.'],
        ]);
    }

    public function connect(): static
    {
        return $this->state([
            'event_type' => 'connect',
            'target' => null,
            'details' => null,
            'x' => null,
            'y' => null,
        ]);
    }

    public function disconnect(): static
    {
        return $this->state([
            'event_type' => 'disconnect',
            'target' => null,
            'details' => null,
            'x' => null,
            'y' => null,
        ]);
    }
}
