<?php

use App\Services\MapRenderService;
use Illuminate\Support\Facades\Cache;

it('acquires the render lock atomically', function () {
    Cache::flush();
    $service = new MapRenderService;

    expect($service->isRendering())->toBeFalse();
    expect($service->acquireLock())->toBeTrue();
    expect($service->isRendering())->toBeTrue();
    expect($service->acquireLock())->toBeFalse();

    $service->releaseLock();

    expect($service->isRendering())->toBeFalse();
});

it('records and clears render progress', function () {
    Cache::flush();
    $service = new MapRenderService;

    expect($service->currentProgress())->toBeNull();

    $service->writeProgress(MapRenderService::STAGE_BASE, 42, 'Rendering base map');

    $progress = $service->currentProgress();
    expect($progress)->not->toBeNull();
    expect($progress['stage'])->toBe('render_base');
    expect($progress['percent'])->toBe(42);
    expect($progress['message'])->toBe('Rendering base map');

    $service->clearProgress();
    expect($service->currentProgress())->toBeNull();
});

it('clamps progress percent to 0-100', function () {
    Cache::flush();
    $service = new MapRenderService;

    $service->writeProgress('x', -10);
    expect($service->currentProgress()['percent'])->toBe(0);

    $service->writeProgress('x', 250);
    expect($service->currentProgress()['percent'])->toBe(100);
});

it('tracks cancel requests separately from the lock', function () {
    Cache::flush();
    $service = new MapRenderService;

    expect($service->isCancelRequested())->toBeFalse();

    $service->requestCancel();
    expect($service->isCancelRequested())->toBeTrue();

    $service->releaseLock();
    expect($service->isCancelRequested())->toBeFalse();
});

it('derives the active save path from the configured server name', function () {
    config()->set('zomboid.paths.data', '/pz-data');
    config()->set('zomboid.server_name', 'TestServer');

    expect((new MapRenderService)->activeSavePath())->toBe('/pz-data/Saves/Multiplayer/TestServer');
});

it('parses the latest job: X/Y line from the pzmap2dzi log tail', function () {
    @unlink(storage_path('logs/pzmap2dzi.log'));
    @unlink(storage_path('logs/pzmap2dzi_live.log'));
    foreach ((array) glob(sys_get_temp_dir().'/pzmap2dzi_*') as $f) {
        @unlink((string) $f);
    }
    $logFile = storage_path('logs/pzmap2dzi.log');
    file_put_contents($logFile, "preflight\njob: 100/200 worker: 36/36\rjob: 150/200 worker: 36/36\rjob: 175/200 worker: 24/36");

    $progress = (new MapRenderService)->parseProgressFromLog();

    expect($progress)->not->toBeNull();
    expect($progress['completed'])->toBe(175);
    expect($progress['total'])->toBe(200);
    expect($progress['percent'])->toBe(88);
    expect($progress['active_workers'])->toBe(24);
    expect($progress['total_workers'])->toBe(36);

    @unlink($logFile);
});

it('returns null when log has no progress lines', function () {
    @unlink(storage_path('logs/pzmap2dzi.log'));
    @unlink(storage_path('logs/pzmap2dzi_live.log'));
    foreach ((array) glob(sys_get_temp_dir().'/pzmap2dzi_*') as $f) {
        @unlink((string) $f);
    }
    $logFile = storage_path('logs/pzmap2dzi.log');
    file_put_contents($logFile, "Starting render\nTraceback (most recent call last):\n");

    expect((new MapRenderService)->parseProgressFromLog())->toBeNull();

    @unlink($logFile);
});

it('reports texturepacks absent when the directory or required files are missing', function () {
    $tmp = sys_get_temp_dir().'/maprender_test_'.uniqid();
    config()->set('zomboid.map.texturepacks_path', $tmp);

    $service = new MapRenderService;

    expect($service->hasTexturepacks())->toBeFalse();

    mkdir($tmp, 0755, true);
    expect($service->hasTexturepacks())->toBeFalse();

    foreach (['Tiles2x.pack', 'Tiles2x.floor.pack', 'JumboTrees2x.pack'] as $file) {
        file_put_contents($tmp.'/'.$file, 'stub');
    }
    expect($service->hasTexturepacks())->toBeFalse();

    file_put_contents($tmp.'/Overlays2x.pack', 'stub');
    expect($service->hasTexturepacks())->toBeTrue();

    foreach ((array) glob($tmp.'/*.pack') as $f) {
        @unlink((string) $f);
    }
    @rmdir($tmp);
});
