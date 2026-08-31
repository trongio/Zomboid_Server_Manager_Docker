<?php

use App\Services\ConfigStateManager;
use App\Services\ModManager;
use App\Services\ServerIniParser;

beforeEach(function () {
    $this->parser = new ServerIniParser;
    $this->manager = new ModManager($this->parser, new ConfigStateManager);
    $this->tempDir = sys_get_temp_dir().'/pz_test_'.uniqid();
    mkdir($this->tempDir.'/Server', 0777, true);
    $this->iniPath = $this->tempDir.'/Server/ZomboidServer.ini';
    $this->configStatePath = $this->tempDir.'/Server/.config_state';
    copy(dirname(__DIR__).'/fixtures/server.ini', $this->iniPath);
});

afterEach(function () {
    if (file_exists($this->iniPath)) {
        unlink($this->iniPath);
    }
    foreach (['.mod_state', '.mod_state_applied', '.mod_links.json', '.config_state', '.config_state.lock'] as $sidecar) {
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

/**
 * Seed the Workshop-item-to-mod-IDs map the manager reads for pairing.
 *
 * @param  array<string, list<string>>  $links
 */
function writeLinks(string $tempDir, array $links): void
{
    file_put_contents($tempDir.'/Server/.mod_links.json', json_encode($links));
}

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

it('persists Map to .config_state when adding a map mod', function () {
    $this->manager->add($this->iniPath, '9999999999', 'MapMod', 'CustomMap');

    expect(file_exists($this->configStatePath))->toBeTrue();
    expect(file_get_contents($this->configStatePath))->toContain('Map=')
        ->and(file_get_contents($this->configStatePath))->toContain('CustomMap');
});

it('persists Map to .config_state when removing a map mod', function () {
    $this->manager->add($this->iniPath, '9999999999', 'MapMod', 'CustomMap');
    $this->manager->remove($this->iniPath, '9999999999', 'CustomMap');

    expect(file_get_contents($this->configStatePath))->not->toContain('CustomMap');
});

it('does not touch .config_state when adding a mod without a map folder', function () {
    $this->manager->add($this->iniPath, '1111111111', 'TestMod');

    expect(file_exists($this->configStatePath))->toBeFalse();
});

it('bulk imports independent Mods and WorkshopItems lists, merging into existing', function () {
    // A real pack has more mods than workshop items (one item can provide many mods).
    $summary = $this->manager->bulkImport(
        $this->iniPath,
        ['1111111111', '2222222222'],
        ['ModA', 'ModB', 'ModC'],
    );

    expect($summary['workshop_added'])->toBe(2)
        ->and($summary['mods_added'])->toBe(3);

    $config = $this->parser->read($this->iniPath);
    expect($config['Mods'])->toBe('SuperSurvivors;Hydrocraft;ModA;ModB;ModC;ZomboidManager')
        ->and($config['WorkshopItems'])->toBe('2561774086;2286126274;1111111111;2222222222;3685323705');
});

it('bulk import merges each list independently and skips duplicates', function () {
    $summary = $this->manager->bulkImport(
        $this->iniPath,
        ['2561774086', '3333333333'],   // first already present
        ['SuperSurvivors', 'FreshMod'],  // first already present
    );

    expect($summary['workshop_added'])->toBe(1)
        ->and($summary['mods_added'])->toBe(1);

    $config = $this->parser->read($this->iniPath);
    expect(substr_count($config['WorkshopItems'], '2561774086'))->toBe(1)
        ->and(substr_count($config['Mods'], 'SuperSurvivors'))->toBe(1);
});

it('bulk import accepts mod IDs with spaces, brackets, ampersands and slashes', function () {
    // Regression: real B42 packs use mod IDs like these.
    $this->manager->bulkImport(
        $this->iniPath,
        [],
        ['[B42] Tatrapan', 'FWOBenchPress&Treadmill', '1299328280/ToadTraits'],
    );

    $mods = $this->parser->read($this->iniPath)['Mods'];
    expect($mods)->toContain('[B42] Tatrapan')
        ->and($mods)->toContain('FWOBenchPress&Treadmill')
        ->and($mods)->toContain('1299328280/ToadTraits');
});

it('bulk import writes .mod_state and re-attaches ZomboidManager', function () {
    $this->manager->bulkImport($this->iniPath, ['1111111111'], ['ModA']);

    $state = file_get_contents($this->tempDir.'/Server/.mod_state');
    expect($state)->toContain('Mods=SuperSurvivors;Hydrocraft;ModA;ZomboidManager')
        ->and($state)->toContain('WorkshopItems=2561774086;2286126274;1111111111;3685323705');
});

it('bulk import prepends new map folders before the vanilla map and persists them', function () {
    $summary = $this->manager->bulkImport(
        $this->iniPath,
        ['1111111111'],
        ['ModA'],
        ['BigMap', 'Muldraugh, KY'],
    );

    expect($summary['maps_added'])->toBe(1);

    // Mod maps must sit ahead of the vanilla base map in Map=.
    expect($this->parser->read($this->iniPath)['Map'])->toBe('BigMap;Muldraugh, KY');
    expect(file_get_contents($this->configStatePath))->toContain('Map=BigMap;Muldraugh, KY');
});

it('bulk import with only already-present mods and no maps writes nothing new', function () {
    unlink($this->tempDir.'/Server/.mod_state');

    $summary = $this->manager->bulkImport(
        $this->iniPath,
        ['2561774086'],
        ['SuperSurvivors', 'Hydrocraft'],
    );

    expect($summary['workshop_added'])->toBe(0)
        ->and($summary['mods_added'])->toBe(0)
        ->and(file_exists($this->tempDir.'/Server/.mod_state'))->toBeFalse();
});

/**
 * The two INI lists are independent: `WorkshopItems=` and `Mods=` have no positional
 * relationship once a Workshop item ships more than one mod, which is what broke
 * pairing, removal and the restart badge for imported modpacks.
 */
describe('workshop-to-mod pairing', function () {
    it('pairs every mod a workshop item provides with that workshop id', function () {
        $this->parser->write($this->iniPath, [
            'WorkshopItems' => '2561774086;2286126274',
            'Mods' => 'SuperSurvivors;HydroA;HydroB',
        ]);
        writeLinks($this->tempDir, [
            '2561774086' => ['SuperSurvivors'],
            '2286126274' => ['HydroA', 'HydroB'],
        ]);

        $mods = $this->manager->list($this->iniPath);

        expect($mods)->toHaveCount(3)
            ->and($mods[0])->toMatchArray(['workshop_id' => '2561774086', 'mod_id' => 'SuperSurvivors'])
            ->and($mods[1])->toMatchArray(['workshop_id' => '2286126274', 'mod_id' => 'HydroA'])
            ->and($mods[2])->toMatchArray(['workshop_id' => '2286126274', 'mod_id' => 'HydroB']);
    });

    it('does not pair by position when the lists have different lengths', function () {
        $this->parser->write($this->iniPath, [
            'WorkshopItems' => '2561774086',
            'Mods' => 'SuperSurvivors;Excavation;BicycleMod',
        ]);

        $mods = $this->manager->list($this->iniPath);

        expect(collect($mods)->pluck('workshop_id')->all())->toBe(['', '', '', '2561774086']);
    });

    it('lists a workshop item with no known mod id as its own row', function () {
        $this->parser->write($this->iniPath, [
            'WorkshopItems' => '2561774086;9999999999',
            'Mods' => 'SuperSurvivors',
        ]);
        writeLinks($this->tempDir, ['2561774086' => ['SuperSurvivors']]);

        $mods = $this->manager->list($this->iniPath);

        expect($mods)->toHaveCount(2)
            ->and($mods[1])->toMatchArray(['workshop_id' => '9999999999', 'mod_id' => '']);
    });

    it('keeps positional pairing for a link-free list of equal length', function () {
        $mods = $this->manager->list($this->iniPath);

        expect($mods[0])->toMatchArray(['workshop_id' => '2561774086', 'mod_id' => 'SuperSurvivors'])
            ->and($mods[1])->toMatchArray(['workshop_id' => '2286126274', 'mod_id' => 'Hydrocraft']);
    });

    it('records the pairing of every imported workshop item, including installed ones', function () {
        $this->manager->bulkImport($this->iniPath, ['2561774086', '7777777777'], ['SuperSurvivors', 'Fresh'], [], [
            '2561774086' => ['SuperSurvivors'],
            '7777777777' => ['Fresh'],
        ]);

        $links = json_decode(file_get_contents($this->tempDir.'/Server/.mod_links.json'), true);

        expect($links)->toBe(['2561774086' => ['SuperSurvivors'], '7777777777' => ['Fresh']]);
    });

    it('repairs pairing for an already-installed list without touching the lists', function () {
        $before = $this->parser->read($this->iniPath);

        $this->manager->recordWorkshopLinks($this->iniPath, ['2286126274' => ['Hydrocraft']]);

        $after = $this->parser->read($this->iniPath);

        expect($after['Mods'])->toBe($before['Mods'])
            ->and($after['WorkshopItems'])->toBe($before['WorkshopItems']);

        $byMod = collect($this->manager->list($this->iniPath))->keyBy('mod_id');
        expect($byMod['Hydrocraft']['workshop_id'])->toBe('2286126274');
    });
});

describe('removing unpaired rows', function () {
    it('removes a mod that has no workshop id of its own', function () {
        $this->parser->write($this->iniPath, [
            'WorkshopItems' => '2561774086',
            'Mods' => 'SuperSurvivors;Excavation',
        ]);

        $removed = $this->manager->removeEntry($this->iniPath, null, 'Excavation');

        expect($removed)->toBe(['workshop_id' => '', 'mod_id' => 'Excavation'])
            ->and($this->parser->read($this->iniPath)['Mods'])->not->toContain('Excavation');
    });

    it('keeps a workshop item while any of its other mods are still installed', function () {
        $this->parser->write($this->iniPath, [
            'WorkshopItems' => '2286126274',
            'Mods' => 'HydroA;HydroB',
        ]);
        writeLinks($this->tempDir, ['2286126274' => ['HydroA', 'HydroB']]);

        $this->manager->removeEntry($this->iniPath, '2286126274', 'HydroA');

        $config = $this->parser->read($this->iniPath);

        expect($config['Mods'])->toContain('HydroB')
            ->and($config['Mods'])->not->toContain('HydroA')
            ->and($config['WorkshopItems'])->toContain('2286126274');
    });

    it('drops the workshop item once its last mod is removed', function () {
        $this->parser->write($this->iniPath, [
            'WorkshopItems' => '2286126274',
            'Mods' => 'HydroA;HydroB',
        ]);
        writeLinks($this->tempDir, ['2286126274' => ['HydroA', 'HydroB']]);

        $this->manager->removeEntry($this->iniPath, '2286126274', 'HydroA');
        $removed = $this->manager->removeEntry($this->iniPath, '2286126274', 'HydroB');

        expect($removed)->toBe(['workshop_id' => '2286126274', 'mod_id' => 'HydroB'])
            ->and($this->parser->read($this->iniPath)['WorkshopItems'])->not->toContain('2286126274');
    });

    it('removes a workshop item that has no mod id listed against it', function () {
        $this->parser->write($this->iniPath, [
            'WorkshopItems' => '2561774086;9999999999',
            'Mods' => 'SuperSurvivors',
        ]);

        $removed = $this->manager->removeEntry($this->iniPath, '9999999999', null);

        expect($removed)->toBe(['workshop_id' => '9999999999', 'mod_id' => ''])
            ->and($this->parser->read($this->iniPath)['WorkshopItems'])->not->toContain('9999999999');
    });

    it('drops the workshop item when a mod is removed by mod id alone', function () {
        writeLinks($this->tempDir, ['2561774086' => ['SuperSurvivors']]);

        $this->manager->removeEntry($this->iniPath, null, 'SuperSurvivors');

        $config = $this->parser->read($this->iniPath);

        expect($config['WorkshopItems'])->not->toContain('2561774086')
            ->and($config['Mods'])->not->toContain('SuperSurvivors');
    });

    it('returns null when neither identifier matches anything', function () {
        expect($this->manager->removeEntry($this->iniPath, '0000000000', 'Nope'))->toBeNull()
            ->and($this->manager->removeEntry($this->iniPath, null, null))->toBeNull();
    });

    it('forgets the pairing of a removed mod', function () {
        writeLinks($this->tempDir, ['2561774086' => ['SuperSurvivors']]);

        $this->manager->removeEntry($this->iniPath, null, 'SuperSurvivors');

        expect(file_exists($this->tempDir.'/Server/.mod_links.json'))->toBeFalse();
    });
});

describe('load status of unpaired rows', function () {
    it('marks an unpaired mod active once the server has loaded it', function () {
        $this->parser->write($this->iniPath, [
            'WorkshopItems' => '',
            'Mods' => 'Excavation;BicycleMod',
        ]);
        file_put_contents(
            $this->tempDir.'/Server/.mod_state_applied',
            "Mods=Excavation;BicycleMod\nWorkshopItems=\n"
        );

        $result = $this->manager->listWithStatus($this->iniPath, serverRunning: true);

        expect($result['pending_restart'])->toBeFalse()
            ->and(collect($result['mods'])->pluck('status')->all())->each->toBe('active');
    });

    it('still flags a mod the running server has not loaded', function () {
        $this->parser->write($this->iniPath, [
            'WorkshopItems' => '',
            'Mods' => 'Excavation;BicycleMod',
        ]);
        file_put_contents(
            $this->tempDir.'/Server/.mod_state_applied',
            "Mods=Excavation\nWorkshopItems=\n"
        );

        $result = $this->manager->listWithStatus($this->iniPath, serverRunning: true);

        $byMod = collect($result['mods'])->keyBy('mod_id');

        expect($result['pending_restart'])->toBeTrue()
            ->and($byMod['Excavation']['status'])->toBe('active')
            ->and($byMod['BicycleMod']['status'])->toBe('pending_restart');
    });

    it('flags a workshop item whose mod is not in the applied mod list', function () {
        file_put_contents(
            $this->tempDir.'/Server/.mod_state_applied',
            "Mods=SuperSurvivors\nWorkshopItems=2561774086;2286126274\n"
        );

        $result = $this->manager->listWithStatus($this->iniPath, serverRunning: true);

        $byMod = collect($result['mods'])->keyBy('mod_id');

        expect($byMod['SuperSurvivors']['status'])->toBe('active')
            ->and($byMod['Hydrocraft']['status'])->toBe('pending_restart');
    });
});

describe('reordering a partially paired list', function () {
    it('drops blanks and repeats from the rebuilt lines', function () {
        $this->manager->reorder($this->iniPath, [
            ['workshop_id' => '2286126274', 'mod_id' => 'HydroA'],
            ['workshop_id' => '2286126274', 'mod_id' => 'HydroB'],
            ['workshop_id' => '', 'mod_id' => 'Excavation'],
            ['workshop_id' => '2561774086', 'mod_id' => ''],
        ]);

        $config = $this->parser->read($this->iniPath);

        expect($config['WorkshopItems'])->toBe('2286126274;2561774086;3685323705')
            ->and($config['Mods'])->toBe('HydroA;HydroB;Excavation;ZomboidManager');
    });
});
