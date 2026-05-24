<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Config;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->admin = User::factory()->admin()->create();
});

describe('PzMapDataController::saveCellData', function () {
    it('returns 404 when save root directory does not exist', function () {
        Config::set('zomboid.paths.data', '/nonexistent/path');
        Config::set('zomboid.server_name', 'TestServer');

        $this->actingAs($this->admin)
            ->get(route('admin.api.pz-map.cell.save', ['x' => '10', 'y' => '20']))
            ->assertNotFound();
    });

    it('returns 404 when save file does not exist for valid coordinates', function () {
        // Use a real temp directory so the saveRoot resolves, but no .bin file inside
        $tmpDir = sys_get_temp_dir().'/pz_test_saves/Saves/Multiplayer/TestServ/map';
        @mkdir($tmpDir, 0777, true);

        Config::set('zomboid.paths.data', sys_get_temp_dir().'/pz_test_saves');
        Config::set('zomboid.server_name', 'TestServ');

        $this->actingAs($this->admin)
            ->get(route('admin.api.pz-map.cell.save', ['x' => '5', 'y' => '7']))
            ->assertNotFound();

        // cleanup
        @rmdir($tmpDir);
        @rmdir(sys_get_temp_dir().'/pz_test_saves/Saves/Multiplayer/TestServ');
        @rmdir(sys_get_temp_dir().'/pz_test_saves/Saves/Multiplayer');
        @rmdir(sys_get_temp_dir().'/pz_test_saves/Saves');
        @rmdir(sys_get_temp_dir().'/pz_test_saves');
    });

    it('returns 200 with binary content type for a valid B42 save file', function () {
        $cellX = 3;
        $cellY = 4;

        // Build the B42 save directory layout: map/X/Y.bin
        $baseDir = sys_get_temp_dir().'/pz_test_saves2';
        $saveRoot = $baseDir.'/Saves/Multiplayer/TestServ2/map';
        $cellDir = $saveRoot.'/'.$cellX;
        @mkdir($cellDir, 0777, true);

        // Write a minimal 5-byte file that looks like a valid save header
        // Byte 0: unknown; bytes 1-4: version big-endian (200 > 195 = B42)
        $binFile = $cellDir.'/'.$cellY.'.bin';
        $versionBytes = pack('N', 200); // big-endian uint32 = 200
        file_put_contents($binFile, "\x00".$versionBytes.'fake-save-payload');

        Config::set('zomboid.paths.data', $baseDir);
        Config::set('zomboid.server_name', 'TestServ2');

        $response = $this->actingAs($this->admin)
            ->get(route('admin.api.pz-map.cell.save', ['x' => (string) $cellX, 'y' => (string) $cellY]));

        $response->assertOk();
        $response->assertHeader('Content-Type', 'application/octet-stream');

        // cleanup
        @unlink($binFile);
        @rmdir($cellDir);
        @rmdir($saveRoot);
        @rmdir($baseDir.'/Saves/Multiplayer/TestServ2');
        @rmdir($baseDir.'/Saves/Multiplayer');
        @rmdir($baseDir.'/Saves');
        @rmdir($baseDir);
    });

    it('returns 404 for path traversal attempts', function () {
        $this->actingAs($this->admin)
            ->get('/admin/api/pz-map/cell/../../etc/passwd/save')
            ->assertNotFound();
    });

    it('rejects non-numeric cell coordinates via route constraint', function () {
        $this->actingAs($this->admin)
            ->get('/admin/api/pz-map/cell/abc/xyz/save')
            ->assertNotFound();
    });
});
