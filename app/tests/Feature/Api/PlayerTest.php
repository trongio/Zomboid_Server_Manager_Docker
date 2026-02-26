<?php

use App\Models\AuditLog;
use App\Services\RconClient;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

function playerApiHeaders(): array
{
    return ['X-API-Key' => 'test-key-12345'];
}

function mockPlayerRcon(array $commands = []): void
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

function mockPlayerRconOffline(): void
{
    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->andThrow(new RuntimeException('Connection refused'));
    app()->instance(RconClient::class, $rcon);
}

beforeEach(function () {
    config(['zomboid.api_key' => 'test-key-12345']);
});

// ── GET /api/players ─────────────────────────────────────────────────

it('returns player list', function () {
    mockPlayerRcon(['players' => "Players connected (2):\n-Player1\n-Player2\n"]);

    $response = $this->getJson('/api/players', playerApiHeaders())
        ->assertOk();

    expect($response->json('count'))->toBe(2)
        ->and($response->json('players.0.name'))->toBe('Player1')
        ->and($response->json('players.1.name'))->toBe('Player2');
});

it('returns empty list when no players', function () {
    mockPlayerRcon(['players' => "Players connected (0):\n"]);

    $response = $this->getJson('/api/players', playerApiHeaders())
        ->assertOk();

    expect($response->json('count'))->toBe(0)
        ->and($response->json('players'))->toBe([]);
});

it('returns empty list when server offline', function () {
    mockPlayerRconOffline();

    $response = $this->getJson('/api/players', playerApiHeaders())
        ->assertOk();

    expect($response->json('count'))->toBe(0);
});

// ── GET /api/players/{name} ──────────────────────────────────────────

it('returns player details', function () {
    mockPlayerRcon(['players' => "Players connected (1):\n-TestPlayer\n"]);

    $response = $this->getJson('/api/players/TestPlayer', playerApiHeaders())
        ->assertOk();

    expect($response->json('name'))->toBe('TestPlayer');
});

it('returns 404 for unknown player', function () {
    mockPlayerRcon(['players' => "Players connected (1):\n-OtherPlayer\n"]);

    $this->getJson('/api/players/UnknownPlayer', playerApiHeaders())
        ->assertNotFound();
});

it('returns 503 when server offline for player show', function () {
    mockPlayerRconOffline();

    $this->getJson('/api/players/TestPlayer', playerApiHeaders())
        ->assertStatus(503);
});

// ── POST /api/players/{name}/kick ────────────────────────────────────

it('kicks a player', function () {
    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->once();
    $rcon->shouldReceive('command')
        ->with('kickuser "Player1" "Breaking rules"')
        ->once()
        ->andReturn('');
    app()->instance(RconClient::class, $rcon);

    $this->postJson('/api/players/Player1/kick', [
        'reason' => 'Breaking rules',
    ], playerApiHeaders())
        ->assertOk()
        ->assertJson(['message' => "Player 'Player1' kicked"]);

    expect(AuditLog::where('action', 'player.kick')->exists())->toBeTrue();
});

it('kicks without reason', function () {
    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->once();
    $rcon->shouldReceive('command')
        ->with('kickuser "Player1"')
        ->once()
        ->andReturn('');
    app()->instance(RconClient::class, $rcon);

    $this->postJson('/api/players/Player1/kick', [], playerApiHeaders())
        ->assertOk();
});

// ── POST /api/players/{name}/ban ─────────────────────────────────────

it('bans a player', function () {
    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->once();
    $rcon->shouldReceive('command')->with('banuser "Player1"')->once();
    app()->instance(RconClient::class, $rcon);

    $this->postJson('/api/players/Player1/ban', [], playerApiHeaders())
        ->assertOk()
        ->assertJson(['message' => "Player 'Player1' banned"]);

    $audit = AuditLog::where('action', 'player.ban')->first();
    expect($audit)->not->toBeNull()
        ->and($audit->target)->toBe('Player1');
});

it('bans with ip ban', function () {
    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->once();
    $rcon->shouldReceive('command')->with('banuser "Player1"')->once();
    $rcon->shouldReceive('command')->with('banid "Player1"')->once();
    app()->instance(RconClient::class, $rcon);

    $this->postJson('/api/players/Player1/ban', [
        'ip_ban' => true,
    ], playerApiHeaders())
        ->assertOk()
        ->assertJsonFragment(['message' => "Player 'Player1' banned (IP ban)"]);
});

// ── DELETE /api/players/{name}/ban ───────────────────────────────────

it('unbans a player', function () {
    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->once();
    $rcon->shouldReceive('command')->with('unbanuser "Player1"')->once()->andReturn('');
    app()->instance(RconClient::class, $rcon);

    $this->deleteJson('/api/players/Player1/ban', [], playerApiHeaders())
        ->assertOk()
        ->assertJson(['message' => "Player 'Player1' unbanned"]);
});

