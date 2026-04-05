<?php

use App\Models\AuditLog;
use App\Models\User;
use App\Services\ConfigStateManager;
use App\Services\SandboxLuaParser;
use App\Services\ServerIniParser;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

function importAdmin(): User
{
    return User::factory()->admin()->create();
}

function mockImportIniParser(array $config = []): void
{
    $parser = Mockery::mock(ServerIniParser::class);
    $parser->shouldReceive('read')->andReturn($config)->byDefault();
    $parser->shouldReceive('parseContent')->andReturnUsing(fn (string $content) => (new ServerIniParser)->parseContent($content))->byDefault();
    $parser->shouldReceive('write')->byDefault();

    app()->instance(ServerIniParser::class, $parser);
}

function mockImportLuaParser(array $config = []): void
{
    $parser = Mockery::mock(SandboxLuaParser::class);
    $parser->shouldReceive('read')->andReturn($config)->byDefault();
    $parser->shouldReceive('parseContent')->andReturnUsing(fn (string $content) => (new SandboxLuaParser)->parseContent($content))->byDefault();
    $parser->shouldReceive('write')->byDefault();

    app()->instance(SandboxLuaParser::class, $parser);
}

function mockImportConfigState(): void
{
    $state = Mockery::mock(ConfigStateManager::class);
    $state->shouldReceive('persistSettings')->byDefault();

    app()->instance(ConfigStateManager::class, $state);
}

// ── Preview Endpoint ────────────────────────────────────────────────

it('requires authentication for import preview', function () {
    $this->postJson('/admin/config/import/preview', [
        'type' => 'server',
        'content' => 'MaxPlayers=32',
    ])->assertUnauthorized();
});

it('previews server config import with changes', function () {
    mockImportIniParser(['MaxPlayers' => '16', 'Public' => 'true']);
    mockImportLuaParser();

    $response = $this->actingAs(importAdmin())
        ->postJson('/admin/config/import/preview', [
            'type' => 'server',
            'content' => "MaxPlayers=32\nPublic=true\nNewSetting=value\n",
        ]);

    $response->assertOk();
    $response->assertJsonStructure(['changed', 'added', 'skipped', 'unchanged']);

    $data = $response->json();
    expect($data['changed'])->toHaveKey('MaxPlayers')
        ->and($data['added'])->toHaveKey('NewSetting', 'value')
        ->and($data['unchanged'])->toBe(1);
});

it('skips RCON and mod keys in server preview', function () {
    mockImportIniParser(['RCONPort' => '27015', 'Mods' => 'Test']);
    mockImportLuaParser();

    $response = $this->actingAs(importAdmin())
        ->postJson('/admin/config/import/preview', [
            'type' => 'server',
            'content' => "RCONPort=27015\nRCONPassword=secret\nMods=Mod1\nWorkshopItems=123\n",
        ]);

    $response->assertOk();
    $data = $response->json();

    expect($data['skipped'])
        ->toHaveKey('RCONPort')
        ->toHaveKey('RCONPassword')
        ->toHaveKey('Mods')
        ->toHaveKey('WorkshopItems');
});

it('previews sandbox config import', function () {
    mockImportIniParser();
    mockImportLuaParser(['Zombies' => 4, 'ZombieLore' => ['Speed' => 2]]);

    $response = $this->actingAs(importAdmin())
        ->postJson('/admin/config/import/preview', [
            'type' => 'sandbox',
            'content' => "SandboxVars = {\n    Zombies = 1,\n    ZombieLore = {\n        Speed = 3,\n    },\n}\n",
        ]);

    $response->assertOk();
    $data = $response->json();

    expect($data['changed'])->toHaveKey('Zombies')
        ->and($data['changed'])->toHaveKey('ZombieLore.Speed')
        ->and($data['skipped'])->toBeEmpty();
});

it('validates type field for preview', function () {
    mockImportIniParser();
    mockImportLuaParser();

    $this->actingAs(importAdmin())
        ->postJson('/admin/config/import/preview', [
            'type' => 'invalid',
            'content' => 'test',
        ])->assertUnprocessable();
});

it('validates content required for preview', function () {
    mockImportIniParser();
    mockImportLuaParser();

    $this->actingAs(importAdmin())
        ->postJson('/admin/config/import/preview', [
            'type' => 'server',
        ])->assertUnprocessable();
});

// ── Apply Endpoint ──────────────────────────────────────────────────

it('requires authentication for import apply', function () {
    $this->postJson('/admin/config/import/apply', [
        'type' => 'server',
        'settings' => ['MaxPlayers' => '32'],
    ])->assertUnauthorized();
});

