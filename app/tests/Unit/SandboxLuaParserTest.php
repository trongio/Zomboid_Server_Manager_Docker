<?php

use App\Services\SandboxLuaParser;

beforeEach(function () {
    $this->parser = new SandboxLuaParser;
    $this->fixturePath = dirname(__DIR__).'/fixtures/sandbox.lua';
    $this->tempPath = tempnam(sys_get_temp_dir(), 'pz_lua_');
    copy($this->fixturePath, $this->tempPath);
});

afterEach(function () {
    if (file_exists($this->tempPath)) {
        unlink($this->tempPath);
    }
});

it('reads sandbox lua into nested array', function () {
    $data = $this->parser->read($this->fixturePath);

    expect($data)
        ->toHaveKey('Zombies', 4)
        ->toHaveKey('StartYear', 1993)
        ->toHaveKey('XpMultiplier', 1.0)
        ->toHaveKey('ZombieLore')
        ->toHaveKey('ZombieConfig');
});

it('parses nested ZombieLore table', function () {
    $data = $this->parser->read($this->fixturePath);

    expect($data['ZombieLore'])
        ->toBeArray()
        ->toHaveKey('Speed', 2)
        ->toHaveKey('Strength', 2)
        ->toHaveKey('Transmission', 1)
        ->toHaveKey('Mortality', 5);
});

it('parses nested ZombieConfig table', function () {
    $data = $this->parser->read($this->fixturePath);

    expect($data['ZombieConfig'])
        ->toBeArray()
        ->toHaveKey('PopulationMultiplier', 1.0)
        ->toHaveKey('PopulationPeakDay', 28)
        ->toHaveKey('RespawnHours', 72.0);
});

it('parses numeric types correctly', function () {
    $data = $this->parser->read($this->fixturePath);

    expect($data['Zombies'])->toBeInt()
        ->and($data['XpMultiplier'])->toBeFloat()
        ->and($data['ZombieConfig']['RespawnMultiplier'])->toBeFloat();
});

it('returns empty array for missing file', function () {
    expect($this->parser->read('/nonexistent/path.lua'))->toBe([]);
});

it('round-trips without data loss', function () {
    $before = $this->parser->read($this->tempPath);

    // Write back with no changes
    $this->parser->write($this->tempPath, []);

    $after = $this->parser->read($this->tempPath);

    expect($after)->toBe($before);
});

it('updates top-level values', function () {
    $this->parser->write($this->tempPath, [
        'Zombies' => 1,
        'DayLength' => 4,
    ]);

    $data = $this->parser->read($this->tempPath);

    expect($data['Zombies'])->toBe(1)
        ->and($data['DayLength'])->toBe(4)
        ->and($data['StartYear'])->toBe(1993); // unchanged
});

it('updates nested values via dot notation', function () {
    $this->parser->write($this->tempPath, [
        'ZombieLore.Speed' => 3,
        'ZombieLore.Mortality' => 1,
    ]);

    $data = $this->parser->read($this->tempPath);

    expect($data['ZombieLore']['Speed'])->toBe(3)
        ->and($data['ZombieLore']['Mortality'])->toBe(1)
        ->and($data['ZombieLore']['Strength'])->toBe(2); // unchanged
});

it('updates float values correctly', function () {
    $this->parser->write($this->tempPath, [
        'ZombieConfig.PopulationMultiplier' => 2.5,
    ]);

    $data = $this->parser->read($this->tempPath);

    expect($data['ZombieConfig']['PopulationMultiplier'])->toBe(2.5);
});
