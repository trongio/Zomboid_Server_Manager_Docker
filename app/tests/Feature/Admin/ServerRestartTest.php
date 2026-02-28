<?php

use App\Enums\UserRole;
use App\Jobs\RestartGameServer;
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
    $docker->shouldReceive('restartContainer')->andReturn(true)->byDefault();
    app()->instance(DockerManager::class, $docker);
});

// ── Immediate restart ────────────────────────────────────────────────

it('performs immediate restart when no countdown is provided', function () {
    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->andReturnNull()->byDefault();
    $rcon->shouldReceive('command')->with('save')->andReturnNull()->byDefault();
    app()->instance(RconClient::class, $rcon);

    $this->actingAs($this->admin)
        ->postJson(route('admin.server.restart'))
        ->assertOk()
        ->assertJson(['message' => 'Server restarting']);

    expect(AuditLog::where('action', 'server.restart')->exists())->toBeTrue();
});

// ── Scheduled restart ────────────────────────────────────────────────

it('schedules restart with countdown and broadcasts RCON warning', function () {
    Queue::fake();

    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->once();
    $rcon->shouldReceive('command')
        ->with('servermsg "Rebooting for updates"')
        ->once();
    app()->instance(RconClient::class, $rcon);

    $this->actingAs($this->admin)
        ->postJson(route('admin.server.restart'), [
            'countdown' => 60,
            'message' => 'Rebooting for updates',
        ])
        ->assertOk()
        ->assertJson([
            'message' => 'Server restart scheduled in 60 seconds',
            'countdown' => 60,
        ]);

    Queue::assertPushed(RestartGameServer::class);
    expect(AuditLog::where('action', 'server.restart.scheduled')->exists())->toBeTrue();
});

it('uses default warning message when none provided', function () {
    Queue::fake();

    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->once();
    $rcon->shouldReceive('command')
        ->with('servermsg "Server restarting in 30 seconds"')
        ->once();
    app()->instance(RconClient::class, $rcon);

    $this->actingAs($this->admin)
        ->postJson(route('admin.server.restart'), [
            'countdown' => 30,
        ])
        ->assertOk()
        ->assertJson([
            'message' => 'Server restart scheduled in 30 seconds',
        ]);

    Queue::assertPushed(RestartGameServer::class);
});

// ── Validation ───────────────────────────────────────────────────────

it('rejects countdown below minimum', function () {
    $this->actingAs($this->admin)
        ->postJson(route('admin.server.restart'), ['countdown' => 5])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('countdown');
});

it('rejects countdown above maximum', function () {
    $this->actingAs($this->admin)
        ->postJson(route('admin.server.restart'), ['countdown' => 9999])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('countdown');
});

it('rejects message exceeding max length', function () {
    $this->actingAs($this->admin)
        ->postJson(route('admin.server.restart'), [
            'countdown' => 60,
            'message' => str_repeat('a', 501),
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('message');
});

// ── RCON offline ─────────────────────────────────────────────────────

it('schedules restart even when RCON is offline', function () {
    Queue::fake();

    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->andThrow(new RuntimeException('Connection refused'));
    app()->instance(RconClient::class, $rcon);

    $this->actingAs($this->admin)
        ->postJson(route('admin.server.restart'), [
            'countdown' => 60,
        ])
        ->assertOk()
        ->assertJson([
            'message' => 'Server restart scheduled in 60 seconds',
        ]);

    Queue::assertPushed(RestartGameServer::class);
});

// ── Auth ─────────────────────────────────────────────────────────────

it('requires admin authentication', function () {
    $player = User::factory()->create(['role' => UserRole::Player]);

    $this->actingAs($player)
        ->postJson(route('admin.server.restart'))
        ->assertForbidden();
});
