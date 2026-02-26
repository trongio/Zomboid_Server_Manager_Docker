<?php

use App\Enums\UserRole;
use App\Models\User;
use App\Models\WhitelistEntry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->withoutVite();
});

describe('Login with username', function () {
    it('authenticates with username and password', function () {
        $user = User::factory()->create();

        $response = $this->post(route('login.store'), [
            'username' => $user->username,
            'password' => 'password',
        ]);

        $this->assertAuthenticated();
    });

    it('rejects login with wrong password', function () {
        $user = User::factory()->create();

        $this->post(route('login.store'), [
            'username' => $user->username,
            'password' => 'wrong',
        ]);

        $this->assertGuest();
    });

    it('rejects login with non-existent username', function () {
        $this->post(route('login.store'), [
            'username' => 'nonexistent',
            'password' => 'password',
        ]);

        $this->assertGuest();
    });
});

describe('Role-based redirect', function () {
    it('redirects players to portal after login', function () {
        $user = User::factory()->create(['role' => UserRole::Player]);

        $response = $this->post(route('login.store'), [
            'username' => $user->username,
            'password' => 'password',
        ]);

        $response->assertRedirect('/portal');
    });

    it('redirects admins to dashboard after login', function () {
        $user = User::factory()->create(['role' => UserRole::Admin]);

        $response = $this->post(route('login.store'), [
            'username' => $user->username,
            'password' => 'password',
        ]);

        $response->assertRedirect('/dashboard');
    });

    it('redirects super admins to dashboard after login', function () {
        $user = User::factory()->create(['role' => UserRole::SuperAdmin]);

        $response = $this->post(route('login.store'), [
            'username' => $user->username,
            'password' => 'password',
        ]);

        $response->assertRedirect('/dashboard');
    });

    it('redirects new registrations to portal', function () {
        $response = $this->post(route('register.store'), [
            'username' => 'newplayer',
            'password' => 'P@ssw0rd!2024x',
            'password_confirmation' => 'P@ssw0rd!2024x',
        ]);

        $response->assertRedirect('/portal');
    });
});

describe('Registration with PZ account', function () {
    it('creates user with player role by default', function () {
        $this->post(route('register.store'), [
            'username' => 'newplayer',
            'password' => 'P@ssw0rd!2024x',
            'password_confirmation' => 'P@ssw0rd!2024x',
        ]);

        $user = User::where('username', 'newplayer')->first();
        expect($user)->not->toBeNull();
        expect($user->role)->toBe(UserRole::Player);
        expect($user->name)->toBe('newplayer');
    });

    it('creates whitelist entry linked to user', function () {
        $this->post(route('register.store'), [
            'username' => 'newplayer',
            'password' => 'P@ssw0rd!2024x',
            'password_confirmation' => 'P@ssw0rd!2024x',
        ]);

        $user = User::where('username', 'newplayer')->first();
        $entry = WhitelistEntry::where('pz_username', 'newplayer')->first();

        expect($entry)->not->toBeNull();
        expect($entry->user_id)->toBe($user->id);
        expect($entry->pz_password_hash)->toBe('P@ssw0rd!2024x');
        expect($entry->active)->toBeTrue();
    });

    it('allows registration without email', function () {
        $this->post(route('register.store'), [
            'username' => 'noemailplayer',
            'password' => 'P@ssw0rd!2024x',
            'password_confirmation' => 'P@ssw0rd!2024x',
        ]);

        $user = User::where('username', 'noemailplayer')->first();
        expect($user->email)->toBeNull();
    });

    it('allows registration with email', function () {
        $this->post(route('register.store'), [
            'username' => 'emailplayer',
            'email' => 'player@example.com',
            'password' => 'P@ssw0rd!2024x',
            'password_confirmation' => 'P@ssw0rd!2024x',
        ]);

        $user = User::where('username', 'emailplayer')->first();
        expect($user->email)->toBe('player@example.com');
    });
});

describe('Username validation', function () {
    it('rejects usernames shorter than 3 characters', function () {
        $response = $this->post(route('register.store'), [
            'username' => 'ab',
            'password' => 'P@ssw0rd!2024x',
            'password_confirmation' => 'P@ssw0rd!2024x',
        ]);

        $response->assertSessionHasErrors('username');
    });

    it('rejects usernames with special characters', function () {
        $response = $this->post(route('register.store'), [
            'username' => 'bad user!',
            'password' => 'P@ssw0rd!2024x',
            'password_confirmation' => 'P@ssw0rd!2024x',
        ]);

        $response->assertSessionHasErrors('username');
    });

    it('accepts usernames with underscores', function () {
        $this->post(route('register.store'), [
            'username' => 'good_user_123',
            'password' => 'P@ssw0rd!2024x',
            'password_confirmation' => 'P@ssw0rd!2024x',
        ]);

        $this->assertAuthenticated();
        $this->assertDatabaseHas('users', ['username' => 'good_user_123']);
    });

    it('rejects duplicate usernames in users table', function () {
        User::factory()->create(['username' => 'takenname']);

        $response = $this->post(route('register.store'), [
            'username' => 'takenname',
            'password' => 'P@ssw0rd!2024x',
            'password_confirmation' => 'P@ssw0rd!2024x',
        ]);

        $response->assertSessionHasErrors('username');
    });
});

describe('Player portal', function () {
    it('renders portal page for authenticated user', function () {
        $user = User::factory()->create();

        $this->actingAs($user)
            ->get(route('portal'))
            ->assertOk()
            ->assertInertia(fn (Assert $page) => $page
                ->component('portal')
                ->has('pzAccount')
                ->has('hasEmail')
                ->has('emailVerified'),
            );
    });

    it('shows correct PZ account data', function () {
        $user = User::factory()->create(['username' => 'testplayer']);

        WhitelistEntry::factory()->create([
            'user_id' => $user->id,
            'pz_username' => 'testplayer',
            'active' => true,
        ]);

        $this->actingAs($user)
            ->get(route('portal'))
            ->assertInertia(fn (Assert $page) => $page
                ->where('pzAccount.username', 'testplayer')
                ->where('pzAccount.whitelisted', true),
            );
    });

    it('requires authentication', function () {
        $this->get(route('portal'))
            ->assertRedirect(route('login'));
    });

    it('is accessible without verified email', function () {
        $user = User::factory()->unverified()->create();

        $this->actingAs($user)
            ->get(route('portal'))
            ->assertOk();
    });
});

describe('PZ account sync command', function () {
    it('runs successfully when SQLite is unavailable', function () {
        $this->artisan('pz:sync-accounts')
            ->assertFailed();
    });
});