// ── POST /api/players/{name}/setaccess ───────────────────────────────

it('sets access level', function () {
    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->once();
    $rcon->shouldReceive('command')
        ->with('setaccesslevel "Player1" "admin"')
        ->once()
        ->andReturn('');
    app()->instance(RconClient::class, $rcon);

    $this->postJson('/api/players/Player1/setaccess', [
        'level' => 'admin',
    ], playerApiHeaders())
        ->assertOk();

    expect(AuditLog::where('action', 'player.setaccess')->exists())->toBeTrue();
});

it('validates access level enum', function () {
    $this->postJson('/api/players/Player1/setaccess', [
        'level' => 'superadmin',
    ], playerApiHeaders())
        ->assertUnprocessable()
        ->assertJsonValidationErrors('level');
});

// ── POST /api/players/{name}/teleport ────────────────────────────────

it('teleports to coordinates', function () {
    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->once();
    $rcon->shouldReceive('command')
        ->with('teleport "Player1" 100,200,0')
        ->once()
        ->andReturn('');
    app()->instance(RconClient::class, $rcon);

    $this->postJson('/api/players/Player1/teleport', [
        'x' => 100,
        'y' => 200,
    ], playerApiHeaders())
        ->assertOk();
});

it('teleports to another player', function () {
    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->once();
    $rcon->shouldReceive('command')
        ->with('teleportto "Player1" "Player2"')
        ->once()
        ->andReturn('');
    app()->instance(RconClient::class, $rcon);

    $this->postJson('/api/players/Player1/teleport', [
        'target_player' => 'Player2',
    ], playerApiHeaders())
        ->assertOk();
});

it('validates teleport requires coordinates or target', function () {
    mockPlayerRcon();

    $this->postJson('/api/players/Player1/teleport', [], playerApiHeaders())
        ->assertUnprocessable();
});

// ── POST /api/players/{name}/additem ─────────────────────────────────

it('adds item to player', function () {
    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->once();
    $rcon->shouldReceive('command')
        ->with('additem "Player1" "Base.Axe" 1')
        ->once()
        ->andReturn('');
    app()->instance(RconClient::class, $rcon);

    $this->postJson('/api/players/Player1/additem', [
        'item_id' => 'Base.Axe',
    ], playerApiHeaders())
        ->assertOk()
        ->assertJson(['message' => "Added 1x 'Base.Axe' to 'Player1'"]);
});

it('adds multiple items', function () {
    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->once();
    $rcon->shouldReceive('command')
        ->with('additem "Player1" "Base.Axe" 5')
        ->once()
        ->andReturn('');
    app()->instance(RconClient::class, $rcon);

    $this->postJson('/api/players/Player1/additem', [
        'item_id' => 'Base.Axe',
        'count' => 5,
    ], playerApiHeaders())
        ->assertOk();
});

it('validates item_id is required', function () {
    $this->postJson('/api/players/Player1/additem', [], playerApiHeaders())
        ->assertUnprocessable()
        ->assertJsonValidationErrors('item_id');
});

// ── POST /api/players/{name}/addxp ───────────────────────────────────

it('adds xp to player', function () {
    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->once();
    $rcon->shouldReceive('command')
        ->with('addxp "Player1" Carpentry=500')
        ->once()
        ->andReturn('');
    app()->instance(RconClient::class, $rcon);

    $this->postJson('/api/players/Player1/addxp', [
        'skill' => 'Carpentry',
        'amount' => 500,
    ], playerApiHeaders())
        ->assertOk()
        ->assertJson(['message' => "Added 500 XP in 'Carpentry' to 'Player1'"]);
});

// ── POST /api/players/{name}/godmode ─────────────────────────────────

it('toggles godmode', function () {
    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->once();
    $rcon->shouldReceive('command')
        ->with('godmod "Player1"')
        ->once()
        ->andReturn('');
    app()->instance(RconClient::class, $rcon);

    $this->postJson('/api/players/Player1/godmode', [], playerApiHeaders())
        ->assertOk()
        ->assertJson(['message' => "Godmode toggled for 'Player1'"]);
});

// ── Auth requirement ─────────────────────────────────────────────────

it('requires auth for all player endpoints', function () {
    $this->getJson('/api/players')->assertUnauthorized();
    $this->getJson('/api/players/test')->assertUnauthorized();
    $this->postJson('/api/players/test/kick')->assertUnauthorized();
    $this->postJson('/api/players/test/ban')->assertUnauthorized();
    $this->deleteJson('/api/players/test/ban')->assertUnauthorized();
    $this->postJson('/api/players/test/godmode')->assertUnauthorized();
});
