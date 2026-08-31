<?php

use App\Models\User;
use App\Services\DockerManager;
use App\Services\RconClient;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

function mockRconConsole(array $commands = []): void
{
    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->byDefault();
    $rcon->shouldReceive('command')->andReturn('')->byDefault();
    // Start and restart queue WaitForServerReady, which the sync queue runs inside the
    // request. Without this the job's reconnect() has no expectation, every attempt
    // throws, and the test sits through the job's full five-minute poll window.
    $rcon->shouldReceive('reconnect')->byDefault();

    foreach ($commands as $command => $response) {
        $rcon->shouldReceive('command')
            ->with($command)
            ->andReturn($response);
    }

    app()->instance(RconClient::class, $rcon);
}

function mockRconConsoleOffline(): void
{
    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->andThrow(new RuntimeException('Connection refused'));

    app()->instance(RconClient::class, $rcon);
}

function mockDockerForLogs(array $lines = []): void
{
    $docker = Mockery::mock(DockerManager::class);
    $docker->shouldReceive('getContainerLogs')->andReturn($lines)->byDefault();
    $docker->shouldReceive('getContainerStatus')->andReturn([
        'exists' => true, 'running' => true, 'status' => 'running',
        'started_at' => now()->subHour()->toIso8601String(),
        'finished_at' => null, 'restart_count' => 0,
    ])->byDefault();
    $docker->shouldReceive('startContainer')->andReturn(true)->byDefault();
    $docker->shouldReceive('stopContainer')->andReturn(true)->byDefault();
    $docker->shouldReceive('restartContainer')->andReturn(true)->byDefault();

    app()->instance(DockerManager::class, $docker);
}

// --- RCON Console ---

it('renders the RCON console page', function () {
    $response = $this->actingAs(User::factory()->admin()->create())->get('/admin/rcon');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page->component('admin/rcon'));
});

it('executes an RCON command', function () {
    mockRconConsole(['players' => "Players connected (1):\n-TestPlayer\n"]);

    $response = $this->actingAs(User::factory()->admin()->create())
        ->postJson('/admin/rcon', ['command' => 'players']);

    $response->assertOk();
    $response->assertJson(['command' => 'players']);
    $response->assertJsonStructure(['response']);
});

it('handles RCON offline on console', function () {
    mockRconConsoleOffline();

    $response = $this->actingAs(User::factory()->admin()->create())
        ->postJson('/admin/rcon', ['command' => 'players']);

    $response->assertStatus(503);
    $response->assertJsonStructure(['error']);
});

it('validates RCON command is required', function () {
    $response = $this->actingAs(User::factory()->admin()->create())
        ->postJson('/admin/rcon', ['command' => '']);

    $response->assertUnprocessable();
});

// --- Server Logs ---

it('renders the logs page', function () {
    mockDockerForLogs(['[2026-02-26] Server started', '[2026-02-26] World loaded']);

    $response = $this->actingAs(User::factory()->admin()->create())->get('/admin/logs');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('admin/logs')
        ->has('lines', 2)
    );
});

it('fetches logs via JSON endpoint', function () {
    mockDockerForLogs(['line 1', 'line 2', 'line 3']);

    $response = $this->actingAs(User::factory()->admin()->create())
        ->getJson('/admin/logs/fetch?tail=50');

    $response->assertOk();
    $response->assertJson(['count' => 3]);
});

// --- Server Control ---

it('can start the server from dashboard', function () {
    mockDockerForLogs();
    mockRconConsole();

    // Override running to false for start
    $docker = app(DockerManager::class);
    $docker->shouldReceive('getContainerStatus')->andReturn([
        'exists' => true, 'running' => false, 'status' => 'exited',
        'started_at' => null, 'finished_at' => null, 'restart_count' => 0,
    ]);

    $response = $this->actingAs(User::factory()->admin()->create())
        ->postJson('/admin/server/start');

    $response->assertOk();
    $response->assertJson(['message' => 'Server starting']);
});

it('can stop the server from dashboard', function () {
    mockDockerForLogs();
    mockRconConsole();

    $response = $this->actingAs(User::factory()->admin()->create())
        ->postJson('/admin/server/stop');

    $response->assertOk();
    $response->assertJson(['message' => 'Server stopped']);
});

it('can restart the server from dashboard', function () {
    mockDockerForLogs();
    mockRconConsole();

    $response = $this->actingAs(User::factory()->admin()->create())
        ->postJson('/admin/server/restart');

    $response->assertOk();
    $response->assertJson(['message' => 'Server restarting']);
});

it('can save the world from dashboard', function () {
    mockRconConsole();

    $response = $this->actingAs(User::factory()->admin()->create())
        ->postJson('/admin/server/save');

    $response->assertOk();
    $response->assertJson(['message' => 'World saved']);
});

// --- Auth guard ---

it('requires auth for RCON and logs', function () {
    $this->get('/admin/rcon')->assertRedirect('/login');
    $this->get('/admin/logs')->assertRedirect('/login');
    $this->postJson('/admin/rcon', ['command' => 'test'])->assertUnauthorized();
    $this->postJson('/admin/server/start')->assertUnauthorized();
});
