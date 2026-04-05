<?php

use App\Services\DockerManager;
use App\Services\GameStateReader;
use App\Services\GameVersionReader;

uses(Tests\TestCase::class);

beforeEach(function () {
    $this->tempDir = sys_get_temp_dir().'/game_version_test_'.uniqid();
    mkdir($this->tempDir, 0755, true);
    $this->gameStatePath = $this->tempDir.'/game_state.json';
    $this->consoleLogPath = $this->tempDir.'/server-console.txt';
    Illuminate\Support\Facades\Cache::flush();
});

afterEach(function () {
    foreach ([$this->gameStatePath, $this->consoleLogPath] as $f) {
        if (file_exists($f)) {
            unlink($f);
        }
    }
    if (is_dir($this->tempDir)) {
        rmdir($this->tempDir);
    }
});

test('extracts numeric version from full PZ version string', function () {
    $data = [
        'time' => ['year' => 1993, 'month' => 7, 'day' => 9, 'hour' => 14, 'minute' => 30, 'day_of_year' => 190, 'is_night' => false, 'formatted' => '14:30', 'date' => '1993-07-09'],
        'season' => 'summer',
        'weather' => null,
        'game_version' => '42.15.3 aa7f064af2a82d8070ccc6c7fa7c11f89da23b06 2026-03-20 09:33:06 (ZB)',
        'exported_at' => gmdate('Y-m-d\TH:i:s\Z'),
    ];

    file_put_contents($this->gameStatePath, json_encode($data));

    $reader = new GameVersionReader(
        new GameStateReader($this->gameStatePath),
        Mockery::mock(DockerManager::class),
    );

    expect($reader->detectVersion())->toBe('42.15.3');
});

test('handles clean version string without hash', function () {
    $data = [
        'time' => ['year' => 1993, 'month' => 7, 'day' => 9, 'hour' => 14, 'minute' => 30, 'day_of_year' => 190, 'is_night' => false, 'formatted' => '14:30', 'date' => '1993-07-09'],
        'season' => 'summer',
        'weather' => null,
        'game_version' => '42.15.3',
        'exported_at' => gmdate('Y-m-d\TH:i:s\Z'),
    ];

    file_put_contents($this->gameStatePath, json_encode($data));

    $reader = new GameVersionReader(
        new GameStateReader($this->gameStatePath),
        Mockery::mock(DockerManager::class),
    );

    expect($reader->detectVersion())->toBe('42.15.3');
});

test('handles two-part version string', function () {
    $data = [
        'time' => ['year' => 1993, 'month' => 7, 'day' => 9, 'hour' => 14, 'minute' => 30, 'day_of_year' => 190, 'is_night' => false, 'formatted' => '14:30', 'date' => '1993-07-09'],
        'season' => 'summer',
        'weather' => null,
        'game_version' => '42.15',
        'exported_at' => gmdate('Y-m-d\TH:i:s\Z'),
    ];

    file_put_contents($this->gameStatePath, json_encode($data));

    $reader = new GameVersionReader(
        new GameStateReader($this->gameStatePath),
        Mockery::mock(DockerManager::class),
    );

    expect($reader->detectVersion())->toBe('42.15');
});

test('falls back to server-console.txt when game_state has no version', function () {
    $data = [
        'time' => ['year' => 1993, 'month' => 7, 'day' => 9, 'hour' => 14, 'minute' => 30, 'day_of_year' => 190, 'is_night' => false, 'formatted' => '14:30', 'date' => '1993-07-09'],
        'season' => 'summer',
        'weather' => null,
        'exported_at' => gmdate('Y-m-d\TH:i:s\Z'),
    ];

    file_put_contents($this->gameStatePath, json_encode($data));
    file_put_contents($this->consoleLogPath, "LOG : General, 1711000000> versionNumber=42.15.3 demo=false\n");

    config()->set('zomboid.paths.data', $this->tempDir);

    $reader = new GameVersionReader(
        new GameStateReader($this->gameStatePath),
        Mockery::mock(DockerManager::class),
    );

    expect($reader->detectVersion())->toBe('42.15.3');
});

test('returns null when no version source is available', function () {
    $docker = Mockery::mock(DockerManager::class);
    $docker->shouldReceive('getContainerLogs')->andReturn([]);

    config()->set('zomboid.paths.data', $this->tempDir);

    $reader = new GameVersionReader(
        new GameStateReader($this->gameStatePath),
        $docker,
    );

    expect($reader->detectVersion())->toBeNull();
});

test('refreshVersion caches the detected version', function () {
    $data = [
        'time' => ['year' => 1993, 'month' => 7, 'day' => 9, 'hour' => 14, 'minute' => 30, 'day_of_year' => 190, 'is_night' => false, 'formatted' => '14:30', 'date' => '1993-07-09'],
        'season' => 'summer',
        'weather' => null,
        'game_version' => '42.15.3 somehash',
        'exported_at' => gmdate('Y-m-d\TH:i:s\Z'),
    ];

    file_put_contents($this->gameStatePath, json_encode($data));

    $reader = new GameVersionReader(
        new GameStateReader($this->gameStatePath),
        Mockery::mock(DockerManager::class),
    );

    $version = $reader->refreshVersion();

    expect($version)->toBe('42.15.3')
        ->and($reader->getCachedVersion())->toBe('42.15.3');
});

test('getCachedVersion returns null when cache is empty', function () {
    $reader = new GameVersionReader(
        new GameStateReader($this->gameStatePath),
        Mockery::mock(DockerManager::class),
    );

    expect($reader->getCachedVersion())->toBeNull();
});

test('console log fallback handles version= format', function () {
    file_put_contents($this->consoleLogPath, "version=42.15.3\nsome other log line\n");

    config()->set('zomboid.paths.data', $this->tempDir);

    $reader = new GameVersionReader(
        new GameStateReader($this->gameStatePath),
        Mockery::mock(DockerManager::class),
    );

    // game_state.json doesn't exist, so it falls through to console log
    expect($reader->detectVersion())->toBe('42.15.3');
});
