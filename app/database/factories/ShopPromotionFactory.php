<?php

namespace Database\Factories;

use App\Enums\PromotionScope;
use App\Enums\PromotionType;
use App\Models\ShopPromotion;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<ShopPromotion> */
class ShopPromotionFactory extends Factory
{
    protected $model = ShopPromotion::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'name' => fake()->words(3, true),
            'code' => strtoupper(fake()->unique()->bothify('???###')),
            'type' => PromotionType::Percentage,
            'value' => fake()->randomFloat(2, 5, 50),
            'applies_to' => PromotionScope::All,
            'starts_at' => now()->subDay(),
            'ends_at' => now()->addMonth(),
            'is_active' => true,
        ];
    }

    public function expired(): static
    {
        return $this->state([
            'starts_at' => now()->subMonth(),
            'ends_at' => now()->subDay(),
        ]);
    }

    public function fixedAmount(float $amount): static
    {
        return $this->state([
            'type' => PromotionType::FixedAmount,
            'value' => $amount,
        ]);
    }
}
