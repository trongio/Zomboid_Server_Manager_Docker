<?php

use App\Models\AuditLog;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;

uses(RefreshDatabase::class);

function modApiHeaders(): array
{
    return ['X-API-Key' => 'test-key-12345'];
}

beforeEach(function () {
    config(['zomboid.api_key' => 'test-key-12345']);

    $this->tempDir = sys_get_temp_dir().'/pz_mod_test_'.uniqid();
    mkdir($this->tempDir.'/Server', 0777, true);
    $this->iniPath = $this->tempDir.'/Server/ZomboidServer.ini';
    copy(base_path('tests/fixtures/server.ini'), $this->iniPath);
    config(['zomboid.paths.server_ini' => $this->iniPath]);
});

afterEach(function () {
    @unlink($this->tempDir.'/Server/.mod_state');
    @unlink($this->iniPath);
    @rmdir($this->tempDir.'/Server');
    @rmdir($this->tempDir);
});

// ── GET /api/config/mods ─────────────────────────────────────────────

it('returns current mod list', function () {
    $response = $this->getJson('/api/config/mods', modApiHeaders())
        ->assertOk();

    $mods = $response->json('mods');

    expect($mods)->toHaveCount(2)
        ->and($mods[0]['workshop_id'])->toBe('2561774086')
        ->and($mods[0]['mod_id'])->toBe('SuperSurvivors')
        ->and($mods[0]['position'])->toBe(0)
        ->and($mods[1]['workshop_id'])->toBe('2286126274')
        ->and($mods[1]['mod_id'])->toBe('Hydrocraft')
        ->and($mods[1]['position'])->toBe(1);
});

it('returns empty list when no mods', function () {
    // Write empty mods to ini
    file_put_contents($this->iniPath, str_replace(
        ['Mods=SuperSurvivors;Hydrocraft', 'WorkshopItems=2561774086;2286126274'],
        ['Mods=', 'WorkshopItems='],
        file_get_contents($this->iniPath),
    ));

    $response = $this->getJson('/api/config/mods', modApiHeaders())
        ->assertOk();

    expect($response->json('mods'))->toBe([]);
});

// ── POST /api/config/mods ────────────────────────────────────────────

it('adds a mod', function () {
    $this->postJson('/api/config/mods', [
        'workshop_id' => '1234567890',
        'mod_id' => 'NewMod',
    ], modApiHeaders())
        ->assertOk()
        ->assertJson([
            'added' => ['workshop_id' => '1234567890', 'mod_id' => 'NewMod'],
            'restart_required' => true,
        ]);

    // Verify it was added
    $response = $this->getJson('/api/config/mods', modApiHeaders())->assertOk();
    expect($response->json('mods'))->toHaveCount(3);

    // Verify audit log
    expect(AuditLog::where('action', 'mod.add')->exists())->toBeTrue();
});

it('does not add duplicate workshop id', function () {
    $this->postJson('/api/config/mods', [
        'workshop_id' => '2561774086',
        'mod_id' => 'SuperSurvivors',
    ], modApiHeaders())
        ->assertOk();

    $response = $this->getJson('/api/config/mods', modApiHeaders())->assertOk();
    expect($response->json('mods'))->toHaveCount(2);
});

it('adds map mod with map folder', function () {
    $this->postJson('/api/config/mods', [
        'workshop_id' => '9999999999',
        'mod_id' => 'MapMod',
        'map_folder' => 'CustomMap',
    ], modApiHeaders())
        ->assertOk();

    // Verify map was updated in INI
    $content = file_get_contents($this->iniPath);
    expect($content)->toContain('Map=Muldraugh, KY;CustomMap');
});

it('validates required fields', function () {
    $this->postJson('/api/config/mods', [], modApiHeaders())
        ->assertUnprocessable()
        ->assertJsonValidationErrors(['workshop_id', 'mod_id']);
});

// ── DELETE /api/config/mods/{workshopId} ─────────────────────────────

