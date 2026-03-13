<?php

use App\Enums\UserRole;
use App\Models\ShopCategory;
use App\Models\ShopItem;
use App\Models\User;
use App\Models\Wallet;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->withoutVite();
    $this->admin = User::factory()->create(['role' => UserRole::Admin]);
});

it('shows shop admin page', function () {
    $response = $this->actingAs($this->admin)->get('/admin/shop');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page->component('admin/shop'));
});

it('creates a shop category', function () {
    $response = $this->actingAs($this->admin)->postJson('/admin/shop/categories', [
        'name' => 'Weapons',
        'description' => 'All weapons',
    ]);

    $response->assertStatus(201);
    $this->assertDatabaseHas('shop_categories', ['name' => 'Weapons', 'slug' => 'weapons']);
});

it('updates a shop category', function () {
    $category = ShopCategory::factory()->create(['name' => 'Old Name']);

    $response = $this->actingAs($this->admin)->patchJson("/admin/shop/categories/{$category->id}", [
        'name' => 'New Name',
    ]);

    $response->assertOk();
    expect($category->fresh()->name)->toBe('New Name');
});

it('deletes a shop category', function () {
    $category = ShopCategory::factory()->create();

    $response = $this->actingAs($this->admin)->deleteJson("/admin/shop/categories/{$category->id}");

    $response->assertOk();
    $this->assertDatabaseMissing('shop_categories', ['id' => $category->id]);
});

it('creates a shop item', function () {
    $category = ShopCategory::factory()->create();

    $response = $this->actingAs($this->admin)->postJson('/admin/shop/items', [
        'name' => 'Fire Axe',
        'item_type' => 'Base.Axe',
        'quantity' => 1,
        'price' => 50.00,
        'category_id' => $category->id,
    ]);

    $response->assertStatus(201);
    $this->assertDatabaseHas('shop_items', ['name' => 'Fire Axe', 'item_type' => 'Base.Axe']);
});

it('updates a shop item', function () {
    $item = ShopItem::factory()->create(['name' => 'Old Item', 'price' => 10]);

    $response = $this->actingAs($this->admin)->patchJson("/admin/shop/items/{$item->id}", [
        'name' => 'Updated Item',
        'item_type' => $item->item_type,
        'quantity' => 1,
        'price' => 25.00,
    ]);

    $response->assertOk();
    expect($item->fresh()->name)->toBe('Updated Item')
        ->and((float) $item->fresh()->price)->toBe(25.0);
});

it('toggles item active status', function () {
    $item = ShopItem::factory()->create(['is_active' => true]);

    $this->actingAs($this->admin)->postJson("/admin/shop/items/{$item->id}/toggle")
        ->assertOk();

    expect($item->fresh()->is_active)->toBeFalse();
});

it('deletes a shop item', function () {
    $item = ShopItem::factory()->create();

    $this->actingAs($this->admin)->deleteJson("/admin/shop/items/{$item->id}")
        ->assertOk();

    $this->assertDatabaseMissing('shop_items', ['id' => $item->id]);
});

it('awards currency to player', function () {
    $player = User::factory()->create();

    $response = $this->actingAs($this->admin)->postJson("/admin/wallets/{$player->id}/credit", [
        'amount' => 500,
        'description' => 'Welcome bonus',
    ]);

    $response->assertOk();
    expect((float) $response->json('balance'))->toBe(500.0);

    $this->assertDatabaseHas('wallets', [
        'user_id' => $player->id,
        'balance' => 500.00,
    ]);
});

it('shows wallets page', function () {
    $response = $this->actingAs($this->admin)->get('/admin/wallets');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page->component('admin/wallets'));
});

it('shows player transaction history', function () {
    $player = User::factory()->create();
    Wallet::factory()->for($player)->withBalance(100)->create();

    $response = $this->actingAs($this->admin)->getJson("/admin/wallets/{$player->id}/transactions");

    $response->assertOk();
    $response->assertJsonStructure(['user', 'transactions']);
});
