<?php

use App\Enums\UserRole;
use App\Models\AuditLog;
use App\Models\SiteSetting;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->admin = User::factory()->admin()->create();
});

// ── Page rendering ───────────────────────────────────────────────────

describe('Site settings page', function () {
    it('renders the settings page', function () {
        $this->actingAs($this->admin)
            ->get(route('admin.site-settings'))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('admin/site-settings')
                ->has('settings')
                ->has('available_icons')
                ->has('available_sections')
            );
    });

    it('requires authentication', function () {
        $this->get(route('admin.site-settings'))
            ->assertRedirect('/login');
    });

    it('requires admin role', function () {
        $player = User::factory()->create(['role' => UserRole::Player]);

        $this->actingAs($player)
            ->get(route('admin.site-settings'))
            ->assertForbidden();
    });

    it('returns current settings values', function () {
        SiteSetting::factory()->create([
            'site_name' => 'Test Server',
            'footer_text' => 'Custom Footer',
        ]);

        $this->actingAs($this->admin)
            ->get(route('admin.site-settings'))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->where('settings.site_name', 'Test Server')
                ->where('settings.footer_text', 'Custom Footer')
            );
    });
});

// ── Settings update ──────────────────────────────────────────────────

describe('Site settings update', function () {
    it('updates text fields', function () {
        $this->actingAs($this->admin)
            ->post(route('admin.site-settings.update'), [
                'site_name' => 'New Server Name',
                'footer_text' => 'New Footer',
                'hero_badge' => 'New Badge',
                'hero_title' => 'New Title',
                'hero_subtitle' => 'New Subtitle',
                'hero_description' => 'New description text',
                'hero_button_text' => 'Connect Now',
            ])
            ->assertOk()
            ->assertJson(['message' => 'Site settings updated']);

        $settings = SiteSetting::instance();
        expect($settings->site_name)->toBe('New Server Name');
        expect($settings->footer_text)->toBe('New Footer');
        expect($settings->hero_badge)->toBe('New Badge');
        expect($settings->hero_title)->toBe('New Title');
        expect($settings->hero_subtitle)->toBe('New Subtitle');
        expect($settings->hero_description)->toBe('New description text');
        expect($settings->hero_button_text)->toBe('Connect Now');
    });

    it('updates features', function () {
        $features = [
            ['icon' => 'Terminal', 'title' => 'Feature One', 'description' => 'Desc one'],
            ['icon' => 'Users', 'title' => 'Feature Two', 'description' => 'Desc two'],
        ];

        $this->actingAs($this->admin)
            ->post(route('admin.site-settings.update'), [
                'site_name' => 'Test',
                'footer_text' => 'Test',
                'hero_badge' => 'Test',
                'hero_title' => 'Test',
                'hero_subtitle' => 'Test',
                'hero_description' => 'Test',
                'hero_button_text' => 'Test',
                'features' => $features,
            ])
            ->assertOk();

        expect(SiteSetting::instance()->features)->toHaveCount(2);
        expect(SiteSetting::instance()->features[0]['title'])->toBe('Feature One');
    });

    it('updates landing sections', function () {
        $sections = [
            ['id' => 'hero', 'enabled' => true, 'order' => 0],
            ['id' => 'features', 'enabled' => false, 'order' => 1],
        ];

        $this->actingAs($this->admin)
            ->post(route('admin.site-settings.update'), [
                'site_name' => 'Test',
                'footer_text' => 'Test',
                'hero_badge' => 'Test',
                'hero_title' => 'Test',
                'hero_subtitle' => 'Test',
                'hero_description' => 'Test',
                'hero_button_text' => 'Test',
                'landing_sections' => $sections,
            ])
            ->assertOk();

        $saved = SiteSetting::instance()->landing_sections;
        expect($saved)->toHaveCount(2);
        expect($saved[1]['enabled'])->toBeFalse();
    });

    it('creates audit log on update', function () {
        $this->actingAs($this->admin)
            ->post(route('admin.site-settings.update'), [
                'site_name' => 'Audited Change',
                'footer_text' => 'Test',
                'hero_badge' => 'Test',
                'hero_title' => 'Test',
                'hero_subtitle' => 'Test',
                'hero_description' => 'Test',
                'hero_button_text' => 'Test',
            ])
            ->assertOk();

        expect(AuditLog::where('action', 'site_settings.update')->exists())->toBeTrue();
    });
});

