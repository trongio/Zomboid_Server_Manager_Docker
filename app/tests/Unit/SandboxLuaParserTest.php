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

it('writes numeric strings as unquoted numbers', function () {
    $this->parser->write($this->tempPath, [
        'Zombies' => '1',
        'Farming' => '2',
        'ZombieConfig.PopulationMultiplier' => '1.5',
    ]);

    $data = $this->parser->read($this->tempPath);

    expect($data['Zombies'])->toBe(1)->toBeInt()
        ->and($data['Farming'])->toBe(2)->toBeInt()
        ->and($data['ZombieConfig']['PopulationMultiplier'])->toBe(1.5)->toBeFloat();

    // Verify raw file has no quotes around numbers
    $raw = file_get_contents($this->tempPath);
    expect($raw)->toContain('Zombies = 1,')
        ->and($raw)->toContain('Farming = 2,')
        ->and($raw)->not->toContain('Farming = "2"');
});

it('writes boolean strings as unquoted booleans', function () {
    // Use reflection to test formatValue directly
    $method = new ReflectionMethod(SandboxLuaParser::class, 'formatValue');

    expect($method->invoke($this->parser, 'true'))->toBe('true')
        ->and($method->invoke($this->parser, 'false'))->toBe('false');
});

it('throws when sandbox file not found for write', function () {
    $this->parser->write('/nonexistent/path/sandbox.lua', ['Zombies' => 1]);
})->throws(RuntimeException::class, 'Sandbox file not found');

// ── Security: Quote Escaping Defense-in-Depth ───────────────────────

it('escapes double quotes in string values', function () {
    $method = new ReflectionMethod(SandboxLuaParser::class, 'formatValue');

    $result = $method->invoke($this->parser, 'test"injection');

    // Should produce escaped quote, not unescaped
    expect($result)->toBe('"test\\"injection"')
        ->and($result)->not->toBe('"test"injection"');
});

it('escapes backslashes in string values', function () {
    $method = new ReflectionMethod(SandboxLuaParser::class, 'formatValue');

    $result = $method->invoke($this->parser, 'test\\value');

    expect($result)->toBe('"test\\\\value"');
});

// ── parseContent() ────────────────────────────────────────────────

it('parses content string same as file', function () {
    $content = file_get_contents($this->fixturePath);
    $fromFile = $this->parser->read($this->fixturePath);
    $fromContent = $this->parser->parseContent($content);

    expect($fromContent)->toBe($fromFile);
});

it('returns empty array for empty content via parseContent', function () {
    expect($this->parser->parseContent(''))->toBe([]);
});

it('parses minimal sandbox content', function () {
    $content = "SandboxVars = {\n    Zombies = 4,\n    DayLength = 2,\n}\n";
    $data = $this->parser->parseContent($content);

    expect($data)
        ->toHaveKey('Zombies', 4)
        ->toHaveKey('DayLength', 2);
});

it('parses nested tables in content', function () {
    $content = "SandboxVars = {\n    ZombieLore = {\n        Speed = 3,\n    },\n}\n";
    $data = $this->parser->parseContent($content);

    expect($data)->toHaveKey('ZombieLore')
        ->and($data['ZombieLore'])->toHaveKey('Speed', 3);
});
