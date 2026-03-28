<?php

use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

function injectionApiKey(): array
{
    return ['X-API-Key' => 'test-key-12345'];
}

beforeEach(function () {
    config(['zomboid.api_key' => 'test-key-12345']);

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

// ── Server Config (INI) Injection ──────────────────────────────────

it('rejects newline injection in server config values', function () {
    $this->patchJson('/api/config/server', [
        'settings' => ['MaxPlayers' => "32\nRCONPassword=hacked"],
    ], injectionApiKey())
        ->assertUnprocessable();
});

it('rejects double quote in server config values', function () {
    $this->patchJson('/api/config/server', [
        'settings' => ['MaxPlayers' => 'test"injection'],
    ], injectionApiKey())
        ->assertUnprocessable();
});

it('rejects backtick in server config values', function () {
    $this->patchJson('/api/config/server', [
        'settings' => ['MaxPlayers' => 'test`cmd`'],
    ], injectionApiKey())
        ->assertUnprocessable();
});

it('rejects parentheses in server config values', function () {
    $this->patchJson('/api/config/server', [
        'settings' => ['MaxPlayers' => 'os.execute()'],
    ], injectionApiKey())
        ->assertUnprocessable();
});

it('rejects curly braces in server config values', function () {
    $this->patchJson('/api/config/server', [
        'settings' => ['MaxPlayers' => 'test{inject}'],
    ], injectionApiKey())
        ->assertUnprocessable();
});

it('accepts valid server config values', function () {
    $this->patchJson('/api/config/server', [
        'settings' => ['MaxPlayers' => '32'],
    ], injectionApiKey())
        ->assertOk();
});

it('accepts semicolons in server config values', function () {
    $this->patchJson('/api/config/server', [
        'settings' => ['Mods' => 'ModA;ModB;ModC'],
    ], injectionApiKey())
        ->assertOk();
});

it('accepts commas and spaces in server config values', function () {
    $this->patchJson('/api/config/server', [
        'settings' => ['Map' => 'Muldraugh, KY'],
    ], injectionApiKey())
        ->assertOk();
});

// ── Sandbox Config (Lua) Injection ──────────────────────────────────

it('rejects Lua code injection in sandbox config values', function () {
    $this->patchJson('/api/config/sandbox', [
        'settings' => ['ZombieLore.Speed' => '3" .. os.execute("id") .. "'],
    ], injectionApiKey())
        ->assertUnprocessable();
});

it('rejects Lua concatenation operator in sandbox config values', function () {
    $this->patchJson('/api/config/sandbox', [
        'settings' => ['ZombieLore.Speed' => '3..5'],
    ], injectionApiKey())
        ->assertUnprocessable();
});

it('rejects backslash in sandbox config values', function () {
    $this->patchJson('/api/config/sandbox', [
        'settings' => ['ZombieLore.Speed' => 'test\\escape'],
    ], injectionApiKey())
        ->assertUnprocessable();
});

it('accepts valid numeric sandbox config values', function () {
    $this->patchJson('/api/config/sandbox', [
        'settings' => ['Zombies' => 1],
    ], injectionApiKey())
        ->assertOk();
});

it('accepts valid mixed sandbox config values', function () {
    $this->patchJson('/api/config/sandbox', [
        'settings' => ['Zombies' => 4, 'DayLength' => 2],
    ], injectionApiKey())
        ->assertOk();
});
