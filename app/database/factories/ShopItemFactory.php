<?php

namespace Database\Factories;

use App\Models\ShopCategory;
use App\Models\ShopItem;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/** @extends Factory<ShopItem> */
class ShopItemFactory extends Factory
{
    protected $model = ShopItem::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        $name = fake()->unique()->words(2, true);

        return [
            'category_id' => ShopCategory::factory(),
            'name' => $name,
            'slug' => Str::slug($name),
            'description' => fake()->sentence(),
            'item_type' => 'Base.'.fake()->word(),
            'quantity' => 1,
            'price' => fake()->randomFloat(2, 1, 500),
            'is_active' => true,
            'is_featured' => false,
        ];
    }

    public function inactive(): static
    {
        return $this->state(['is_active' => false]);
    }

    public function featured(): static
    {
        return $this->state(['is_featured' => true]);
    }

    public function withStock(int $stock): static
    {
        return $this->state(['stock' => $stock]);
    }

    public function withMaxPerPlayer(int $max): static
    {
        return $this->state(['max_per_player' => $max]);
    }
}