// ── File uploads ────────────────────────────────────────────────────

describe('Site settings file uploads', function () {
    it('uploads a logo', function () {
        Storage::fake('public');

        $this->actingAs($this->admin)
            ->post(route('admin.site-settings.update'), [
                'site_name' => 'Test',
                'footer_text' => 'Test',
                'hero_badge' => 'Test',
                'hero_title' => 'Test',
                'hero_subtitle' => 'Test',
                'hero_description' => 'Test',
                'hero_button_text' => 'Test',
                'logo' => UploadedFile::fake()->create('logo.png', 100, 'image/png'),
            ])
            ->assertOk();

        $settings = SiteSetting::instance();
        expect($settings->logo_path)->not->toBeNull();
        Storage::disk('public')->assertExists($settings->logo_path);
    });

    it('uploads a favicon', function () {
        Storage::fake('public');

        $this->actingAs($this->admin)
            ->post(route('admin.site-settings.update'), [
                'site_name' => 'Test',
                'footer_text' => 'Test',
                'hero_badge' => 'Test',
                'hero_title' => 'Test',
                'hero_subtitle' => 'Test',
                'hero_description' => 'Test',
                'hero_button_text' => 'Test',
                'favicon' => UploadedFile::fake()->create('favicon.png', 100, 'image/png'),
            ])
            ->assertOk();

        $settings = SiteSetting::instance();
        expect($settings->favicon_path)->not->toBeNull();
        Storage::disk('public')->assertExists($settings->favicon_path);
    });

    it('removes logo', function () {
        Storage::fake('public');

        SiteSetting::factory()->create([
            'logo_path' => 'site/logo.png',
        ]);
        Storage::disk('public')->put('site/logo.png', 'fake');

        $this->actingAs($this->admin)
            ->deleteJson(route('admin.site-settings.remove-logo'))
            ->assertOk()
            ->assertJson(['message' => 'Logo removed']);

        expect(SiteSetting::instance()->logo_path)->toBeNull();
        Storage::disk('public')->assertMissing('site/logo.png');
    });

    it('removes favicon', function () {
        Storage::fake('public');

        SiteSetting::factory()->create([
            'favicon_path' => 'site/favicon.ico',
        ]);
        Storage::disk('public')->put('site/favicon.ico', 'fake');

        $this->actingAs($this->admin)
            ->deleteJson(route('admin.site-settings.remove-favicon'))
            ->assertOk()
            ->assertJson(['message' => 'Favicon removed']);

        expect(SiteSetting::instance()->favicon_path)->toBeNull();
        Storage::disk('public')->assertMissing('site/favicon.ico');
    });
});

// ── Validation ──────────────────────────────────────────────────────

describe('Site settings validation', function () {
    it('rejects site name that is too long', function () {
        $this->actingAs($this->admin)
            ->postJson(route('admin.site-settings.update'), [
                'site_name' => str_repeat('x', 101),
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('site_name');
    });

    it('rejects oversized logo', function () {
        Storage::fake('public');

        $this->actingAs($this->admin)
            ->post(route('admin.site-settings.update'), [
                'site_name' => 'Test',
                'footer_text' => 'Test',
                'hero_badge' => 'Test',
                'hero_title' => 'Test',
                'hero_subtitle' => 'Test',
                'hero_description' => 'Test',
                'hero_button_text' => 'Test',
                'logo' => UploadedFile::fake()->create('logo.png', 3000, 'image/png'),
            ])
            ->assertSessionHasErrors('logo');
    });

    it('rejects more than 8 features', function () {
        $features = array_fill(0, 9, ['icon' => 'Star', 'title' => 'F', 'description' => 'D']);

        $this->actingAs($this->admin)
            ->postJson(route('admin.site-settings.update'), [
                'features' => $features,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('features');
    });
});
