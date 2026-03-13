<?php

namespace Database\Factories;

use App\Enums\TransactionSource;
use App\Enums\TransactionType;
use App\Models\Wallet;
use App\Models\WalletTransaction;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<WalletTransaction> */
class WalletTransactionFactory extends Factory
{
    protected $model = WalletTransaction::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'wallet_id' => Wallet::factory(),
            'type' => TransactionType::Credit,
            'amount' => fake()->randomFloat(2, 1, 100),
            'balance_after' => fake()->randomFloat(2, 0, 1000),
            'source' => TransactionSource::AdminAward,
            'description' => fake()->sentence(),
        ];
    }
}
