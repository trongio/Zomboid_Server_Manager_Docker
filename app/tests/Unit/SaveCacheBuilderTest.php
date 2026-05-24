<?php

use App\Services\SaveCacheBuilder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Config;

uses(Tests\TestCase::class);

function pzSaveCacheTmp(string $suffix): string
{
    $dir = sys_get_temp_dir().'/pz_save_cache_test_'.$suffix.'_'.uniqid();
    @mkdir($dir, 0777, true);

    return $dir;
}

function pzSaveCacheRm(string $dir): void
{
    if (! is_dir($dir)) {
        return;
    }
    $items = scandir($dir);
    if ($items === false) {
        @rmdir($dir);

        return;
    }
    foreach ($items as $item) {
        if ($item === '.' || $item === '..') {
            continue;
        }
        $path = $dir.'/'.$item;
        if (is_dir($path)) {
            pzSaveCacheRm($path);
        } else {
            @unlink($path);
        }
    }
    @rmdir($dir);
}

beforeEach(function () {
    Cache::flush();
});

it('reports not ready when prerequisites missing', function () {
    Config::set('zomboid.paths.data', '/nonexistent/path');
    Config::set('zomboid.server_name', 'NoServer');

    $builder = new SaveCacheBuilder;

    expect($builder->isReady())->toBeFalse();
});

it('exposes derived paths from config', function () {
    $base = pzSaveCacheTmp('paths');
    Config::set('zomboid.paths.data', $base);
    Config::set('zomboid.server_name', 'TestServ');
    Config::set('zomboid.map.tiles_path', $base.'/map-tiles');

    $builder = new SaveCacheBuilder;

    expect($builder->saveDir())->toBe($base.'/Saves/Multiplayer/TestServ');
    expect($builder->outputDir())->toBe($base.'/map-tiles/save-cache');
    expect($builder->spritesJsonPath())->toBe($base.'/map-tiles/web/sprites.json');

    pzSaveCacheRm($base);
});

it('acquires lock atomically and releases it', function () {
    $builder = new SaveCacheBuilder;

    expect($builder->isLocked())->toBeFalse();
    expect($builder->acquireLock())->toBeTrue();
    expect($builder->isLocked())->toBeTrue();

    // Second call should fail (already locked)
    expect($builder->acquireLock())->toBeFalse();

    $builder->releaseLock();
    expect($builder->isLocked())->toBeFalse();
});

it('returns zero max chunk mtime when save dir is empty', function () {
    $base = pzSaveCacheTmp('empty');
    Config::set('zomboid.paths.data', $base);
    Config::set('zomboid.server_name', 'TestServ');

    @mkdir($base.'/Saves/Multiplayer/TestServ/map', 0777, true);

    $builder = new SaveCacheBuilder;

    expect($builder->maxChunkMtime())->toBe(0);

    pzSaveCacheRm($base);
});

it('finds max mtime across B42 chunk layout', function () {
    $base = pzSaveCacheTmp('mtime');
    Config::set('zomboid.paths.data', $base);
    Config::set('zomboid.server_name', 'TestServ');

    $mapDir = $base.'/Saves/Multiplayer/TestServ/map';
    @mkdir($mapDir.'/3', 0777, true);
    @mkdir($mapDir.'/5', 0777, true);

    file_put_contents($mapDir.'/3/4.bin', 'fake');
    file_put_contents($mapDir.'/5/7.bin', 'fake');

    $earlierMtime = time() - 3600;
    $laterMtime = time() - 60;
    touch($mapDir.'/3/4.bin', $earlierMtime);
    touch($mapDir.'/5/7.bin', $laterMtime);

    $builder = new SaveCacheBuilder;

    expect($builder->maxChunkMtime())->toBe($laterMtime);

    pzSaveCacheRm($base);
});
