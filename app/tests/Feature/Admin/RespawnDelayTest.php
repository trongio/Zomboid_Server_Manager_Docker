<?php

use App\Enums\UserRole;
use App\Models\AuditLog;
use App\Models\User;
use App\Services\RespawnDelayManager;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->admin = User::factory()->admin()->create();

    $this->tempDir = sys_get_temp_dir().'/pz_respawn_feature_'.getmypid();
    mkdir($this->tempDir, 0755, true);

    $this->configPath = $this->tempDir.'/respawn_config.json';
    $this->deathsPath = $this->tempDir.'/respawn_deaths.json';
    $this->resetsPath = $this->tempDir.'/respawn_resets.json';

    $manager = new RespawnDelayManager($this->configPath, $this->deathsPath, $this->resetsPath);
    app()->instance(RespawnDelayManager::class, $manager);
});

afterEach(function () {
    $files = glob($this->tempDir.'/*') ?: [];
    array_map(fn ($f) => is_file($f) && unlink($f), $files);
    if (is_dir($this->tempDir)) {
        rmdir($this->tempDir);
    }
});

// ── GET index ────────────────────────────────────────────────────────

it('returns config and cooldowns on index', function () {
    $this->actingAs($this->admin)
        ->getJson(route('admin.respawn-delay.index'))
        ->assertOk()
        ->assertJsonStructure(['config' => ['enabled', 'delay_minutes'], 'cooldowns']);
});

// ── PATCH update ─────────────────────────────────────────────────────

it('updates respawn delay config', function () {
    $this->actingAs($this->admin)
        ->patchJson(route('admin.respawn-delay.update'), [
            'enabled' => true,
            'delay_minutes' => 45,
        ])
        ->assertOk()
        ->assertJson([
            'message' => 'Respawn delay settings updated',
            'config' => ['enabled' => true, 'delay_minutes' => 45],
        ]);

    expect(AuditLog::where('action', 'respawn_delay.update')->exists())->toBeTrue();
});

it('validates enabled field is required', function () {
    $this->actingAs($this->admin)
        ->patchJson(route('admin.respawn-delay.update'), [
            'delay_minutes' => 30,
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('enabled');
});

it('validates delay_minutes is required', function () {
    $this->actingAs($this->admin)
        ->patchJson(route('admin.respawn-delay.update'), [
            'enabled' => true,
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('delay_minutes');
});

it('validates delay_minutes minimum', function () {
    $this->actingAs($this->admin)
        ->patchJson(route('admin.respawn-delay.update'), [
            'enabled' => true,
            'delay_minutes' => 0,
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('delay_minutes');
});

it('validates delay_minutes maximum', function () {
    $this->actingAs($this->admin)
        ->patchJson(route('admin.respawn-delay.update'), [
            'enabled' => true,
            'delay_minutes' => 99999,
        ])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('delay_minutes');
});

// ── POST reset ───────────────────────────────────────────────────────

it('resets a player respawn timer', function () {
    $this->actingAs($this->admin)
        ->postJson(route('admin.respawn-delay.reset', 'TestPlayer'))
        ->assertOk()
        ->assertJson(['message' => 'Respawn timer reset for TestPlayer']);

    expect(AuditLog::where('action', 'respawn_delay.reset')->where('target', 'TestPlayer')->exists())->toBeTrue();

    $resets = json_decode(file_get_contents($this->resetsPath), true);
    expect($resets['resets'])->toContain('TestPlayer');
});

// ── Auth ─────────────────────────────────────────────────────────────

it('requires admin authentication for index', function () {
    $player = User::factory()->create(['role' => UserRole::Player]);

    $this->actingAs($player)
        ->getJson(route('admin.respawn-delay.index'))
        ->assertForbidden();
});

it('requires admin authentication for update', function () {
    $player = User::factory()->create(['role' => UserRole::Player]);

    $this->actingAs($player)
        ->patchJson(route('admin.respawn-delay.update'), [
            'enabled' => true,
            'delay_minutes' => 30,
        ])
        ->assertForbidden();
});

it('requires admin authentication for reset', function () {
    $player = User::factory()->create(['role' => UserRole::Player]);

    $this->actingAs($player)
        ->postJson(route('admin.respawn-delay.reset', 'TestPlayer'))
        ->assertForbidden();
});
