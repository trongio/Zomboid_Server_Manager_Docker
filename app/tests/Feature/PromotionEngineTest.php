<?php

use App\Enums\PromotionScope;
use App\Enums\PromotionType;
use App\Models\ShopItem;
use App\Models\ShopPromotion;
use App\Models\User;
use App\Services\PromotionEngine;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->engine = app(PromotionEngine::class);
});

it('calculates percentage discount', function () {
    $item = ShopItem::factory()->create(['price' => 100]);
    $promo = ShopPromotion::factory()->create([
        'type' => PromotionType::Percentage,
        'value' => 20,
        'applies_to' => PromotionScope::All,
        'starts_at' => now()->subDay(),
        'ends_at' => now()->addDay(),
    ]);

    $discount = $this->engine->calculateDiscount($item, 1, $promo);

    expect($discount)->toBe(20.0);
});

it('calculates fixed amount discount', function () {
    $item = ShopItem::factory()->create(['price' => 100]);
    $promo = ShopPromotion::factory()->fixedAmount(25)->create([
        'applies_to' => PromotionScope::All,
        'starts_at' => now()->subDay(),
        'ends_at' => now()->addDay(),
    ]);

    $discount = $this->engine->calculateDiscount($item, 1, $promo);

    expect($discount)->toBe(25.0);
});

it('caps discount at max_discount', function () {
    $item = ShopItem::factory()->create(['price' => 200]);
    $promo = ShopPromotion::factory()->create([
        'type' => PromotionType::Percentage,
        'value' => 50,
        'max_discount' => 30,
        'applies_to' => PromotionScope::All,
        'starts_at' => now()->subDay(),
        'ends_at' => now()->addDay(),
    ]);

    $discount = $this->engine->calculateDiscount($item, 1, $promo);

    expect($discount)->toBe(30.0);
});

it('returns zero for expired promotions', function () {
    $item = ShopItem::factory()->create(['price' => 100]);
    $promo = ShopPromotion::factory()->expired()->create([
        'type' => PromotionType::Percentage,
        'value' => 20,
        'applies_to' => PromotionScope::All,
    ]);

    $discount = $this->engine->calculateDiscount($item, 1, $promo);

    expect($discount)->toBe(0.0);
});

it('returns zero for inactive promotions', function () {
    $item = ShopItem::factory()->create(['price' => 100]);
    $promo = ShopPromotion::factory()->create([
        'type' => PromotionType::Percentage,
        'value' => 20,
        'applies_to' => PromotionScope::All,
        'is_active' => false,
        'starts_at' => now()->subDay(),
        'ends_at' => now()->addDay(),
    ]);

    $discount = $this->engine->calculateDiscount($item, 1, $promo);

    expect($discount)->toBe(0.0);
});

it('respects min_purchase requirement', function () {
    $item = ShopItem::factory()->create(['price' => 10]);
    $promo = ShopPromotion::factory()->create([
        'type' => PromotionType::Percentage,
        'value' => 20,
        'min_purchase' => 50,
        'applies_to' => PromotionScope::All,
        'starts_at' => now()->subDay(),
        'ends_at' => now()->addDay(),
    ]);

    $discount = $this->engine->calculateDiscount($item, 1, $promo);

    expect($discount)->toBe(0.0);
});

it('validates per-user usage limit', function () {
    $user = User::factory()->create();
    $item = ShopItem::factory()->create(['price' => 100]);
    $promo = ShopPromotion::factory()->create([
        'per_user_limit' => 1,
        'applies_to' => PromotionScope::All,
        'starts_at' => now()->subDay(),
        'ends_at' => now()->addDay(),
    ]);

    expect($this->engine->validatePromotion($promo, $user, $item))->toBeTrue();
});

it('calculates discount with quantity', function () {
    $item = ShopItem::factory()->create(['price' => 50]);
    $promo = ShopPromotion::factory()->create([
        'type' => PromotionType::Percentage,
        'value' => 10,
        'applies_to' => PromotionScope::All,
        'starts_at' => now()->subDay(),
        'ends_at' => now()->addDay(),
    ]);

    $discount = $this->engine->calculateDiscount($item, 3, $promo);

    // 10% of (50 * 3) = 15
    expect($discount)->toBe(15.0);
});
