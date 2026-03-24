<?php

use App\Enums\UserRole;
use App\Models\AuditLog;
use App\Models\AutoRestartSetting;
use App\Models\ScheduledRestartTime;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->admin = User::factory()->admin()->create();
});

// ── Page rendering ───────────────────────────────────────────────────

describe('Auto restart settings page', function () {
    it('renders the settings page with schedule', function () {
        AutoRestartSetting::factory()->enabled()->create();
        ScheduledRestartTime::factory()->create(['time' => '14:00']);

        $this->actingAs($this->admin)
            ->get(route('admin.auto-restart'))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('admin/auto-restart')
                ->has('settings')
                ->has('schedule', 1)
                ->has('next_restart_at')
            );
    });

    it('requires authentication', function () {
        $this->get(route('admin.auto-restart'))
            ->assertRedirect('/login');
    });

    it('requires admin role', function () {
        $player = User::factory()->create(['role' => UserRole::Player]);

        $this->actingAs($player)
            ->get(route('admin.auto-restart'))
            ->assertForbidden();
    });

    it('returns current settings with timezone and discord_reminder_minutes', function () {
        AutoRestartSetting::factory()->enabled()->create([
            'warning_minutes' => 10,
            'timezone' => 'Europe/Berlin',
            'discord_reminder_minutes' => 15,
        ]);

        $this->actingAs($this->admin)
            ->get(route('admin.auto-restart'))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->where('settings.enabled', true)
                ->where('settings.warning_minutes', 10)
                ->where('settings.timezone', 'Europe/Berlin')
                ->where('settings.discord_reminder_minutes', 15)
            );
    });
});

// ── Settings update ──────────────────────────────────────────────────

describe('Auto restart settings update', function () {
    it('updates enabled flag', function () {
        AutoRestartSetting::factory()->create();

        $this->actingAs($this->admin)
            ->patchJson(route('admin.auto-restart.update'), [
                'enabled' => true,
            ])
            ->assertOk()
            ->assertJson(['message' => 'Auto-restart settings updated']);

        expect(AutoRestartSetting::instance()->enabled)->toBeTrue();
    });

    it('clears cache when disabling', function () {
        AutoRestartSetting::factory()->enabled()->create();
        cache()->put('server.auto_restart.pending', true);
        cache()->put('server.pending_action:restart', true);

        $this->actingAs($this->admin)
            ->patchJson(route('admin.auto-restart.update'), [
                'enabled' => false,
            ])
            ->assertOk();

        expect(cache()->has('server.auto_restart.pending'))->toBeFalse();
        expect(cache()->has('server.pending_action:restart'))->toBeFalse();
    });

    it('updates warning minutes', function () {
        AutoRestartSetting::factory()->create();

        $this->actingAs($this->admin)
            ->patchJson(route('admin.auto-restart.update'), [
                'warning_minutes' => 15,
            ])
            ->assertOk();

        expect(AutoRestartSetting::instance()->warning_minutes)->toBe(15);
    });

    it('updates warning message', function () {
        AutoRestartSetting::factory()->create();

        $this->actingAs($this->admin)
            ->patchJson(route('admin.auto-restart.update'), [
                'warning_message' => 'Scheduled maintenance restart',
            ])
            ->assertOk();

        expect(AutoRestartSetting::instance()->warning_message)->toBe('Scheduled maintenance restart');
    });

    it('updates timezone', function () {
        AutoRestartSetting::factory()->create();

        $this->actingAs($this->admin)
            ->patchJson(route('admin.auto-restart.update'), [
                'timezone' => 'America/New_York',
            ])
            ->assertOk();

        expect(AutoRestartSetting::instance()->timezone)->toBe('America/New_York');
    });

    it('updates discord_reminder_minutes', function () {
        AutoRestartSetting::factory()->create();

        $this->actingAs($this->admin)
            ->patchJson(route('admin.auto-restart.update'), [
                'discord_reminder_minutes' => 60,
            ])
            ->assertOk();

        expect(AutoRestartSetting::instance()->discord_reminder_minutes)->toBe(60);
    });

    it('creates audit log on update', function () {
        AutoRestartSetting::factory()->create();

        $this->actingAs($this->admin)
            ->patchJson(route('admin.auto-restart.update'), [
                'enabled' => true,
            ])
            ->assertOk();

        expect(AuditLog::where('action', 'autorestart.settings.update')->exists())->toBeTrue();
    });
});

// ── Schedule CRUD ───────────────────────────────────────────────────

describe('Scheduled restart times', function () {
    it('adds a restart time', function () {
        $this->actingAs($this->admin)
            ->postJson(route('admin.auto-restart.times.store'), [
                'time' => '14:00',
            ])
            ->assertOk()
            ->assertJson(['message' => 'Restart time added']);

        expect(ScheduledRestartTime::where('time', '14:00')->exists())->toBeTrue();
    });

    it('deletes a restart time', function () {
        $time = ScheduledRestartTime::factory()->create(['time' => '06:00']);

        $this->actingAs($this->admin)
            ->deleteJson(route('admin.auto-restart.times.destroy', $time))
            ->assertOk()
            ->assertJson(['message' => 'Restart time removed']);

        expect(ScheduledRestartTime::where('time', '06:00')->exists())->toBeFalse();
    });

    it('toggles a restart time', function () {
        $time = ScheduledRestartTime::factory()->create(['time' => '22:00', 'enabled' => true]);

        $this->actingAs($this->admin)
            ->postJson(route('admin.auto-restart.times.toggle', $time))
            ->assertOk()
            ->assertJson(['enabled' => false]);

        expect($time->fresh()->enabled)->toBeFalse();
    });

    it('enforces max 5 scheduled times', function () {
        // Use explicit times to avoid unique-constraint collision with the 6th attempt
        foreach (['01:00', '05:00', '09:00', '13:00', '17:00'] as $time) {
            ScheduledRestartTime::factory()->create(['time' => $time]);
        }

        $this->actingAs($this->admin)
            ->postJson(route('admin.auto-restart.times.store'), [
                'time' => '23:30',
            ])
            ->assertStatus(422)
            ->assertJson(['message' => 'Maximum of 5 scheduled times allowed']);
    });
});

// ── Validation ───────────────────────────────────────────────────────

describe('Auto restart validation', function () {
    it('rejects duplicate time', function () {
        ScheduledRestartTime::factory()->create(['time' => '14:00']);

        $this->actingAs($this->admin)
            ->postJson(route('admin.auto-restart.times.store'), [
                'time' => '14:00',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('time');
    });

    it('rejects invalid time format', function () {
        $this->actingAs($this->admin)
            ->postJson(route('admin.auto-restart.times.store'), [
                'time' => '25:00',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('time');
    });

    it('rejects invalid warning minutes', function () {
        $this->actingAs($this->admin)
            ->patchJson(route('admin.auto-restart.update'), [
                'warning_minutes' => 7,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('warning_minutes');
    });

    it('rejects invalid timezone', function () {
        $this->actingAs($this->admin)
            ->patchJson(route('admin.auto-restart.update'), [
                'timezone' => 'Not/A/Timezone',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('timezone');
    });

    it('rejects invalid discord_reminder_minutes', function () {
        $this->actingAs($this->admin)
            ->patchJson(route('admin.auto-restart.update'), [
                'discord_reminder_minutes' => 20,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('discord_reminder_minutes');
    });

    it('rejects message exceeding max length', function () {
        $this->actingAs($this->admin)
            ->patchJson(route('admin.auto-restart.update'), [
                'warning_message' => str_repeat('a', 501),
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('warning_message');
    });
});
