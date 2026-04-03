<?php

use App\Services\DockerManager;
use App\Services\GameStateReader;
use App\Services\GameVersionReader;

// ── Read current PZ version from game-version.conf ───────────────────────
// Update via: make update-version
$versionConf = parse_ini_file(__DIR__.'/../../../game-version.conf');
define('PZ_TEST_VERSION', $versionConf['PZ_VERSION']);
define('PZ_TEST_VERSION_MAJOR_MINOR', implode('.', array_slice(explode('.', $versionConf['PZ_VERSION']), 0, 2)));
define('PZ_TEST_FULL_VERSION', $versionConf['PZ_VERSION_FULL']);

beforeEach(function () {
    $this->tempDir = sys_get_temp_dir().'/game_version_test_'.uniqid();
    mkdir($this->tempDir, 0755, true);
    $this->gameStatePath = $this->tempDir.'/game_state.json';
    $this->consoleLogPath = $this->tempDir.'/server-console.txt';
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
        'game_version' => PZ_TEST_FULL_VERSION,
        'exported_at' => gmdate('Y-m-d\TH:i:s\Z'),
    ];

    file_put_contents($this->gameStatePath, json_encode($data));

    $reader = new GameVersionReader(
        new GameStateReader($this->gameStatePath),
        Mockery::mock(DockerManager::class),
    );

    expect($reader->detectVersion())->toBe(PZ_TEST_VERSION);
});

test('handles clean version string without hash', function () {
    $data = [
        'time' => ['year' => 1993, 'month' => 7, 'day' => 9, 'hour' => 14, 'minute' => 30, 'day_of_year' => 190, 'is_night' => false, 'formatted' => '14:30', 'date' => '1993-07-09'],
        'season' => 'summer',
        'weather' => null,
        'game_version' => PZ_TEST_VERSION,
        'exported_at' => gmdate('Y-m-d\TH:i:s\Z'),
    ];

    file_put_contents($this->gameStatePath, json_encode($data));

    $reader = new GameVersionReader(
        new GameStateReader($this->gameStatePath),
        Mockery::mock(DockerManager::class),
    );

    expect($reader->detectVersion())->toBe(PZ_TEST_VERSION);
});

test('handles two-part version string', function () {
    $data = [
        'time' => ['year' => 1993, 'month' => 7, 'day' => 9, 'hour' => 14, 'minute' => 30, 'day_of_year' => 190, 'is_night' => false, 'formatted' => '14:30', 'date' => '1993-07-09'],
        'season' => 'summer',
        'weather' => null,
        'game_version' => PZ_TEST_VERSION_MAJOR_MINOR,
        'exported_at' => gmdate('Y-m-d\TH:i:s\Z'),
    ];

    file_put_contents($this->gameStatePath, json_encode($data));

    $reader = new GameVersionReader(
        new GameStateReader($this->gameStatePath),
        Mockery::mock(DockerManager::class),
    );

    expect($reader->detectVersion())->toBe(PZ_TEST_VERSION_MAJOR_MINOR);
});

test('falls back to server-console.txt when game_state has no version', function () {
    $data = [
        'time' => ['year' => 1993, 'month' => 7, 'day' => 9, 'hour' => 14, 'minute' => 30, 'day_of_year' => 190, 'is_night' => false, 'formatted' => '14:30', 'date' => '1993-07-09'],
        'season' => 'summer',
        'weather' => null,
        'exported_at' => gmdate('Y-m-d\TH:i:s\Z'),
    ];

    file_put_contents($this->gameStatePath, json_encode($data));
    file_put_contents($this->consoleLogPath, "LOG : General, 1711000000> versionNumber=".PZ_TEST_VERSION." demo=false\n");

    config()->set('zomboid.paths.data', $this->tempDir);

    $reader = new GameVersionReader(
        new GameStateReader($this->gameStatePath),
        Mockery::mock(DockerManager::class),
    );

    expect($reader->detectVersion())->toBe(PZ_TEST_VERSION);
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
        'game_version' => PZ_TEST_VERSION.' somehash',
        'exported_at' => gmdate('Y-m-d\TH:i:s\Z'),
    ];

    file_put_contents($this->gameStatePath, json_encode($data));

    $reader = new GameVersionReader(
        new GameStateReader($this->gameStatePath),
        Mockery::mock(DockerManager::class),
    );

    $version = $reader->refreshVersion();

    expect($version)->toBe(PZ_TEST_VERSION)
        ->and($reader->getCachedVersion())->toBe(PZ_TEST_VERSION);
});

test('getCachedVersion returns null when cache is empty', function () {
    $reader = new GameVersionReader(
        new GameStateReader($this->gameStatePath),
        Mockery::mock(DockerManager::class),
    );

    expect($reader->getCachedVersion())->toBeNull();
});

test('console log fallback handles version= format', function () {
    file_put_contents($this->consoleLogPath, "version=".PZ_TEST_VERSION."\nsome other log line\n");

    config()->set('zomboid.paths.data', $this->tempDir);

    $reader = new GameVersionReader(
        new GameStateReader($this->gameStatePath),
        Mockery::mock(DockerManager::class),
    );

    // game_state.json doesn't exist, so it falls through to console log
    expect($reader->detectVersion())->toBe(PZ_TEST_VERSION);
});
