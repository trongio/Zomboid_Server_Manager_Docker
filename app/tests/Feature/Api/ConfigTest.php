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

    // Set up temp config files from fixtures inside a directory structure
    // that matches production: {dataDir}/Server/{name}.ini
    $this->tempDir = sys_get_temp_dir().'/pz_config_api_test_'.uniqid();
    mkdir($this->tempDir.'/Server', 0777, true);
    $this->iniPath = $this->tempDir.'/Server/ZomboidServer.ini';
    $this->luaPath = $this->tempDir.'/Server/ZomboidServer_SandboxVars.lua';
    copy(base_path('tests/fixtures/server.ini'), $this->iniPath);
    copy(base_path('tests/fixtures/sandbox.lua'), $this->luaPath);
    $this->stateFile = $this->tempDir.'/.config_state';

    config(['zomboid.paths.server_ini' => $this->iniPath]);
    config(['zomboid.paths.sandbox_lua' => $this->luaPath]);
});

afterEach(function () {
    @unlink($this->iniPath);
    @unlink($this->luaPath);
    @unlink($this->stateFile);
    foreach (glob($this->tempDir.'/.config_state.*') as $f) {
        @unlink($f);
    }
    @rmdir($this->tempDir.'/Server');
    @rmdir($this->tempDir);
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

// ── .config_state persistence (issue #18) ───────────────────────────

it('writes .config_state when updating server config with allowlisted keys', function () {
    $this->patchJson('/api/config/server', [
        'settings' => [
            'MaxPlayers' => '32',
            'Public' => 'false',
        ],
    ], apiKey())
        ->assertOk();

    expect($this->stateFile)->toBeFile();

    $contents = file_get_contents($this->stateFile);
    expect($contents)->toContain('MaxPlayers=32')
        ->and($contents)->toContain('Public=false');
});

it('does not write RCON settings to .config_state', function () {
    $this->patchJson('/api/config/server', [
        'settings' => [
            'MaxPlayers' => '32',
            'RCONPassword' => 'newsecret',
        ],
    ], apiKey())
        ->assertOk();

    $contents = file_get_contents($this->stateFile);
    expect($contents)->toContain('MaxPlayers=32')
        ->and($contents)->not->toContain('RCONPassword');
});
