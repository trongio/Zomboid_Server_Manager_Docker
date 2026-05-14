<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->admin = User::factory()->admin()->create();
    Cache::flush();
});

it('returns parsed mod ids from the workshop description', function () {
    Http::fake([
        'api.steampowered.com/*' => Http::response([
            'response' => [
                'publishedfiledetails' => [[
                    'result' => 1,
                    'publishedfileid' => '2561774086',
                    'title' => 'Super Survivors!',
                    'description' => "Awesome mod.\nMod ID: SuperSurvivors\nWorkshop ID: 2561774086",
                    'preview_url' => 'https://example.invalid/preview.jpg',
                ]],
            ],
        ]),
    ]);

    $this->actingAs($this->admin)
        ->postJson('/admin/mods/lookup', ['workshop_id' => '2561774086'])
        ->assertOk()
        ->assertJson([
            'found' => true,
            'workshop_id' => '2561774086',
            'title' => 'Super Survivors!',
            'preview_url' => 'https://example.invalid/preview.jpg',
            'mod_ids' => ['SuperSurvivors'],
            'map_folders' => [],
        ]);
});

it('returns multiple mod ids for a modpack', function () {
    Http::fake([
        'api.steampowered.com/*' => Http::response([
            'response' => [
                'publishedfiledetails' => [[
                    'result' => 1,
                    'publishedfileid' => '111',
                    'title' => 'Pack',
                    'description' => "Mod ID: PackCore\nMod ID: PackUI\nMap Folder: PackMap",
                    'preview_url' => null,
                ]],
            ],
        ]),
    ]);

    $this->actingAs($this->admin)
        ->postJson('/admin/mods/lookup', ['workshop_id' => '111'])
        ->assertOk()
        ->assertJson([
            'found' => true,
            'mod_ids' => ['PackCore', 'PackUI'],
            'map_folders' => ['PackMap'],
        ]);
});

it('returns 404 when Steam reports the file is missing', function () {
    Http::fake([
        'api.steampowered.com/*' => Http::response([
            'response' => [
                'publishedfiledetails' => [[
                    'result' => 9, // k_EResultFileNotFound
                    'publishedfileid' => '999',
                ]],
            ],
        ]),
    ]);

    $this->actingAs($this->admin)
        ->postJson('/admin/mods/lookup', ['workshop_id' => '999'])
        ->assertStatus(404)
        ->assertJson(['found' => false, 'workshop_id' => '999']);
});

it('returns mod_ids as empty list when description lacks Mod ID line', function () {
    Http::fake([
        'api.steampowered.com/*' => Http::response([
            'response' => [
                'publishedfiledetails' => [[
                    'result' => 1,
                    'publishedfileid' => '222',
                    'title' => 'Quiet Mod',
                    'description' => 'No conventional fields here.',
                ]],
            ],
        ]),
    ]);

    $this->actingAs($this->admin)
        ->postJson('/admin/mods/lookup', ['workshop_id' => '222'])
        ->assertOk()
        ->assertJson([
            'found' => true,
            'mod_ids' => [],
        ]);
});

it('rejects a non-numeric workshop id', function () {
    $this->actingAs($this->admin)
        ->postJson('/admin/mods/lookup', ['workshop_id' => 'abc'])
        ->assertStatus(422)
        ->assertJsonValidationErrors('workshop_id');
});

it('requires authentication', function () {
    $this->postJson('/admin/mods/lookup', ['workshop_id' => '111'])
        ->assertStatus(401);
});
