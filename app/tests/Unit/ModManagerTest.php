<?php

use App\Services\ModManager;
use App\Services\ServerIniParser;

beforeEach(function () {
    $this->parser = new ServerIniParser;
    $this->manager = new ModManager($this->parser);
    $this->tempDir = sys_get_temp_dir().'/pz_test_'.uniqid();
    mkdir($this->tempDir.'/Server', 0777, true);
    $this->iniPath = $this->tempDir.'/Server/ZomboidServer.ini';
    copy(dirname(__DIR__).'/fixtures/server.ini', $this->iniPath);
});

afterEach(function () {
    if (file_exists($this->iniPath)) {
        unlink($this->iniPath);
    }
    foreach (['.mod_state', '.mod_state_applied'] as $sidecar) {
        $path = $this->tempDir.'/Server/'.$sidecar;
        if (file_exists($path)) {
            unlink($path);
        }
    }
    if (is_dir($this->tempDir.'/Server')) {
        rmdir($this->tempDir.'/Server');
    }
    if (is_dir($this->tempDir)) {
        rmdir($this->tempDir);
    }
});

it('lists mods from ini file', function () {
    $mods = $this->manager->list($this->iniPath);

    expect($mods)->toHaveCount(2)
        ->and($mods[0]['workshop_id'])->toBe('2561774086')
        ->and($mods[0]['mod_id'])->toBe('SuperSurvivors')
        ->and($mods[1]['workshop_id'])->toBe('2286126274')
        ->and($mods[1]['mod_id'])->toBe('Hydrocraft');
});

it('adds a mod to both lists', function () {
    $this->manager->add($this->iniPath, '1111111111', 'TestMod');

    $mods = $this->manager->list($this->iniPath);

    // Existing fixture (2) + user-added (1) + auto-attached ZomboidManager (1) = 4
    expect($mods)->toHaveCount(4)
        ->and($mods[2]['workshop_id'])->toBe('1111111111')
        ->and($mods[2]['mod_id'])->toBe('TestMod')
        ->and($mods[3]['mod_id'])->toBe('ZomboidManager');
});

it('prevents duplicate workshop ids', function () {
    $this->manager->add($this->iniPath, '2561774086', 'SuperSurvivors');

    expect($this->manager->list($this->iniPath))->toHaveCount(2);
});

it('removes a mod from both lists', function () {
    $removed = $this->manager->remove($this->iniPath, '2561774086');

    expect($removed)->toBe(['workshop_id' => '2561774086', 'mod_id' => 'SuperSurvivors']);

    $mods = $this->manager->list($this->iniPath);
    // Hydrocraft survives + auto-attached ZomboidManager
    expect($mods)->toHaveCount(2)
        ->and($mods[0]['workshop_id'])->toBe('2286126274')
        ->and($mods[1]['mod_id'])->toBe('ZomboidManager');
});

it('returns null when removing nonexistent mod', function () {
    expect($this->manager->remove($this->iniPath, '0000000000'))->toBeNull();
});

it('reorders mods', function () {
    $this->manager->reorder($this->iniPath, [
        ['workshop_id' => '2286126274', 'mod_id' => 'Hydrocraft'],
        ['workshop_id' => '2561774086', 'mod_id' => 'SuperSurvivors'],
    ]);

    $mods = $this->manager->list($this->iniPath);
    expect($mods[0]['workshop_id'])->toBe('2286126274')
        ->and($mods[1]['workshop_id'])->toBe('2561774086');
});

it('handles empty mod list', function () {
    // Clear mods
    $this->parser->write($this->iniPath, ['Mods' => '', 'WorkshopItems' => '']);

    $mods = $this->manager->list($this->iniPath);

    expect($mods)->toBe([]);
});

it('adds map folder when adding map mod', function () {
    $this->manager->add($this->iniPath, '9999999999', 'MapMod', 'CustomMap');

    $config = $this->parser->read($this->iniPath);

    expect($config['Map'])->toContain('CustomMap');
});

