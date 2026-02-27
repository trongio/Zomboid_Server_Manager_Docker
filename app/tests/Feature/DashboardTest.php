<?php

use App\Models\AuditLog;
use App\Models\Backup;
use App\Models\User;
use App\Services\DockerManager;
use App\Services\GameStateReader;
use App\Services\RconClient;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

function mockDashboardDocker(array $statusOverrides = []): void
{
    $docker = Mockery::mock(DockerManager::class);

    $defaultStatus = [
        'exists' => true,
        'running' => true,
        'status' => 'running',
        'started_at' => now()->subHours(2)->toIso8601String(),
        'finished_at' => null,
        'restart_count' => 0,
    ];

    $docker->shouldReceive('getContainerStatus')
        ->andReturn(array_merge($defaultStatus, $statusOverrides))
        ->byDefault();

    app()->instance(DockerManager::class, $docker);
}

function mockDashboardRcon(array $commands = []): void
{
    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->byDefault();
    $rcon->shouldReceive('command')->andReturn('')->byDefault();

    foreach ($commands as $command => $response) {
        $rcon->shouldReceive('command')
            ->with($command)
            ->andReturn($response);
    }

    app()->instance(RconClient::class, $rcon);
}

function mockDashboardRconOffline(): void
{
    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->andThrow(new RuntimeException('Connection refused'));

    app()->instance(RconClient::class, $rcon);
}

it('redirects guests to login', function () {
    $response = $this->get(route('dashboard'));
    $response->assertRedirect(route('login'));
});

it('renders the dashboard for authenticated users', function () {
    mockDashboardDocker();
    mockDashboardRcon(['players' => "Players connected (0):\n"]);

    $user = User::factory()->admin()->create();

    $response = $this->actingAs($user)->get(route('dashboard'));

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('dashboard')
        ->has('server')
        ->has('recent_audit')
        ->has('backup_summary')
    );
});

it('shows server status on the dashboard', function () {
    mockDashboardDocker();
    mockDashboardRcon(['players' => "Players connected (3):\n-Alice\n-Bob\n-Charlie\n"]);

    $user = User::factory()->admin()->create();

    $response = $this->actingAs($user)->get(route('dashboard'));

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('dashboard')
        ->where('server.online', true)
        ->where('server.player_count', 3)
        ->where('server.players', ['Alice', 'Bob', 'Charlie'])
    );
});

it('shows recent audit log entries', function () {
    mockDashboardDocker(['running' => false]);
    mockDashboardRconOffline();

    AuditLog::create([
        'actor' => 'api-key',
        'action' => 'server.restart',
        'target' => 'game-server',
        'created_at' => now(),
    ]);

    $user = User::factory()->admin()->create();

    $response = $this->actingAs($user)->get(route('dashboard'));

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('dashboard')
        ->has('recent_audit', 1)
        ->where('recent_audit.0.action', 'server.restart')
    );
});

it('shows backup summary on the dashboard', function () {
    mockDashboardDocker(['running' => false]);
    mockDashboardRconOffline();

    Backup::create([
        'filename' => 'backup-2026-02-26-001.tar.gz',
        'path' => '/backups/backup-2026-02-26-001.tar.gz',
        'size_bytes' => 1048576,
        'type' => 'manual',
        'created_at' => now(),
    ]);

    $user = User::factory()->admin()->create();

    $response = $this->actingAs($user)->get(route('dashboard'));

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('dashboard')
        ->where('backup_summary.total_count', 1)
        ->where('backup_summary.total_size_human', '1 MB')
    );
});

it('handles offline server gracefully on dashboard', function () {
    mockDashboardDocker(['running' => false, 'status' => 'exited']);
    mockDashboardRconOffline();

    $user = User::factory()->admin()->create();

    $response = $this->actingAs($user)->get(route('dashboard'));

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('dashboard')
        ->where('server.online', false)
        ->where('game_state', null)
    );
});

it('includes game state when server is online and data exists', function () {
    mockDashboardDocker();
    mockDashboardRcon(['players' => "Players connected (0):\n"]);

    $gameState = [
        'time' => [
            'year' => 1993,
            'month' => 7,
            'day' => 9,
            'hour' => 14,
            'minute' => 30,
            'day_of_year' => 190,
            'is_night' => false,
            'formatted' => '14:30',
            'date' => '1993-07-09',
        ],
        'season' => 'summer',
        'weather' => [
            'temperature' => 28.5,
            'condition' => 'clear',
            'rain_intensity' => 0.0,
            'fog_intensity' => 0.0,
            'wind_intensity' => 0.15,
            'snow_intensity' => 0.0,
            'is_raining' => false,
            'is_foggy' => false,
            'is_snowing' => false,
        ],
        'exported_at' => '2026-02-27T14:30:00Z',
    ];

    $reader = Mockery::mock(GameStateReader::class);
    $reader->shouldReceive('getGameState')->andReturn($gameState);
    app()->instance(GameStateReader::class, $reader);

    $user = User::factory()->admin()->create();

    $response = $this->actingAs($user)->get(route('dashboard'));

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('dashboard')
        ->has('game_state')
        ->where('game_state.season', 'summer')
        ->where('game_state.time.hour', 14)
        ->where('game_state.weather.temperature', 28.5)
    );
});

it('returns null game state when server is online but file missing', function () {
    mockDashboardDocker();
    mockDashboardRcon(['players' => "Players connected (0):\n"]);

    $reader = Mockery::mock(GameStateReader::class);
    $reader->shouldReceive('getGameState')->andReturn(null);
    app()->instance(GameStateReader::class, $reader);

    $user = User::factory()->admin()->create();

    $response = $this->actingAs($user)->get(route('dashboard'));

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('dashboard')
        ->where('game_state', null)
    );
});
