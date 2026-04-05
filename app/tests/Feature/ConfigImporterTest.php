<?php

use App\Services\ConfigImporter;
use App\Services\SandboxLuaParser;
use App\Services\ServerIniParser;

beforeEach(function () {
    $this->iniParser = new ServerIniParser;
    $this->luaParser = new SandboxLuaParser;

    $this->iniFixture = dirname(__DIR__).'/fixtures/server.ini';
    $this->luaFixture = dirname(__DIR__).'/fixtures/sandbox.lua';

    config()->set('zomboid.paths.server_ini', $this->iniFixture);
    config()->set('zomboid.paths.sandbox_lua', $this->luaFixture);

    $this->importer = new ConfigImporter($this->iniParser, $this->luaParser);
});

it('detects changed server settings in preview', function () {
    $content = file_get_contents($this->iniFixture);
    // Change MaxPlayers from 16 to 32
    $content = str_replace('MaxPlayers=16', 'MaxPlayers=32', $content);

    $result = $this->importer->preview('server', $content);

    expect($result['changed'])->toHaveKey('MaxPlayers')
        ->and($result['changed']['MaxPlayers']['current'])->toBe('16')
        ->and($result['changed']['MaxPlayers']['new'])->toBe('32');
});

it('detects added server settings in preview', function () {
    $content = file_get_contents($this->iniFixture);
    $content .= "NewSetting=hello\n";

    $result = $this->importer->preview('server', $content);

    expect($result['added'])->toHaveKey('NewSetting', 'hello');
});

it('skips RCON and mod keys for server import', function () {
    $content = file_get_contents($this->iniFixture);

    $result = $this->importer->preview('server', $content);

    expect($result['skipped'])
        ->toHaveKey('RCONPort')
        ->toHaveKey('RCONPassword')
        ->toHaveKey('Mods')
        ->toHaveKey('WorkshopItems');

    foreach ($result['skipped'] as $entry) {
        expect($entry)->toHaveKey('reason');
    }
});

it('counts unchanged settings', function () {
    $content = file_get_contents($this->iniFixture);

    $result = $this->importer->preview('server', $content);

    // Skipped keys don't count as unchanged
    expect($result['unchanged'])->toBeGreaterThan(0);
});

it('returns empty diff for identical config', function () {
    $content = file_get_contents($this->iniFixture);

    $result = $this->importer->preview('server', $content);

    expect($result['changed'])->toBeEmpty()
        ->and($result['added'])->toBeEmpty();
});

it('previews sandbox config with dot-notation keys', function () {
    $content = "SandboxVars = {\n    Zombies = 1,\n    ZombieLore = {\n        Speed = 3,\n    },\n}\n";

    $result = $this->importer->preview('sandbox', $content);

    // Zombies changed from 4 to 1
    expect($result['changed'])->toHaveKey('Zombies')
        ->and($result['changed']['Zombies']['new'])->toBe('1');

    // ZombieLore.Speed changed from 2 to 3
    expect($result['changed'])->toHaveKey('ZombieLore.Speed')
        ->and($result['changed']['ZombieLore.Speed']['new'])->toBe('3');
});

it('does not skip any keys for sandbox import', function () {
    $content = file_get_contents($this->luaFixture);

    $result = $this->importer->preview('sandbox', $content);

    expect($result['skipped'])->toBeEmpty();
});
