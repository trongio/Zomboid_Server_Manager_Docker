<?php

use App\Services\ServerIniParser;

beforeEach(function () {
    $this->parser = new ServerIniParser;
    $this->fixturePath = dirname(__DIR__).'/fixtures/server.ini';
    $this->tempPath = tempnam(sys_get_temp_dir(), 'pz_ini_');
    copy($this->fixturePath, $this->tempPath);
});

afterEach(function () {
    if (file_exists($this->tempPath)) {
        unlink($this->tempPath);
    }
});

it('reads server.ini into associative array', function () {
    $data = $this->parser->read($this->fixturePath);

    expect($data)
        ->toHaveKey('DefaultPort', '16261')
        ->toHaveKey('MaxPlayers', '16')
        ->toHaveKey('Map', 'Muldraugh, KY')
        ->toHaveKey('RCONPassword', 'changeme')
        ->toHaveKey('Password', '');
});

it('handles semicolon-separated lists', function () {
    $data = $this->parser->read($this->fixturePath);

    expect($data['Mods'])->toBe('SuperSurvivors;Hydrocraft')
        ->and($data['WorkshopItems'])->toBe('2561774086;2286126274');
});

it('returns empty array for missing file', function () {
    expect($this->parser->read('/nonexistent/path.ini'))->toBe([]);
});

it('round-trips without data loss', function () {
    $original = file_get_contents($this->tempPath);
    $data = $this->parser->read($this->tempPath);

    // Write back with no changes
    $this->parser->write($this->tempPath, []);

    $afterWrite = file_get_contents($this->tempPath);

    expect($afterWrite)->toBe($original);
});

it('updates existing keys preserving order', function () {
    $this->parser->write($this->tempPath, [
        'MaxPlayers' => '32',
        'Public' => 'false',
    ]);

    $data = $this->parser->read($this->tempPath);

    expect($data['MaxPlayers'])->toBe('32')
        ->and($data['Public'])->toBe('false')
        ->and($data['DefaultPort'])->toBe('16261');

    // Verify ordering is preserved
    $lines = file($this->tempPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    $keys = [];
    foreach ($lines as $line) {
        if (str_contains($line, '=')) {
            [$key] = explode('=', $line, 2);
            $keys[] = trim($key);
        }
    }

    expect(array_search('MaxPlayers', $keys))->toBeLessThan(array_search('Public', $keys));
});

it('appends new keys', function () {
    $this->parser->write($this->tempPath, [
        'NewSetting' => 'value123',
    ]);

    $data = $this->parser->read($this->tempPath);

    expect($data)->toHaveKey('NewSetting', 'value123');
});

it('handles empty values', function () {
    $data = $this->parser->read($this->fixturePath);

    expect($data['Password'])->toBe('');
});

it('throws when config file not found for write', function () {
    $this->parser->write('/nonexistent/path/server.ini', ['MaxPlayers' => '32']);
})->throws(RuntimeException::class, 'Config file not found');

// ── Security: Newline Injection Defense-in-Depth ────────────────────

it('strips newlines from values on write', function () {
    $this->parser->write($this->tempPath, [
        'MaxPlayers' => "32\nRCONPassword=hacked",
    ]);

    $data = $this->parser->read($this->tempPath);

    expect($data['MaxPlayers'])->toBe('32RCONPassword=hacked')
        ->and($data['RCONPassword'])->toBe('changeme');
});

it('strips carriage returns from values on write', function () {
    $this->parser->write($this->tempPath, [
        'MaxPlayers' => "32\r\nRCONPassword=hacked",
    ]);

    $data = $this->parser->read($this->tempPath);

    expect($data['MaxPlayers'])->toBe('32RCONPassword=hacked')
        ->and($data['RCONPassword'])->toBe('changeme');
});

it('strips newlines from appended keys', function () {
    $this->parser->write($this->tempPath, [
        "NewKey\nRCONPassword" => 'hacked',
    ]);

    $data = $this->parser->read($this->tempPath);

    expect($data)->toHaveKey('NewKeyRCONPassword')
        ->and($data['RCONPassword'])->toBe('changeme');
});
