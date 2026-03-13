<?php

use App\Enums\DeliveryStatus;
use App\Models\ShopCategory;
use App\Models\ShopItem;
use App\Models\User;
use App\Models\Wallet;
use App\Models\WhitelistEntry;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->withoutVite();
    $this->user = User::factory()->create();
    $this->user->whitelistEntries()->save(
        WhitelistEntry::factory()->make(['pz_username' => 'testplayer'])
    );
    Wallet::factory()->for($this->user)->create(['balance' => 1000, 'total_earned' => 1000, 'total_spent' => 0]);
});

it('lists shop items publicly without auth', function () {
    $category = ShopCategory::factory()->create();
    ShopItem::factory()->count(3)->create(['category_id' => $category->id]);

    $response = $this->get('/shop');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('shop/index')
        ->has('items', 3)
        ->has('categories', 1)
        ->where('balance', null)
    );
});

it('shows balance when authenticated player browses shop', function () {
    $category = ShopCategory::factory()->create();
    ShopItem::factory()->count(3)->create(['category_id' => $category->id]);

    $response = $this->actingAs($this->user)->get('/shop');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('shop/index')
        ->has('items', 3)
        ->has('categories', 1)
        ->where('balance', fn ($value) => (float) $value === 1000.0)
    );
});

it('allows unauthenticated user to view item detail', function () {
    $item = ShopItem::factory()->create();

    $response = $this->get("/shop/{$item->slug}");

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('shop/item')
        ->where('balance', null)
    );
});

it('purchases an item successfully', function () {
    $item = ShopItem::factory()->create(['price' => 50, 'quantity' => 1]);

    $response = $this->actingAs($this->user)->postJson("/shop/{$item->slug}/purchase", [
        'quantity' => 2,
    ]);

    $response->assertOk();
    $response->assertJsonStructure(['message', 'purchase_id', 'balance']);
    expect((float) $response->json('balance'))->toBe(900.0);

    $this->assertDatabaseHas('shop_purchases', [
        'user_id' => $this->user->id,
        'purchasable_id' => $item->id,
        'quantity_bought' => 2,
        'total_price' => 100.00,
    ]);
});

it('fails purchase with insufficient balance', function () {
    $item = ShopItem::factory()->create(['price' => 5000]);

    $response = $this->actingAs($this->user)->postJson("/shop/{$item->slug}/purchase");

    $response->assertStatus(422);
    $response->assertJsonStructure(['error', 'balance', 'required']);
});

it('fails purchase when item is out of stock', function () {
    $item = ShopItem::factory()->withStock(0)->create(['price' => 10]);

    $response = $this->actingAs($this->user)->postJson("/shop/{$item->slug}/purchase");

    $response->assertStatus(422);
    $response->assertJson(['error' => 'Insufficient stock available.']);
});

it('fails purchase when per-player limit exceeded', function () {
    $item = ShopItem::factory()->withMaxPerPlayer(1)->create(['price' => 10]);

    // First purchase should succeed
    $this->actingAs($this->user)->postJson("/shop/{$item->slug}/purchase")
        ->assertOk();

    // Second should fail
    $response = $this->actingAs($this->user)->postJson("/shop/{$item->slug}/purchase");
    $response->assertStatus(422);
});

it('creates delivery records on purchase', function () {
    $item = ShopItem::factory()->create(['price' => 25, 'quantity' => 3, 'item_type' => 'Base.Axe']);

    $this->actingAs($this->user)->postJson("/shop/{$item->slug}/purchase")
        ->assertOk();

    $this->assertDatabaseHas('shop_deliveries', [
        'username' => 'testplayer',
        'item_type' => 'Base.Axe',
        'quantity' => 3,
    ]);
});

it('decrements stock after purchase', function () {
    $item = ShopItem::factory()->withStock(5)->create(['price' => 10]);

    $this->actingAs($this->user)->postJson("/shop/{$item->slug}/purchase", ['quantity' => 2])
        ->assertOk();

    expect($item->fresh()->stock)->toBe(3);
});

it('rejects purchase for inactive items', function () {
    $item = ShopItem::factory()->inactive()->create(['price' => 10]);

    $response = $this->actingAs($this->user)->postJson("/shop/{$item->slug}/purchase");

    $response->assertNotFound();
});

it('shows purchase history', function () {
    $response = $this->actingAs($this->user)->get('/shop/my/purchases');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page->component('shop/my-purchases'));
});

it('shows wallet page', function () {
    $response = $this->actingAs($this->user)->get('/shop/my/wallet');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('shop/my-wallet')
        ->where('balance', fn ($value) => (float) $value === 1000.0)
    );
});
