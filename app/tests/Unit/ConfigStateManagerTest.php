<?php

use App\Services\ConfigStateManager;

beforeEach(function () {
    $this->manager = new ConfigStateManager;
    $this->tempDir = sys_get_temp_dir().'/pz_config_test_'.uniqid();
    mkdir($this->tempDir.'/Server', 0777, true);
    $this->iniPath = $this->tempDir.'/Server/ZomboidServer.ini';
    file_put_contents($this->iniPath, "DefaultPort=16261\nMaxPlayers=16\n");
    $this->stateFile = $this->tempDir.'/.config_state';
});

afterEach(function () {
    @unlink($this->iniPath);
    @unlink($this->stateFile);
    // Clean up temp files left by atomic writes
    foreach (glob($this->tempDir.'/.config_state.*') as $f) {
        @unlink($f);
    }
    @rmdir($this->tempDir.'/Server');
    @rmdir($this->tempDir);
});

it('persists allowlisted settings to .config_state', function () {
    $this->manager->persistSettings([
        'MaxPlayers' => '32',
        'Public' => 'false',
    ], $this->iniPath);

    expect($this->stateFile)->toBeFile();

    $contents = file_get_contents($this->stateFile);
    expect($contents)->toContain('MaxPlayers=32')
        ->and($contents)->toContain('Public=false');
});

it('excludes non-allowlisted keys', function () {
    $this->manager->persistSettings([
        'MaxPlayers' => '32',
        'RCONPassword' => 'secret',
        'RCONPort' => '27015',
        'SomeRandomKey' => 'value',
    ], $this->iniPath);

    $contents = file_get_contents($this->stateFile);
    expect($contents)->toContain('MaxPlayers=32')
        ->and($contents)->not->toContain('RCONPassword')
        ->and($contents)->not->toContain('RCONPort')
        ->and($contents)->not->toContain('SomeRandomKey');
});

it('does not create state file when no allowlisted keys are present', function () {
    $this->manager->persistSettings([
        'RCONPassword' => 'secret',
        'CustomKey' => 'value',
    ], $this->iniPath);

    expect($this->stateFile)->not->toBeFile();
});

it('merges multiple partial updates', function () {
    $this->manager->persistSettings([
        'MaxPlayers' => '32',
    ], $this->iniPath);

    $this->manager->persistSettings([
        'Public' => 'false',
    ], $this->iniPath);

    $contents = file_get_contents($this->stateFile);
    expect($contents)->toContain('MaxPlayers=32')
        ->and($contents)->toContain('Public=false');
});

it('overwrites existing keys on update', function () {
    $this->manager->persistSettings([
        'MaxPlayers' => '32',
    ], $this->iniPath);

    $this->manager->persistSettings([
        'MaxPlayers' => '64',
    ], $this->iniPath);

    $contents = file_get_contents($this->stateFile);
    expect($contents)->toContain('MaxPlayers=64')
        ->and($contents)->not->toContain('MaxPlayers=32');
});

it('strips newlines from values', function () {
    $this->manager->persistSettings([
        'MaxPlayers' => "32\r\n",
    ], $this->iniPath);

    $contents = file_get_contents($this->stateFile);
    expect($contents)->toContain('MaxPlayers=32')
        ->and($contents)->not->toContain("\r");
});

it('persists all allowlisted keys', function () {
    $settings = [
        'DefaultPort' => '16261',
        'UDPPort' => '16262',
        'MaxPlayers' => '32',
        'Map' => 'Muldraugh, KY',
        'Public' => 'true',
        'PauseEmpty' => 'true',
        'SaveWorldEveryMinutes' => '15',
        'SteamVAC' => 'true',
        'Open' => 'true',
        'AutoCreateUserInWhiteList' => 'true',
        'Password' => 'secret',
        'AdminPassword' => 'admin123',
    ];

    $this->manager->persistSettings($settings, $this->iniPath);

    $contents = file_get_contents($this->stateFile);
    foreach ($settings as $key => $value) {
        expect($contents)->toContain("$key=$value");
    }
});