it('applies server config import', function () {
    mockImportIniParser(['MaxPlayers' => '16']);
    mockImportLuaParser();
    mockImportConfigState();

    $response = $this->actingAs(importAdmin())
        ->postJson('/admin/config/import/apply', [
            'type' => 'server',
            'settings' => ['MaxPlayers' => '32'],
        ]);

    $response->assertOk();
    $response->assertJson([
        'updated_fields' => ['MaxPlayers'],
        'restart_required' => true,
    ]);
});

it('applies sandbox config import', function () {
    mockImportIniParser();
    mockImportLuaParser(['Zombies' => 4]);
    mockImportConfigState();

    $response = $this->actingAs(importAdmin())
        ->postJson('/admin/config/import/apply', [
            'type' => 'sandbox',
            'settings' => ['Zombies' => '1'],
        ]);

    $response->assertOk();
    $response->assertJson([
        'updated_fields' => ['Zombies'],
        'restart_required' => true,
    ]);
});

it('creates audit log for config import', function () {
    mockImportIniParser(['MaxPlayers' => '16']);
    mockImportLuaParser();
    mockImportConfigState();

    $admin = importAdmin();

    $this->actingAs($admin)
        ->postJson('/admin/config/import/apply', [
            'type' => 'server',
            'settings' => ['MaxPlayers' => '32'],
        ]);

    $log = AuditLog::query()->where('action', 'config.server.import')->first();

    expect($log)->not->toBeNull()
        ->and($log->actor)->toBe($admin->name)
        ->and($log->target)->toBe('server.ini');
});

it('creates audit log for sandbox import', function () {
    mockImportIniParser();
    mockImportLuaParser(['Zombies' => 4]);
    mockImportConfigState();

    $admin = importAdmin();

    $this->actingAs($admin)
        ->postJson('/admin/config/import/apply', [
            'type' => 'sandbox',
            'settings' => ['Zombies' => '1'],
        ]);

    $log = AuditLog::query()->where('action', 'config.sandbox.import')->first();

    expect($log)->not->toBeNull()
        ->and($log->actor)->toBe($admin->name)
        ->and($log->target)->toBe('SandboxVars.lua');
});

it('rejects unsafe values in import apply', function () {
    mockImportIniParser();
    mockImportLuaParser();
    mockImportConfigState();

    $this->actingAs(importAdmin())
        ->postJson('/admin/config/import/apply', [
            'type' => 'server',
            'settings' => ['MaxPlayers' => "32\nRCONPassword=hacked"],
        ])->assertUnprocessable();
});

it('validates settings required for import apply', function () {
    mockImportIniParser();
    mockImportLuaParser();

    $this->actingAs(importAdmin())
        ->postJson('/admin/config/import/apply', [
            'type' => 'server',
        ])->assertUnprocessable();
});

it('persists server config state after import', function () {
    $state = Mockery::mock(ConfigStateManager::class);
    $state->shouldReceive('persistSettings')
        ->once()
        ->with(['MaxPlayers' => '32'], Mockery::type('string'));

    app()->instance(ConfigStateManager::class, $state);

    mockImportIniParser(['MaxPlayers' => '16']);
    mockImportLuaParser();

    $this->actingAs(importAdmin())
        ->postJson('/admin/config/import/apply', [
            'type' => 'server',
            'settings' => ['MaxPlayers' => '32'],
        ]);
});

it('filters out skipped keys on server import apply', function () {
    $iniParser = Mockery::mock(\App\Services\ServerIniParser::class);
    $iniParser->shouldReceive('read')->andReturn(['MaxPlayers' => '16'])->byDefault();
    $iniParser->shouldReceive('write')
        ->once()
        ->with(Mockery::type('string'), Mockery::on(function (array $settings) {
            // RCONPassword should be filtered out, only MaxPlayers should remain
            return array_key_exists('MaxPlayers', $settings)
                && ! array_key_exists('RCONPassword', $settings)
                && ! array_key_exists('Mods', $settings);
        }));
    app()->instance(\App\Services\ServerIniParser::class, $iniParser);

    mockImportLuaParser();
    mockImportConfigState();

    $this->actingAs(importAdmin())
        ->postJson('/admin/config/import/apply', [
            'type' => 'server',
            'settings' => [
                'MaxPlayers' => '32',
                'RCONPassword' => 'hacked',
                'Mods' => 'EvilMod',
            ],
        ])->assertOk();
});

it('does not persist config state for sandbox import', function () {
    $state = Mockery::mock(ConfigStateManager::class);
    $state->shouldNotReceive('persistSettings');

    app()->instance(ConfigStateManager::class, $state);

    mockImportIniParser();
    mockImportLuaParser(['Zombies' => 4]);

    $this->actingAs(importAdmin())
        ->postJson('/admin/config/import/apply', [
            'type' => 'sandbox',
            'settings' => ['Zombies' => '1'],
        ]);
});
