<?php

use App\Enums\UserRole;
use App\Models\AuditLog;
use App\Models\Language;
use App\Models\Translation;
use App\Models\User;
use App\Services\TranslationService;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->admin = User::factory()->admin()->create();
});

// ── Page rendering ───────────────────────────────────────────────────

describe('Translations page', function () {
    it('renders the translations page', function () {
        $this->actingAs($this->admin)
            ->get(route('admin.translations'))
            ->assertOk()
            ->assertInertia(fn ($page) => $page
                ->component('admin/translations')
                ->has('languages')
                ->has('keys')
                ->has('defaults')
                ->has('overrides')
            );
    });

    it('requires authentication', function () {
        $this->get(route('admin.translations'))
            ->assertRedirect('/login');
    });

    it('requires admin role', function () {
        $player = User::factory()->create(['role' => UserRole::Player]);

        $this->actingAs($player)
            ->get(route('admin.translations'))
            ->assertForbidden();
    });
});

// ── Translation updates ─────────────────────────────────────────────

describe('Translation CRUD', function () {
    it('creates a translation override', function () {
        $this->actingAs($this->admin)
            ->patchJson(route('admin.translations.update'), [
                'locale' => 'ka',
                'key' => 'nav.dashboard',
                'value' => 'მართვის პანელი',
            ])
            ->assertOk()
            ->assertJson(['message' => 'Translation updated']);

        expect(Translation::where('locale', 'ka')->where('key', 'nav.dashboard')->exists())->toBeTrue();
    });

    it('updates an existing translation override', function () {
        Translation::create([
            'locale' => 'ka',
            'key' => 'nav.dashboard',
            'value' => 'Old Value',
        ]);

        $this->actingAs($this->admin)
            ->patchJson(route('admin.translations.update'), [
                'locale' => 'ka',
                'key' => 'nav.dashboard',
                'value' => 'მართვის პანელი',
            ])
            ->assertOk();

        expect(Translation::where('locale', 'ka')->where('key', 'nav.dashboard')->first()->value)
            ->toBe('მართვის პანელი');
    });

    it('deletes a translation override', function () {
        Translation::create([
            'locale' => 'ka',
            'key' => 'nav.dashboard',
            'value' => 'Test',
        ]);

        $this->actingAs($this->admin)
            ->deleteJson(route('admin.translations.delete'), [
                'locale' => 'ka',
                'key' => 'nav.dashboard',
            ])
            ->assertOk()
            ->assertJson(['message' => 'Translation override removed']);

        expect(Translation::where('locale', 'ka')->where('key', 'nav.dashboard')->exists())->toBeFalse();
    });

    it('creates audit log on translation update', function () {
        $this->actingAs($this->admin)
            ->patchJson(route('admin.translations.update'), [
                'locale' => 'en',
                'key' => 'nav.dashboard',
                'value' => 'Home',
            ])
            ->assertOk();

        expect(AuditLog::where('action', 'translation.update')->exists())->toBeTrue();
    });
});

// ── Language management ─────────────────────────────────────────────

describe('Language management', function () {
    it('creates a language', function () {
        $this->actingAs($this->admin)
            ->postJson(route('admin.languages.store'), [
                'code' => 'ka',
                'name' => 'Georgian',
                'native_name' => 'ქართული',
            ])
            ->assertOk()
            ->assertJson(['message' => 'Language added']);

        expect(Language::where('code', 'ka')->exists())->toBeTrue();
    });

    it('rejects duplicate language codes', function () {
        Language::factory()->create(['code' => 'ka', 'name' => 'Georgian', 'native_name' => 'ქართული']);

        $this->actingAs($this->admin)
            ->postJson(route('admin.languages.store'), [
                'code' => 'ka',
                'name' => 'Georgian',
                'native_name' => 'ქართული',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('code');
    });

    it('updates a language', function () {
        $lang = Language::factory()->create();

        $this->actingAs($this->admin)
            ->patchJson(route('admin.languages.update', $lang), [
                'is_active' => false,
            ])
            ->assertOk();

        expect($lang->fresh()->is_active)->toBeFalse();
    });

    it('sets a language as default and unsets previous', function () {
        $en = Language::factory()->create(['code' => 'en', 'is_default' => true]);
        $ka = Language::factory()->create(['code' => 'ka', 'name' => 'Georgian', 'native_name' => 'ქართული', 'is_default' => false]);

        $this->actingAs($this->admin)
            ->patchJson(route('admin.languages.update', $ka), [
                'is_default' => true,
            ])
            ->assertOk();

        expect($ka->fresh()->is_default)->toBeTrue();
        expect($en->fresh()->is_default)->toBeFalse();
    });

    it('prevents deleting the default language', function () {
        $lang = Language::factory()->create(['is_default' => true]);

        $this->actingAs($this->admin)
            ->deleteJson(route('admin.languages.destroy', $lang))
            ->assertUnprocessable()
            ->assertJson(['message' => 'Cannot delete the default language']);
    });

    it('deletes a non-default language and its translations', function () {
        $lang = Language::factory()->create(['code' => 'ka', 'name' => 'Georgian', 'native_name' => 'ქართული', 'is_default' => false]);
        Translation::create(['locale' => 'ka', 'key' => 'test.key', 'value' => 'Test']);

        $this->actingAs($this->admin)
            ->deleteJson(route('admin.languages.destroy', $lang))
            ->assertOk();

        expect(Language::where('code', 'ka')->exists())->toBeFalse();
        expect(Translation::where('locale', 'ka')->exists())->toBeFalse();
    });
});

// ── Translation service ─────────────────────────────────────────────

describe('TranslationService', function () {
    it('loads defaults from JSON file', function () {
        $translations = TranslationService::getForLocale('en');

        expect($translations)->toHaveKey('nav.dashboard');
        expect($translations['nav.dashboard'])->toBe('Dashboard');
    });

    it('overlays DB overrides on top of JSON defaults', function () {
        Translation::create(['locale' => 'en', 'key' => 'nav.dashboard', 'value' => 'Home']);

        // Bust cache to pick up the override
        TranslationService::bustCache('en');

        $translations = TranslationService::getForLocale('en');

        expect($translations['nav.dashboard'])->toBe('Home');
    });

    it('falls back to English defaults for unknown locale', function () {
        $translations = TranslationService::getForLocale('xx');

        expect($translations)->toHaveKey('nav.dashboard');
    });
});
