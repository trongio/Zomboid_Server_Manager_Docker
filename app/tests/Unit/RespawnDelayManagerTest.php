<?php

use App\Services\RespawnDelayManager;

beforeEach(function () {
    $this->fixtureDir = dirname(__DIR__).'/fixtures/lua-bridge';
    $this->tempDir = sys_get_temp_dir().'/pz_respawn_test_'.getmypid();
    mkdir($this->tempDir, 0755, true);

    $this->configPath = $this->tempDir.'/respawn_config.json';
    $this->deathsPath = $this->tempDir.'/respawn_deaths.json';
    $this->resetsPath = $this->tempDir.'/respawn_resets.json';

    $this->manager = new RespawnDelayManager($this->configPath, $this->deathsPath, $this->resetsPath);
});

afterEach(function () {
    $files = glob($this->tempDir.'/*') ?: [];
    array_map(fn ($f) => is_file($f) && unlink($f), $files);
    if (is_dir($this->tempDir)) {
        rmdir($this->tempDir);
    }
});

it('returns default config when file is missing', function () {
    $config = $this->manager->getConfig();

    expect($config['enabled'])->toBeFalse()
        ->and($config['delay_minutes'])->toBe(60);
});

it('writes and reads config atomically', function () {
    $this->manager->updateConfig(true, 45);

    $config = $this->manager->getConfig();

    expect($config['enabled'])->toBeTrue()
        ->and($config['delay_minutes'])->toBe(45);
});

it('calculates active cooldowns correctly', function () {
    $this->manager->updateConfig(true, 60);

    // Write deaths: one recent (active), one old (expired)
    $now = time();
    $deaths = [
        'deaths' => [
            'ActivePlayer' => $now - 300, // 5 min ago — still active (60 min delay)
            'ExpiredPlayer' => $now - 7200, // 2 hours ago — expired
        ],
    ];
    file_put_contents($this->deathsPath, json_encode($deaths));

    $cooldowns = $this->manager->getActiveCooldowns();

    expect($cooldowns)->toHaveKey('ActivePlayer')
        ->and($cooldowns)->not->toHaveKey('ExpiredPlayer')
        ->and($cooldowns['ActivePlayer']['remaining_minutes'])->toBeGreaterThan(0);
});

it('returns empty cooldowns when disabled', function () {
    $this->manager->updateConfig(false, 60);

    $now = time();
    $deaths = [
        'deaths' => [
            'ActivePlayer' => $now - 300,
        ],
    ];
    file_put_contents($this->deathsPath, json_encode($deaths));

    $cooldowns = $this->manager->getActiveCooldowns();

    expect($cooldowns)->toBe([]);
});

it('resets player by writing to resets file', function () {
    $this->manager->resetPlayer('TestPlayer');

    $content = json_decode(file_get_contents($this->resetsPath), true);

    expect($content['resets'])->toContain('TestPlayer');
});

it('does not duplicate player in resets file', function () {
    $this->manager->resetPlayer('TestPlayer');
    $this->manager->resetPlayer('TestPlayer');

    $content = json_decode(file_get_contents($this->resetsPath), true);

    expect($content['resets'])->toHaveCount(1);
});

it('appends multiple resets', function () {
    $this->manager->resetPlayer('Player1');
    $this->manager->resetPlayer('Player2');

    $content = json_decode(file_get_contents($this->resetsPath), true);

    expect($content['resets'])->toHaveCount(2)
        ->and($content['resets'])->toContain('Player1')
        ->and($content['resets'])->toContain('Player2');
});

it('reads config from fixture file', function () {
    copy($this->fixtureDir.'/respawn_config.json', $this->configPath);

    $config = $this->manager->getConfig();

    expect($config['enabled'])->toBeTrue()
        ->and($config['delay_minutes'])->toBe(30);
});
