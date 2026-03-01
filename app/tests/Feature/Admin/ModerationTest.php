<?php

use App\Enums\UserRole;
use App\Models\GameEvent;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->admin = User::factory()->admin()->create();
});

// ── Auth ─────────────────────────────────────────────────────────────

it('redirects guests to login', function () {
    $this->get(route('admin.moderation'))
        ->assertRedirect(route('login'));
});

it('forbids non-admin users', function () {
    $player = User::factory()->create(['role' => UserRole::Player]);

    $this->actingAs($player)
        ->get(route('admin.moderation'))
        ->assertForbidden();
});

it('loads for admin users', function () {
    $this->actingAs($this->admin)
        ->get(route('admin.moderation'))
        ->assertOk()
        ->assertInertia(fn ($page) => $page
            ->component('admin/moderation')
            ->has('mapConfig')
            ->has('hasTiles')
            ->has('filters')
        );
});

// ── Filters ──────────────────────────────────────────────────────────

it('filters by event type', function () {
    GameEvent::factory()->pvpKill()->create();
    GameEvent::factory()->death()->create();
    GameEvent::factory()->connect()->create();

    $this->actingAs($this->admin)
        ->get(route('admin.moderation', ['event_types' => 'pvp_kill']))
        ->assertOk()
        ->assertInertia(fn ($page) => $page
            ->where('filters.event_types', 'pvp_kill')
        );
});

it('filters by player name', function () {
    GameEvent::factory()->pvpKill()->create(['player' => 'TestPlayer']);
    GameEvent::factory()->pvpKill()->create(['player' => 'OtherPlayer']);

    $this->actingAs($this->admin)
        ->get(route('admin.moderation', ['player' => 'TestPlayer', 'event_types' => 'pvp_kill']))
        ->assertOk()
        ->assertInertia(fn ($page) => $page
            ->where('filters.player', 'TestPlayer')
        );
});

it('filters by date range', function () {
    $this->actingAs($this->admin)
        ->get(route('admin.moderation', [
            'from' => '2026-01-01',
            'to' => '2026-01-31',
            'event_types' => 'pvp_kill,death',
        ]))
        ->assertOk()
        ->assertInertia(fn ($page) => $page
            ->where('filters.from', '2026-01-01')
            ->where('filters.to', '2026-01-31')
        );
});

it('defaults to pvp_kill and death event types', function () {
    $this->actingAs($this->admin)
        ->get(route('admin.moderation'))
        ->assertOk()
        ->assertInertia(fn ($page) => $page
            ->where('filters.event_types', 'pvp_kill,death')
        );
});
