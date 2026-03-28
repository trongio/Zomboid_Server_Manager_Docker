<?php

use App\Enums\UserRole;
use App\Models\User;
use App\Services\DockerManager;
use App\Services\RconClient;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->admin = User::factory()->admin()->create();

    $docker = Mockery::mock(DockerManager::class);
    $docker->shouldReceive('getContainerStatus')->andReturn([
        'exists' => true,
        'running' => true,
        'status' => 'running',
    ])->byDefault();
    app()->instance(DockerManager::class, $docker);
});

// ── Route constraint rejects malicious player names ──────────────────

it('rejects admin kick with injected player name', function () {
    $this->actingAs($this->admin)
        ->postJson('/admin/players/Player"1/kick')
        ->assertNotFound();
});

it('rejects admin ban with injected player name', function () {
    $this->actingAs($this->admin)
        ->postJson('/admin/players/Player;quit/ban')
        ->assertNotFound();
});

it('rejects admin access level with injected player name', function () {
    $this->actingAs($this->admin)
        ->postJson('/admin/players/Player%0Aquit/access')
        ->assertNotFound();
});

// ── Form validation rejects dangerous message content ────────────────

it('rejects server stop message with double quotes', function () {
    $this->actingAs($this->admin)
        ->postJson('/admin/server/stop', [
            'countdown' => 60,
            'message' => 'Shutting down "now"',
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('message');
});

it('rejects server stop message with newlines', function () {
    $this->actingAs($this->admin)
        ->postJson('/admin/server/stop', [
            'countdown' => 60,
            'message' => "Shutting down\nquit",
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('message');
});

it('rejects server restart message with injection', function () {
    $this->actingAs($this->admin)
        ->postJson('/admin/server/restart', [
            'countdown' => 60,
            'message' => "Restarting\"; quit; \"",
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('message');
});

it('rejects RCON console command with newlines', function () {
    $this->actingAs($this->admin)
        ->postJson('/admin/rcon', [
            'command' => "players\nquit",
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('command');
});
