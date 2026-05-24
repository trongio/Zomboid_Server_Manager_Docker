<?php

use App\Services\SandboxVarsCommentParser;

beforeEach(function () {
    $this->parser = new SandboxVarsCommentParser;
});

it('returns empty catalog when the file is missing', function () {
    $result = $this->parser->parseFile(sys_get_temp_dir().'/nonexistent_'.uniqid().'.lua');

    expect($result)->toBe(['vanilla' => [], 'mods' => []]);
});

it('parses a vanilla enum option with description + default hint + enum labels', function () {
    $content = <<<LUA
SandboxVars = {
    VERSION = 6,
    -- Changing this also sets the "Population Multiplier" in Advanced Zombie Options. Default = Normal
    -- 1 = Insane
    -- 2 = Very High
    -- 3 = High
    -- 4 = Normal
    Zombies = 4,
}
LUA;

    $result = $this->parser->parseContent($content);

    expect($result['vanilla'])->toHaveKey('Zombies')
        ->and($result['vanilla']['Zombies'])->toMatchArray([
            'type' => 'enum',
            'default' => 4,
            'description' => 'Changing this also sets the "Population Multiplier" in Advanced Zombie Options.',
            'default_label' => 'Normal',
        ])
        ->and($result['vanilla']['Zombies']['options'])->toBe([
            ['value' => 1, 'label' => 'Insane'],
            ['value' => 2, 'label' => 'Very High'],
            ['value' => 3, 'label' => 'High'],
            ['value' => 4, 'label' => 'Normal'],
        ]);
});

it('parses inline Min/Max/Default hint together with description text', function () {
    $content = <<<LUA
SandboxVars = {
    -- If Random Speed is enabled, this controls what percentage of zombies are Sprinters. Min: 0 Max: 100 Default: 0
    SprinterPercentage = 0,
}
LUA;

    $result = $this->parser->parseContent($content);

    expect($result['vanilla']['SprinterPercentage'])->toMatchArray([
        'type' => 'number',
        'default' => 0,
        'min' => 0,
        'max' => 100,
    ])->and($result['vanilla']['SprinterPercentage']['description'])
        ->toContain('controls what percentage of zombies are Sprinters');
});

it('infers boolean type for true/false defaults', function () {
    $content = <<<LUA
SandboxVars = {
    -- Controls whether some randomization is applied to zombie distribution.
    ZombieVoronoiNoise = true,
}
LUA;

    $result = $this->parser->parseContent($content);

    expect($result['vanilla']['ZombieVoronoiNoise'])->toMatchArray([
        'type' => 'boolean',
        'default' => true,
    ]);
});

it('isolates mod options inside their namespace', function () {
    $content = <<<LUA
SandboxVars = {
    -- The respawn timer. Min: 1 Max: 100 Default: 10
    Respawn = 10,
    Basement = {
        -- How frequently basements spawn at random locations. Default = Sometimes
        -- 1 = Never
        -- 2 = Extremely Rare
        -- 3 = Rare
        -- 4 = Sometimes
        SpawnFrequency = 4,
    },
    SOTO = {
        -- Should be less than Max. Min: 1 Max: 100000 Default: 168
        CowardlyHoursToRemoveMin = 168,
        BraveEarnable = true,
    },
}
LUA;

    $result = $this->parser->parseContent($content);

    expect($result['vanilla'])->toHaveKey('Respawn')
        ->and($result['vanilla'])->not->toHaveKey('SpawnFrequency')
        ->and($result['mods'])->toHaveKey('Basement')
        ->and($result['mods'])->toHaveKey('SOTO')
        ->and($result['mods']['Basement']['options']['SpawnFrequency']['type'])->toBe('enum')
        ->and($result['mods']['SOTO']['options']['CowardlyHoursToRemoveMin'])->toMatchArray([
            'type' => 'number',
            'min' => 1,
            'max' => 100000,
            'default' => 168,
        ])
        ->and($result['mods']['SOTO']['options']['BraveEarnable'])->toMatchArray([
            'type' => 'boolean',
            'default' => true,
        ]);
});

it('treats single enum line as a regular default, not a choice list', function () {
    // A lone `-- 1 = Foo` shouldn't flip type to enum; we need at least two
    // markers to treat a field as a selectable list.
    $content = <<<LUA
SandboxVars = {
    -- 1 = Some Value
    LoneInteger = 1,
}
LUA;

    $result = $this->parser->parseContent($content);

    expect($result['vanilla']['LoneInteger']['type'])->toBe('number');
});

it('survives a value with quotes around the default', function () {
    $content = <<<LUA
SandboxVars = {
    -- Custom welcome banner.
    Banner = "Hello",
}
LUA;

    $result = $this->parser->parseContent($content);

    expect($result['vanilla']['Banner'])->toMatchArray([
        'type' => 'string',
        'default' => 'Hello',
    ]);
});
