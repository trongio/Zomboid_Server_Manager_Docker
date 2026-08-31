<?php

use App\Models\AuditLog;
use App\Models\User;
use App\Services\ServerIniParser;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->admin = User::factory()->admin()->create();
    $this->tempDir = sys_get_temp_dir().'/pz_remove_test_'.uniqid();
    mkdir($this->tempDir.'/Server', 0777, true);
    $this->iniPath = $this->tempDir.'/Server/ZomboidServer.ini';
    copy(base_path('tests/fixtures/server.ini'), $this->iniPath);
    config(['zomboid.paths.server_ini' => $this->iniPath]);
});

afterEach(function () {
    foreach (['.mod_state', '.mod_state_applied', '.mod_links.json', '.config_state', '.config_state.lock'] as $sidecar) {
        @unlink($this->tempDir.'/Server/'.$sidecar);
    }
    @unlink($this->iniPath);
    @rmdir($this->tempDir.'/Server');
    @rmdir($this->tempDir);
});

/**
 * The dashboard reaches DELETE through a POST plus `X-HTTP-Method-Override`, so the
 * removal path is exercised the way the browser actually calls it.
 */
function deleteModEntry(array $payload)
{
    return test()->actingAs(test()->admin)->postJson('/admin/mods/entry', $payload, [
        'X-HTTP-Method-Override' => 'DELETE',
    ]);
}

it('removes a mod that has no workshop id, the case the collection route rejected', function () {
    (new ServerIniParser)->write($this->iniPath, [
        'WorkshopItems' => '2561774086',
        'Mods' => 'SuperSurvivors;Excavation',
    ]);

    deleteModEntry(['mod_id' => 'Excavation'])
        ->assertOk()
        ->assertJson(['removed' => ['mod_id' => 'Excavation'], 'restart_required' => true]);

    expect((new ServerIniParser)->read($this->iniPath)['Mods'])->not->toContain('Excavation');
});

it('removes a mod by workshop id and mod id together', function () {
    deleteModEntry(['workshop_id' => '2561774086', 'mod_id' => 'SuperSurvivors'])->assertOk();

    $config = (new ServerIniParser)->read($this->iniPath);

    expect($config['Mods'])->not->toContain('SuperSurvivors')
        ->and($config['WorkshopItems'])->not->toContain('2561774086');
});

it('removes a workshop item that has no mod id of its own', function () {
    (new ServerIniParser)->write($this->iniPath, [
        'WorkshopItems' => '2561774086;9999999999',
        'Mods' => 'SuperSurvivors',
    ]);

    deleteModEntry(['workshop_id' => '9999999999'])->assertOk();

    expect((new ServerIniParser)->read($this->iniPath)['WorkshopItems'])->not->toContain('9999999999');
});

it('returns 404 when nothing matches', function () {
    deleteModEntry(['mod_id' => 'NotInstalled'])->assertNotFound();
});

it('rejects a payload with neither identifier', function () {
    deleteModEntry([])->assertStatus(422);
});

it('refuses to remove the required manager mod by either identifier', function () {
    deleteModEntry(['workshop_id' => '3685323705'])->assertStatus(422);
    deleteModEntry(['mod_id' => 'ZomboidManager'])->assertStatus(422);
});

it('rejects removal for guests', function () {
    $this->postJson('/admin/mods/entry', ['mod_id' => 'SuperSurvivors'], [
        'X-HTTP-Method-Override' => 'DELETE',
    ])->assertUnauthorized();
});

it('writes an audit log for the removal', function () {
    deleteModEntry(['mod_id' => 'SuperSurvivors'])->assertOk();

    expect(AuditLog::query()->where('action', 'mod.remove')->exists())->toBeTrue();
});

it('keeps sibling mods of a multi-mod workshop item installed', function () {
    (new ServerIniParser)->write($this->iniPath, [
        'WorkshopItems' => '2286126274',
        'Mods' => 'HydroA;HydroB',
    ]);
    $this->actingAs($this->admin)->postJson('/admin/mods/relink', [
        'links' => ['2286126274' => ['HydroA', 'HydroB']],
    ])->assertOk();

    deleteModEntry(['workshop_id' => '2286126274', 'mod_id' => 'HydroA'])->assertOk();

    $config = (new ServerIniParser)->read($this->iniPath);

    expect($config['Mods'])->toContain('HydroB')
        ->and($config['WorkshopItems'])->toContain('2286126274');
});

it('pairs the list through the relink endpoint without changing what is installed', function () {
    (new ServerIniParser)->write($this->iniPath, [
        'WorkshopItems' => '2286126274',
        'Mods' => 'HydroA;HydroB',
    ]);

    $response = $this->actingAs($this->admin)->postJson('/admin/mods/relink', [
        'links' => ['2286126274' => ['HydroA', 'HydroB']],
    ]);

    $response->assertOk()->assertJson(['linked' => 1]);

    expect(collect($response->json('mods'))->pluck('workshop_id')->all())
        ->toBe(['2286126274', '2286126274']);

    $config = (new ServerIniParser)->read($this->iniPath);
    expect($config['Mods'])->toBe('HydroA;HydroB')
        ->and($config['WorkshopItems'])->toBe('2286126274');
});

it('rejects a relink payload with no links', function () {
    $this->actingAs($this->admin)->postJson('/admin/mods/relink', ['links' => []])
        ->assertStatus(422);
});

it('rejects relinking for guests', function () {
    $this->postJson('/admin/mods/relink', ['links' => ['2286126274' => ['HydroA']]])
        ->assertUnauthorized();
});

it('pairs imported mods with the workshop items that provide them', function () {
    $response = $this->actingAs($this->admin)->postJson('/admin/mods/import', [
        'workshop_ids' => ['7777777777'],
        'mod_ids' => ['PackCore', 'PackExtras'],
        'links' => ['7777777777' => ['PackCore', 'PackExtras']],
    ]);

    $response->assertCreated();

    $paired = collect($response->json('mods'))
        ->whereIn('mod_id', ['PackCore', 'PackExtras'])
        ->pluck('workshop_id')
        ->all();

    expect($paired)->toBe(['7777777777', '7777777777']);
});
