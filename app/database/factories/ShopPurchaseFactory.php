<?php

namespace Database\Factories;

use App\Enums\DeliveryStatus;
use App\Models\ShopItem;
use App\Models\ShopPurchase;
use App\Models\User;
use App\Models\WalletTransaction;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<ShopPurchase> */
class ShopPurchaseFactory extends Factory
{
    protected $model = ShopPurchase::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'wallet_transaction_id' => WalletTransaction::factory(),
            'purchasable_type' => ShopItem::class,
            'purchasable_id' => ShopItem::factory(),
            'quantity_bought' => 1,
            'total_price' => fake()->randomFloat(2, 1, 500),
            'discount_amount' => 0,
            'delivery_status' => DeliveryStatus::Pending,
        ];
    }
}
