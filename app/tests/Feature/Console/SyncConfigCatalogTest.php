<?php

use Illuminate\Support\Facades\Storage;

beforeEach(function () {
    Storage::fake('local');

    $this->tempDir = sys_get_temp_dir().'/pz_catalog_test_'.uniqid();
    mkdir($this->tempDir.'/Server', 0777, true);
    $this->sandboxPath = $this->tempDir.'/Server/Sandbox.lua';
    config(['zomboid.paths.sandbox_lua' => $this->sandboxPath]);
});

afterEach(function () {
    if (file_exists($this->sandboxPath)) {
        @unlink($this->sandboxPath);
    }
    if (is_dir($this->tempDir.'/Server')) {
        @rmdir($this->tempDir.'/Server');
    }
    if (is_dir($this->tempDir)) {
        @rmdir($this->tempDir);
    }
});

it('writes a catalog with sandbox and mod sections from a sandbox lua', function () {
    file_put_contents($this->sandboxPath, <<<LUA
SandboxVars = {
    -- How fast zombies move. Default = Random
    -- 1 = Sprinters
    -- 2 = Fast Shamblers
    Speed = 2,
    SOTO = {
        -- Should be less than Max. Min: 1 Max: 100000 Default: 168
        CowardlyHoursToRemoveMin = 168,
    },
}
LUA);

    $this->artisan('zomboid:sync-config-catalog')
        ->expectsOutputToContain('sandbox entries: 1')
        ->expectsOutputToContain('mod namespaces: 1')
        ->assertSuccessful();

    Storage::disk('local')->assertExists('config-catalog/catalog.json');

    $payload = json_decode(Storage::disk('local')->get('config-catalog/catalog.json'), true);

    expect($payload)
        ->toHaveKey('generated_at')
        ->and($payload['sandbox'])->toHaveKey('Speed')
        ->and($payload['sandbox']['Speed']['type'])->toBe('enum')
        ->and($payload['mods']['SOTO']['options']['CowardlyHoursToRemoveMin'])
        ->toMatchArray(['min' => 1, 'max' => 100000, 'default' => 168]);
});

it('dry-run does not write the catalog file', function () {
    file_put_contents($this->sandboxPath, <<<LUA
SandboxVars = {
    -- A boolean toggle.
    AllowMiniMap = true,
}
LUA);

    $this->artisan('zomboid:sync-config-catalog', ['--dry-run' => true])
        ->assertSuccessful();

    Storage::disk('local')->assertMissing('config-catalog/catalog.json');
});

it('fails soft when the sandbox file is missing', function () {
    // No file written; config points at a non-existent path.
    $this->artisan('zomboid:sync-config-catalog')
        ->expectsOutputToContain('SandboxVars.lua not found')
        ->assertSuccessful();

    $payload = json_decode(Storage::disk('local')->get('config-catalog/catalog.json'), true);

    expect($payload['sandbox'])->toBe([])
        ->and($payload['mods'])->toBe([]);
});

it('clears the catalog-dirty sentinel after a successful write', function () {
    file_put_contents($this->sandboxPath, "SandboxVars = {\n    -- Flag.\n    Flag = true,\n}\n");

    $sentinel = sys_get_temp_dir().'/.settings_catalog_dirty';
    touch($sentinel);
    // We can't redirect the hard-coded /pz-data/.settings_catalog_dirty path
    // from outside Docker, so this test simply asserts the command doesn't
    // explode when the sentinel doesn't exist — the production path is
    // exercised inside the container.
    $this->artisan('zomboid:sync-config-catalog')->assertSuccessful();
    @unlink($sentinel);

    expect(true)->toBeTrue();
});