it('removes map folder when removing map mod', function () {
    // First add a map mod
    $this->manager->add($this->iniPath, '9999999999', 'MapMod', 'CustomMap');

    // Then remove it with map folder
    $this->manager->remove($this->iniPath, '9999999999', 'CustomMap');

    $config = $this->parser->read($this->iniPath);

    expect($config['Map'])->not->toContain('CustomMap');
});

it('writes mod state file when adding a mod', function () {
    $this->manager->add($this->iniPath, '1111111111', 'TestMod');

    $stateFile = $this->tempDir.'/Server/.mod_state';

    expect(file_exists($stateFile))->toBeTrue();

    $content = file_get_contents($stateFile);
    expect($content)->toContain('Mods=SuperSurvivors;Hydrocraft;TestMod;ZomboidManager')
        ->and($content)->toContain('WorkshopItems=2561774086;2286126274;1111111111;3685323705');
});

it('writes mod state file when removing a mod', function () {
    $this->manager->remove($this->iniPath, '2561774086');

    $stateFile = $this->tempDir.'/Server/.mod_state';

    expect(file_exists($stateFile))->toBeTrue();

    $content = file_get_contents($stateFile);
    expect($content)->toContain('Mods=Hydrocraft;ZomboidManager')
        ->and($content)->toContain('WorkshopItems=2286126274;3685323705');
});

it('writes mod state file when reordering mods', function () {
    $this->manager->reorder($this->iniPath, [
        ['workshop_id' => '2286126274', 'mod_id' => 'Hydrocraft'],
        ['workshop_id' => '2561774086', 'mod_id' => 'SuperSurvivors'],
    ]);

    $stateFile = $this->tempDir.'/Server/.mod_state';

    expect(file_exists($stateFile))->toBeTrue();

    $content = file_get_contents($stateFile);
    expect($content)->toContain('Mods=Hydrocraft;SuperSurvivors;ZomboidManager')
        ->and($content)->toContain('WorkshopItems=2286126274;2561774086;3685323705');
});

it('does not write mod state file when adding duplicate mod', function () {
    $stateFile = $this->tempDir.'/Server/.mod_state';
    if (file_exists($stateFile)) {
        unlink($stateFile);
    }

    $this->manager->add($this->iniPath, '2561774086', 'SuperSurvivors');

    expect(file_exists($stateFile))->toBeFalse();
});

it('does not write mod state file when removing nonexistent mod', function () {
    $stateFile = $this->tempDir.'/Server/.mod_state';
    if (file_exists($stateFile)) {
        unlink($stateFile);
    }

    $this->manager->remove($this->iniPath, '0000000000');

    expect(file_exists($stateFile))->toBeFalse();
});

it('flags protected workshop ids', function () {
    expect(ModManager::isProtected('3685323705'))->toBeTrue()
        ->and(ModManager::isProtected('1111111111'))->toBeFalse();
});

it('allows reorder that keeps required mod', function () {
    $this->manager->add($this->iniPath, '3685323705', 'ZomboidManager');

    $this->manager->reorder($this->iniPath, [
        ['workshop_id' => '3685323705', 'mod_id' => 'ZomboidManager'],
        ['workshop_id' => '2561774086', 'mod_id' => 'SuperSurvivors'],
        ['workshop_id' => '2286126274', 'mod_id' => 'Hydrocraft'],
    ]);

    $mods = $this->manager->list($this->iniPath);
    expect($mods[0]['workshop_id'])->toBe('3685323705');
});

it('throws RuntimeException when state file directory is not writable', function () {
    chmod($this->tempDir.'/Server', 0555);

    try {
        expect(fn () => $this->manager->add($this->iniPath, '1111111111', 'TestMod'))
            ->toThrow(RuntimeException::class);
    } finally {
        chmod($this->tempDir.'/Server', 0777);
    }
})->skip(getmyuid() === 0, 'chmod restrictions are bypassed by root');

