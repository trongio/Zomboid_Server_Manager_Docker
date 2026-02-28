<?php

use App\Enums\UserRole;
use App\Jobs\StopGameServer;
use App\Models\AuditLog;
use App\Models\User;
use App\Services\DockerManager;
use App\Services\RconClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->admin = User::factory()->admin()->create();

    $docker = Mockery::mock(DockerManager::class);
    $docker->shouldReceive('getContainerStatus')->andReturn([
        'exists' => true,
        'running' => true,
        'status' => 'running',
        'started_at' => now()->subHours(2)->toIso8601String(),
    ])->byDefault();
    $docker->shouldReceive('stopContainer')->andReturn(true)->byDefault();
    app()->instance(DockerManager::class, $docker);
});

// ── Immediate stop ───────────────────────────────────────────────────

it('performs immediate stop when no countdown is provided', function () {
    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->once();
    $rcon->shouldReceive('command')->with('save')->once();
    $rcon->shouldReceive('command')->with('quit')->once();
    app()->instance(RconClient::class, $rcon);

    $this->actingAs($this->admin)
        ->postJson(route('admin.server.stop'))
        ->assertOk()
        ->assertJson(['message' => 'Server stopped']);

    expect(AuditLog::where('action', 'server.stop')->exists())->toBeTrue();
});

// ── Scheduled stop ───────────────────────────────────────────────────

it('schedules stop with countdown and broadcasts RCON warning', function () {
    Queue::fake();

    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->once();
    $rcon->shouldReceive('command')
        ->with('servermsg "Shutting down for maintenance"')
        ->once();
    app()->instance(RconClient::class, $rcon);

    $this->actingAs($this->admin)
        ->postJson(route('admin.server.stop'), [
            'countdown' => 60,
            'message' => 'Shutting down for maintenance',
        ])
        ->assertOk()
        ->assertJson([
            'message' => 'Server shutdown scheduled in 60 seconds',
            'countdown' => 60,
        ]);

    Queue::assertPushed(StopGameServer::class);
    expect(AuditLog::where('action', 'server.stop.scheduled')->exists())->toBeTrue();
});

it('uses default warning message when none provided', function () {
    Queue::fake();

    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->once();
    $rcon->shouldReceive('command')
        ->with('servermsg "Server shutting down in 30 seconds"')
        ->once();
    app()->instance(RconClient::class, $rcon);

    $this->actingAs($this->admin)
        ->postJson(route('admin.server.stop'), [
            'countdown' => 30,
        ])
        ->assertOk()
        ->assertJson([
            'message' => 'Server shutdown scheduled in 30 seconds',
        ]);

    Queue::assertPushed(StopGameServer::class);
});

// ── Validation ───────────────────────────────────────────────────────

it('rejects countdown below minimum', function () {
    $this->actingAs($this->admin)
        ->postJson(route('admin.server.stop'), ['countdown' => 5])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('countdown');
});

it('rejects countdown above maximum', function () {
    $this->actingAs($this->admin)
        ->postJson(route('admin.server.stop'), ['countdown' => 9999])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('countdown');
});

it('rejects message exceeding max length', function () {
    $this->actingAs($this->admin)
        ->postJson(route('admin.server.stop'), [
            'countdown' => 60,
            'message' => str_repeat('a', 501),
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('message');
});

// ── RCON offline ─────────────────────────────────────────────────────

it('schedules stop even when RCON is offline', function () {
    Queue::fake();

    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->andThrow(new RuntimeException('Connection refused'));
    app()->instance(RconClient::class, $rcon);

    $this->actingAs($this->admin)
        ->postJson(route('admin.server.stop'), [
            'countdown' => 60,
        ])
        ->assertOk()
        ->assertJson([
            'message' => 'Server shutdown scheduled in 60 seconds',
        ]);

    Queue::assertPushed(StopGameServer::class);
});

// ── Auth ─────────────────────────────────────────────────────────────

it('requires admin authentication', function () {
    $player = User::factory()->create(['role' => UserRole::Player]);

    $this->actingAs($player)
        ->postJson(route('admin.server.stop'))
        ->assertForbidden();
});
