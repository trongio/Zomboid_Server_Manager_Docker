<?php

use App\Models\AuditLog;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

function apiKey(): array
{
    return ['X-API-Key' => 'test-key-12345'];
}

beforeEach(function () {
    config(['zomboid.api_key' => 'test-key-12345']);

    // Set up temp config files from fixtures
    $this->iniPath = tempnam(sys_get_temp_dir(), 'pz_ini_');
    $this->luaPath = tempnam(sys_get_temp_dir(), 'pz_lua_');
    copy(base_path('tests/fixtures/server.ini'), $this->iniPath);
    copy(base_path('tests/fixtures/sandbox.lua'), $this->luaPath);

    config(['zomboid.paths.server_ini' => $this->iniPath]);
    config(['zomboid.paths.sandbox_lua' => $this->luaPath]);
});

afterEach(function () {
    @unlink($this->iniPath);
    @unlink($this->luaPath);
});

// ── GET /api/config/server ───────────────────────────────────────────

it('returns server config as json', function () {
    $response = $this->getJson('/api/config/server', apiKey())
        ->assertOk();

    expect($response->json('MaxPlayers'))->toBe('16')
        ->and($response->json('Map'))->toBe('Muldraugh, KY')
        ->and($response->json('Mods'))->toBe('SuperSurvivors;Hydrocraft');
});

it('returns 404 when server.ini does not exist', function () {
    config(['zomboid.paths.server_ini' => '/nonexistent/path.ini']);

    $this->getJson('/api/config/server', apiKey())
        ->assertNotFound();
});

it('requires auth for server config', function () {
    $this->getJson('/api/config/server')
        ->assertUnauthorized();
});

// ── PATCH /api/config/server ─────────────────────────────────────────

it('updates server config fields', function () {
    $this->patchJson('/api/config/server', [
        'settings' => [
            'MaxPlayers' => '32',
            'Public' => 'false',
        ],
    ], apiKey())
        ->assertOk()
        ->assertJson([
            'updated_fields' => ['MaxPlayers', 'Public'],
            'restart_required' => true,
        ]);

    // Verify file was updated
    $response = $this->getJson('/api/config/server', apiKey())->assertOk();
    expect($response->json('MaxPlayers'))->toBe('32')
        ->and($response->json('Public'))->toBe('false');
});

it('creates audit log with before/after for server config update', function () {
    $this->patchJson('/api/config/server', [
        'settings' => ['MaxPlayers' => '64'],
    ], apiKey())
        ->assertOk();

    $auditLog = AuditLog::query()->where('action', 'config.server.update')->first();

    expect($auditLog)->not->toBeNull()
        ->and($auditLog->target)->toBe('server.ini')
        ->and($auditLog->details['before']['MaxPlayers'])->toBe('16')
        ->and($auditLog->details['after']['MaxPlayers'])->toBe('64');
});

it('validates settings is required for server config update', function () {
    $this->patchJson('/api/config/server', [], apiKey())
        ->assertUnprocessable()
        ->assertJsonValidationErrors('settings');
});

// ── GET /api/config/sandbox ──────────────────────────────────────────

it('returns sandbox config as nested json', function () {
    $response = $this->getJson('/api/config/sandbox', apiKey())
        ->assertOk();

    expect($response->json('Zombies'))->toBe(4)
        ->and($response->json('StartYear'))->toBe(1993)
        ->and($response->json('ZombieLore'))->toBeArray()
        ->and($response->json('ZombieLore.Speed'))->toBe(2);
});

it('returns 404 when sandbox lua does not exist', function () {
    config(['zomboid.paths.sandbox_lua' => '/nonexistent/path.lua']);

    $this->getJson('/api/config/sandbox', apiKey())
        ->assertNotFound();
});

// ── PATCH /api/config/sandbox ────────────────────────────────────────

it('updates sandbox top-level values', function () {
    $this->patchJson('/api/config/sandbox', [
        'settings' => [
            'Zombies' => 1,
            'DayLength' => 4,
        ],
    ], apiKey())
        ->assertOk()
        ->assertJson([
            'updated_fields' => ['Zombies', 'DayLength'],
            'restart_required' => true,
        ]);

    $response = $this->getJson('/api/config/sandbox', apiKey())->assertOk();
    expect($response->json('Zombies'))->toBe(1)
        ->and($response->json('DayLength'))->toBe(4);
});

it('updates sandbox nested values via dot notation', function () {
    $this->patchJson('/api/config/sandbox', [
        'settings' => [
            'ZombieLore.Speed' => 3,
            'ZombieLore.Mortality' => 1,
        ],
    ], apiKey())
        ->assertOk();

    $response = $this->getJson('/api/config/sandbox', apiKey())->assertOk();
    expect($response->json('ZombieLore.Speed'))->toBe(3)
        ->and($response->json('ZombieLore.Mortality'))->toBe(1)
        ->and($response->json('ZombieLore.Strength'))->toBe(2); // unchanged
});

it('creates audit log for sandbox config update', function () {
    $this->patchJson('/api/config/sandbox', [
        'settings' => ['ZombieLore.Speed' => 3],
    ], apiKey())
        ->assertOk();

    $auditLog = AuditLog::query()->where('action', 'config.sandbox.update')->first();

    expect($auditLog)->not->toBeNull()
        ->and($auditLog->target)->toBe('SandboxVars.lua');
});