it('lists mods from .mod_state when state file exists, ignoring INI', function () {
    file_put_contents(
        $this->tempDir.'/Server/.mod_state',
        "Mods=StateMod\nWorkshopItems=9999999999\n"
    );

    $mods = $this->manager->list($this->iniPath);

    expect($mods)->toHaveCount(1)
        ->and($mods[0]['mod_id'])->toBe('StateMod')
        ->and($mods[0]['workshop_id'])->toBe('9999999999');
});

it('returns empty list when .mod_state has empty mod values', function () {
    file_put_contents(
        $this->tempDir.'/Server/.mod_state',
        "Mods=\nWorkshopItems=\n"
    );

    expect($this->manager->list($this->iniPath))->toBe([]);
});

it('falls back to INI when .mod_state is malformed', function () {
    file_put_contents(
        $this->tempDir.'/Server/.mod_state',
        'garbage content with no recognizable lines'
    );

    $mods = $this->manager->list($this->iniPath);

    expect($mods)->toHaveCount(2)
        ->and($mods[0]['mod_id'])->toBe('SuperSurvivors');
});

it('falls back to INI when .mod_state is missing WorkshopItems line', function () {
    file_put_contents(
        $this->tempDir.'/Server/.mod_state',
        "Mods=StateMod\n"
    );

    $mods = $this->manager->list($this->iniPath);

    expect($mods)->toHaveCount(2)
        ->and($mods[0]['mod_id'])->toBe('SuperSurvivors');
});

it('returns state-file mods even when INI was clobbered to empty', function () {
    $this->manager->add($this->iniPath, '1111111111', 'TestMod');
    $this->parser->write($this->iniPath, ['Mods' => '', 'WorkshopItems' => '']);

    $mods = $this->manager->list($this->iniPath);

    // 2 fixture + 1 added + auto ZomboidManager
    expect($mods)->toHaveCount(4)
        ->and(collect($mods)->pluck('mod_id')->all())->toContain('TestMod')
        ->and(collect($mods)->pluck('mod_id')->all())->toContain('ZomboidManager');
});

it('preserves mods from .mod_state when the INI was pruned by PZ on shutdown', function () {
    // Simulate PZ rewriting the INI with empty Mods= after a shutdown, while
    // .mod_state (web-UI source of truth) still reflects the user's choices.
    file_put_contents(
        $this->tempDir.'/Server/.mod_state',
        "Mods=Hydrocraft;ZomboidManager\nWorkshopItems=2286126274;3685323705\n"
    );
    $this->parser->write($this->iniPath, ['Mods' => '', 'WorkshopItems' => '']);

    $this->manager->add($this->iniPath, '4242424242', 'NewMod');

    $stateContent = file_get_contents($this->tempDir.'/Server/.mod_state');
    expect($stateContent)
        ->toContain('Mods=Hydrocraft;ZomboidManager;NewMod')
        ->and($stateContent)->toContain('WorkshopItems=2286126274;3685323705;4242424242');
});

it('re-attaches the protected ZomboidManager mod when add() runs without it', function () {
    $this->parser->write($this->iniPath, ['Mods' => '', 'WorkshopItems' => '']);

    $this->manager->add($this->iniPath, '4242424242', 'SoloMod');

    $stateContent = file_get_contents($this->tempDir.'/Server/.mod_state');
    expect($stateContent)
        ->toContain('Mods=SoloMod;ZomboidManager')
        ->and($stateContent)->toContain('WorkshopItems=4242424242;3685323705');
});

it('does not duplicate ZomboidManager when reorder already contains it', function () {
    // Regression: PHP coerces numeric-string array keys (PROTECTED_MODS) to int,
    // and a naive in_array(..., $workshopIds, true) treats int 3685323705 and
    // "3685323705" as different — appending a duplicate every reorder call.
    $this->manager->reorder($this->iniPath, [
        ['workshop_id' => '3685323705', 'mod_id' => 'ZomboidManager'],
        ['workshop_id' => '2561774086', 'mod_id' => 'SuperSurvivors'],
        ['workshop_id' => '2286126274', 'mod_id' => 'Hydrocraft'],
    ]);

    $stateContent = file_get_contents($this->tempDir.'/Server/.mod_state');
    expect(substr_count($stateContent, 'ZomboidManager'))->toBe(1)
        ->and(substr_count($stateContent, '3685323705'))->toBe(1);
});

