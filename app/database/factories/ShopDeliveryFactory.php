<?php

namespace Database\Factories;

use App\Enums\DeliveryStatus;
use App\Models\ShopDelivery;
use App\Models\ShopPurchase;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<ShopDelivery> */
class ShopDeliveryFactory extends Factory
{
    protected $model = ShopDelivery::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'shop_purchase_id' => ShopPurchase::factory(),
            'username' => fake()->userName(),
            'item_type' => 'Base.'.fake()->word(),
            'quantity' => 1,
            'status' => DeliveryStatus::Pending,
            'attempts' => 0,
        ];
    }
}
