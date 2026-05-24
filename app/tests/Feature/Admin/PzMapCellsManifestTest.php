<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Config;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->admin = User::factory()->admin()->create();
});

describe('PzMapDataController::cellsManifest', function () {
    it('returns 503 when baseMapDir does not exist', function () {
        Config::set('zomboid.game_server_path', '/nonexistent/pz-server-missing');

        $this->actingAs($this->admin)
            ->getJson(route('admin.api.pz-map.cells'))
            ->assertStatus(503)
            ->assertJson(['error' => 'no-map-data']);
    });

    it('returns 503 when baseMapDir exists but contains no .lotheader files', function () {
        $tmpDir = sys_get_temp_dir().'/pz_cells_test_empty/media/maps/Muldraugh, KY';
        @mkdir($tmpDir, 0777, true);

        Config::set('zomboid.game_server_path', sys_get_temp_dir().'/pz_cells_test_empty');

        $response = $this->actingAs($this->admin)
            ->getJson(route('admin.api.pz-map.cells'));

        $response->assertStatus(503)->assertJson(['error' => 'no-map-data']);

        @rmdir($tmpDir);
        @rmdir(sys_get_temp_dir().'/pz_cells_test_empty/media/maps');
        @rmdir(sys_get_temp_dir().'/pz_cells_test_empty/media');
        @rmdir(sys_get_temp_dir().'/pz_cells_test_empty');
    });

    it('returns 200 with valid JSON cells array when .lotheader files exist', function () {
        $tmpDir = sys_get_temp_dir().'/pz_cells_test_valid/media/maps/Muldraugh, KY';
        @mkdir($tmpDir, 0777, true);

        // Create fake .lotheader files for an L-shaped map
        $files = ['0_18.lotheader', '1_18.lotheader', '45_3.lotheader', '58_0.lotheader'];
        foreach ($files as $f) {
            file_put_contents($tmpDir.'/'.$f, 'fake');
        }

        Config::set('zomboid.game_server_path', sys_get_temp_dir().'/pz_cells_test_valid');

        $response = $this->actingAs($this->admin)
            ->getJson(route('admin.api.pz-map.cells'));

        $response->assertOk();
        $data = $response->json();

        expect($data)->toHaveKeys(['version', 'cells']);
        expect($data['version'])->toBeString()->toHaveLength(40); // sha1 hex
        expect($data['cells'])->toBeArray()->toHaveCount(4);

        // Cells should be sorted: first by X, then Y
        $cells = $data['cells'];
        expect($cells[0])->toBe([0, 18]);
        expect($cells[1])->toBe([1, 18]);
        expect($cells[2])->toBe([45, 3]);
        expect($cells[3])->toBe([58, 0]);

        // Cleanup
        foreach ($files as $f) {
            @unlink($tmpDir.'/'.$f);
        }
        @rmdir($tmpDir);
        @rmdir(sys_get_temp_dir().'/pz_cells_test_valid/media/maps');
        @rmdir(sys_get_temp_dir().'/pz_cells_test_valid/media');
        @rmdir(sys_get_temp_dir().'/pz_cells_test_valid');
    });

    it('ignores non-numeric and traversal filenames', function () {
        $tmpDir = sys_get_temp_dir().'/pz_cells_test_traversal/media/maps/Muldraugh, KY';
        @mkdir($tmpDir, 0777, true);

        $valid = '10_20.lotheader';
        file_put_contents($tmpDir.'/'.$valid, 'fake');

        // These should all be ignored
        $invalid = [
            '../etc/passwd.lotheader',
            'abc_def.lotheader',
            '10_20.bin',
            'lotheader',
            '10_20.lotheader.bak',
        ];
        foreach ($invalid as $f) {
            // Some of these names are not valid filesystem names on all OSes —
            // only create ones that are safe to touch
            if (! str_contains($f, '/') && ! str_contains($f, '\\')) {
                @file_put_contents($tmpDir.'/'.$f, 'fake');
            }
        }

        Config::set('zomboid.game_server_path', sys_get_temp_dir().'/pz_cells_test_traversal');

        $response = $this->actingAs($this->admin)
            ->getJson(route('admin.api.pz-map.cells'));

        $response->assertOk();
        $data = $response->json();

        // Only the one valid cell should be present
        expect($data['cells'])->toHaveCount(1);
        expect($data['cells'][0])->toBe([10, 20]);

        // Cleanup
        foreach (array_merge([$valid], $invalid) as $f) {
            if (! str_contains($f, '/') && ! str_contains($f, '\\')) {
                @unlink($tmpDir.'/'.$f);
            }
        }
        @rmdir($tmpDir);
        @rmdir(sys_get_temp_dir().'/pz_cells_test_traversal/media/maps');
        @rmdir(sys_get_temp_dir().'/pz_cells_test_traversal/media');
        @rmdir(sys_get_temp_dir().'/pz_cells_test_traversal');
    });

    it('returns Cache-Control public header', function () {
        $tmpDir = sys_get_temp_dir().'/pz_cells_test_cache/media/maps/Muldraugh, KY';
        @mkdir($tmpDir, 0777, true);
        file_put_contents($tmpDir.'/5_5.lotheader', 'fake');

        Config::set('zomboid.game_server_path', sys_get_temp_dir().'/pz_cells_test_cache');

        $response = $this->actingAs($this->admin)
            ->getJson(route('admin.api.pz-map.cells'));

        $response->assertOk();
        // Symfony may reorder Cache-Control directives; check both values are present.
        $cacheControl = $response->headers->get('Cache-Control', '');
        expect($cacheControl)->toContain('public');
        expect($cacheControl)->toContain('max-age=300');

        @unlink($tmpDir.'/5_5.lotheader');
        @rmdir($tmpDir);
        @rmdir(sys_get_temp_dir().'/pz_cells_test_cache/media/maps');
        @rmdir(sys_get_temp_dir().'/pz_cells_test_cache/media');
        @rmdir(sys_get_temp_dir().'/pz_cells_test_cache');
    });

    it('returns 401 without authentication', function () {
        $this->getJson(route('admin.api.pz-map.cells'))
            ->assertUnauthorized();
    });
});