it('rolls back the INI when state file write fails', function () {
    $iniBefore = file_get_contents($this->iniPath);
    chmod($this->tempDir.'/Server', 0555);

    try {
        try {
            $this->manager->add($this->iniPath, '1111111111', 'TestMod');
        } catch (RuntimeException) {
            // expected
        }
    } finally {
        chmod($this->tempDir.'/Server', 0777);
    }

    expect(file_get_contents($this->iniPath))->toBe($iniBefore);
})->skip(getmyuid() === 0, 'chmod restrictions are bypassed by root');

it('marks all mods stopped when server is not running', function () {
    $result = $this->manager->listWithStatus($this->iniPath, serverRunning: false);

    expect($result['server_running'])->toBeFalse()
        ->and($result['pending_restart'])->toBeFalse()
        ->and(collect($result['mods'])->pluck('status')->all())
        ->each->toBe('stopped');
});

it('marks mods active when state matches applied snapshot', function () {
    $this->manager->add($this->iniPath, '1111111111', 'TestMod');

    // Include the auto-attached ZomboidManager in the applied snapshot so the
    // user intent matches what the server last loaded.
    file_put_contents(
        $this->tempDir.'/Server/.mod_state_applied',
        "Mods=SuperSurvivors;Hydrocraft;TestMod;ZomboidManager\nWorkshopItems=2561774086;2286126274;1111111111;3685323705\n"
    );

    $result = $this->manager->listWithStatus($this->iniPath, serverRunning: true);

    expect($result['pending_restart'])->toBeFalse()
        ->and(collect($result['mods'])->pluck('status')->all())
        ->each->toBe('active');
});

it('marks newly added mod as pending_restart when applied snapshot is older', function () {
    file_put_contents(
        $this->tempDir.'/Server/.mod_state_applied',
        "Mods=SuperSurvivors;Hydrocraft\nWorkshopItems=2561774086;2286126274\n"
    );

    $this->manager->add($this->iniPath, '1111111111', 'NewMod');

    $result = $this->manager->listWithStatus($this->iniPath, serverRunning: true);

    expect($result['pending_restart'])->toBeTrue();

    $byId = collect($result['mods'])->keyBy('workshop_id');
    expect($byId['2561774086']['status'])->toBe('active')
        ->and($byId['2286126274']['status'])->toBe('active')
        ->and($byId['1111111111']['status'])->toBe('pending_restart');
});

it('flags pending_restart when a mod was removed since last server start', function () {
    file_put_contents(
        $this->tempDir.'/Server/.mod_state_applied',
        "Mods=SuperSurvivors;Hydrocraft\nWorkshopItems=2561774086;2286126274\n"
    );

    $this->manager->remove($this->iniPath, '2286126274');

    $result = $this->manager->listWithStatus($this->iniPath, serverRunning: true);

    // After remove() the auto-attached ZomboidManager (3685323705) is in user intent
    // but not in .mod_state_applied — so it's correctly flagged pending_restart.
    expect($result['pending_restart'])->toBeTrue();

    $byId = collect($result['mods'])->keyBy('workshop_id');
    expect($byId['2561774086']['status'])->toBe('active')
        ->and($byId['3685323705']['status'])->toBe('pending_restart');
});

it('falls back to active when applied snapshot is missing on running server', function () {
    $result = $this->manager->listWithStatus($this->iniPath, serverRunning: true);

    expect($result['pending_restart'])->toBeFalse()
        ->and($result['applied_snapshot_present'])->toBeFalse()
        ->and(collect($result['mods'])->pluck('status')->all())
        ->each->toBe('active');
});