it('removes a mod', function () {
    $this->deleteJson('/api/config/mods/2561774086', [], modApiHeaders())
        ->assertOk()
        ->assertJson([
            'removed' => ['workshop_id' => '2561774086', 'mod_id' => 'SuperSurvivors'],
            'restart_required' => true,
        ]);

    $response = $this->getJson('/api/config/mods', modApiHeaders())->assertOk();
    expect($response->json('mods'))->toHaveCount(1)
        ->and($response->json('mods.0.workshop_id'))->toBe('2286126274');

    expect(AuditLog::where('action', 'mod.remove')->exists())->toBeTrue();
});

it('returns 404 when removing nonexistent mod', function () {
    $this->deleteJson('/api/config/mods/0000000000', [], modApiHeaders())
        ->assertNotFound();
});

// ── PUT /api/config/mods/order ───────────────────────────────────────

it('reorders mods', function () {
    $this->putJson('/api/config/mods/order', [
        'mods' => [
            ['workshop_id' => '2286126274', 'mod_id' => 'Hydrocraft'],
            ['workshop_id' => '2561774086', 'mod_id' => 'SuperSurvivors'],
        ],
    ], modApiHeaders())
        ->assertOk()
        ->assertJson([
            'restart_required' => true,
        ]);

    $response = $this->getJson('/api/config/mods', modApiHeaders())->assertOk();
    expect($response->json('mods.0.workshop_id'))->toBe('2286126274')
        ->and($response->json('mods.1.workshop_id'))->toBe('2561774086');

    expect(AuditLog::where('action', 'mod.reorder')->exists())->toBeTrue();
});

it('validates reorder requires mods array', function () {
    $this->putJson('/api/config/mods/order', [], modApiHeaders())
        ->assertUnprocessable()
        ->assertJsonValidationErrors('mods');
});

// ── Error handling ───────────────────────────────────────────────────

it('returns JSON 500 with error message when state file write fails', function () {
    Log::spy();
    chmod($this->tempDir.'/Server', 0555);

    try {
        $this->postJson('/api/config/mods', [
            'workshop_id' => '1234567890',
            'mod_id' => 'NewMod',
        ], modApiHeaders())
            ->assertStatus(500)
            ->assertJsonStructure(['error']);
    } finally {
        chmod($this->tempDir.'/Server', 0777);
    }

    Log::shouldHaveReceived('error')->once();
})->skip(getmyuid() === 0, 'chmod restrictions are bypassed by root');

// ── Protected (required) mod ────────────────────────────────────────

it('refuses to remove the required ZomboidManager mod', function () {
    file_put_contents($this->iniPath, str_replace(
        ['Mods=SuperSurvivors;Hydrocraft', 'WorkshopItems=2561774086;2286126274'],
        ['Mods=ZomboidManager;SuperSurvivors', 'WorkshopItems=3685323705;2561774086'],
        file_get_contents($this->iniPath),
    ));

    $this->deleteJson('/api/config/mods/3685323705', [], modApiHeaders())
        ->assertStatus(422)
        ->assertJsonStructure(['error']);

    $response = $this->getJson('/api/config/mods', modApiHeaders())->assertOk();
    expect($response->json('mods.0.workshop_id'))->toBe('3685323705');
});

it('refuses to reorder if the required mod is dropped', function () {
    file_put_contents($this->iniPath, str_replace(
        ['Mods=SuperSurvivors;Hydrocraft', 'WorkshopItems=2561774086;2286126274'],
        ['Mods=ZomboidManager;SuperSurvivors', 'WorkshopItems=3685323705;2561774086'],
        file_get_contents($this->iniPath),
    ));

    $this->putJson('/api/config/mods/order', [
        'mods' => [
            ['workshop_id' => '2561774086', 'mod_id' => 'SuperSurvivors'],
        ],
    ], modApiHeaders())
        ->assertStatus(422)
        ->assertJsonValidationErrors('mods');
});

// ── Auth ─────────────────────────────────────────────────────────────

it('requires auth for mod endpoints', function () {
    $this->getJson('/api/config/mods')->assertUnauthorized();
    $this->postJson('/api/config/mods')->assertUnauthorized();
    $this->deleteJson('/api/config/mods/123')->assertUnauthorized();
    $this->putJson('/api/config/mods/order')->assertUnauthorized();
});
