<?php

namespace Database\Factories;

use App\Models\User;
use App\Models\Wallet;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Wallet> */
class WalletFactory extends Factory
{
    protected $model = Wallet::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'balance' => 0,
            'total_earned' => 0,
            'total_spent' => 0,
        ];
    }

    public function withBalance(float $amount): static
    {
        return $this->state([
            'balance' => $amount,
            'total_earned' => $amount,
        ]);
    }
}
