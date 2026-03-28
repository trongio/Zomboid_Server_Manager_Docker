<?php

use App\Enums\UserRole;
use App\Models\User;
use App\Models\WhitelistEntry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Inertia\Testing\AssertableInertia as Assert;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->withoutVite();
    // Always use a temp PZ SQLite DB — never hit the real game server
    $this->pzDbPath = setupTestPzSqlite();
});

afterEach(function () {
    if (isset($this->pzDbPath)) {
        DB::connection('pz_sqlite')->disconnect();
        @unlink($this->pzDbPath);
    }
});

/**
 * Set up a temporary PZ SQLite database with a whitelist table.
 */
function setupTestPzSqlite(): string
{
    $dbPath = sys_get_temp_dir().'/pz_test_sync_'.uniqid().'.db';
    touch($dbPath);

    config(['database.connections.pz_sqlite.database' => $dbPath]);
    DB::purge('pz_sqlite');

    DB::connection('pz_sqlite')->statement('
        CREATE TABLE IF NOT EXISTS whitelist (
            username TEXT PRIMARY KEY,
            password TEXT,
            world TEXT DEFAULT NULL,
            role INTEGER DEFAULT 2,
            authType INTEGER DEFAULT 1
        )
    ');

    return $dbPath;
}

/**
 * Insert a PZ account into the temporary SQLite whitelist.
 */
function insertPzAccount(string $username, string $password): void
{
    DB::connection('pz_sqlite')->table('whitelist')->insert([
        'username' => $username,
        'password' => $password,
    ]);
}

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
            'password' => 'secretpw',
            'password_confirmation' => 'secretpw',
        ]);

        $response->assertRedirect('/portal');
    });
});

describe('Registration with PZ account', function () {
    it('creates user with player role by default', function () {
        $this->post(route('register.store'), [
            'username' => 'newplayer',
            'password' => 'secretpw',
            'password_confirmation' => 'secretpw',
        ]);

        $user = User::where('username', 'newplayer')->first();
        expect($user)->not->toBeNull();
        expect($user->role)->toBe(UserRole::Player);
        expect($user->name)->toBe('newplayer');
    });

    it('creates whitelist entry linked to user', function () {
        $this->post(route('register.store'), [
            'username' => 'newplayer',
            'password' => 'secretpw',
            'password_confirmation' => 'secretpw',
        ]);

        $user = User::where('username', 'newplayer')->first();
        $entry = WhitelistEntry::where('pz_username', 'newplayer')->first();

        expect($entry)->not->toBeNull();
        expect($entry->user_id)->toBe($user->id);
        // PZ hash is bcrypt(md5(password)) — verify it matches
        expect(password_verify(md5('secretpw'), $entry->pz_password_hash))->toBeTrue();
        expect($entry->active)->toBeTrue();
    });

    it('allows registration without email', function () {
        $this->post(route('register.store'), [
            'username' => 'noemailplayer',
            'password' => 'secretpw',
            'password_confirmation' => 'secretpw',
        ]);

        $user = User::where('username', 'noemailplayer')->first();
        expect($user->email)->toBeNull();
    });

    it('allows registration with email', function () {
        $this->post(route('register.store'), [
            'username' => 'emailplayer',
            'email' => 'player@example.com',
            'password' => 'secretpw',
            'password_confirmation' => 'secretpw',
        ]);

        $user = User::where('username', 'emailplayer')->first();
        expect($user->email)->toBe('player@example.com');
    });
});

describe('Username validation', function () {
    it('rejects usernames shorter than 3 characters', function () {
        $response = $this->post(route('register.store'), [
            'username' => 'ab',
            'password' => 'secretpw',
            'password_confirmation' => 'secretpw',
        ]);

        $response->assertSessionHasErrors('username');
    });

    it('rejects usernames with special characters', function () {
        $response = $this->post(route('register.store'), [
            'username' => 'bad user!',
            'password' => 'secretpw',
            'password_confirmation' => 'secretpw',
        ]);

        $response->assertSessionHasErrors('username');
    });

    it('accepts usernames with underscores', function () {
        $this->post(route('register.store'), [
            'username' => 'good_user_123',
            'password' => 'secretpw',
            'password_confirmation' => 'secretpw',
        ]);

        $this->assertAuthenticated();
        $this->assertDatabaseHas('users', ['username' => 'good_user_123']);
    });

    it('rejects duplicate usernames in users table', function () {
        User::factory()->create(['username' => 'takenname']);

        $response = $this->post(route('register.store'), [
            'username' => 'takenname',
            'password' => 'secretpw',
            'password_confirmation' => 'secretpw',
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
    it('fails gracefully when SQLite is unavailable', function () {
        config(['database.connections.pz_sqlite.database' => '/nonexistent/path/ZomboidServer.db']);
        DB::purge('pz_sqlite');

        $this->artisan('pz:sync-accounts')
            ->assertFailed();

        // Restore the temp DB so afterEach cleanup works
        config(['database.connections.pz_sqlite.database' => $this->pzDbPath]);
        DB::purge('pz_sqlite');
    });

    it('auto-creates web user from PZ account', function () {
        insertPzAccount('ingame_player', 'gamepass123');

        $this->artisan('pz:sync-accounts')
            ->assertSuccessful();

        $user = User::where('username', 'ingame_player')->first();
        expect($user)->not->toBeNull();
        expect($user->role)->toBe(UserRole::Player);
        expect($user->email)->toBeNull();
        expect(Hash::check('gamepass123', $user->password))->toBeTrue();
    });

    it('links whitelist entry to auto-created user', function () {
        insertPzAccount('linked_player', 'pass123');

        $this->artisan('pz:sync-accounts')
            ->assertSuccessful();

        $user = User::where('username', 'linked_player')->first();
        $entry = WhitelistEntry::where('pz_username', 'linked_player')->first();

        expect($entry)->not->toBeNull();
        expect($entry->user_id)->toBe($user->id);
        expect($entry->pz_password_hash)->toBe('pass123');
        expect($entry->active)->toBeTrue();
        expect($entry->synced_at)->not->toBeNull();
    });

    it('links existing whitelist entry when auto-creating user', function () {
        insertPzAccount('existing_entry', 'pass456');

        // Pre-existing WhitelistEntry without a user_id
        $entry = WhitelistEntry::create([
            'pz_username' => 'existing_entry',
            'pz_password_hash' => 'old_hash',
            'active' => true,
        ]);

        $this->artisan('pz:sync-accounts')
            ->assertSuccessful();

        $user = User::where('username', 'existing_entry')->first();
        expect($user)->not->toBeNull();

        $entry->refresh();
        expect($entry->user_id)->toBe($user->id);
        expect($entry->pz_password_hash)->toBe('pass456');
    });

    it('skips usernames that already exist in users table', function () {
        User::factory()->create(['username' => 'taken_user']);
        insertPzAccount('taken_user', 'gamepass');

        $this->artisan('pz:sync-accounts')
            ->assertSuccessful();

        // Should still be only one user with this username
        expect(User::where('username', 'taken_user')->count())->toBe(1);
    });

    it('detects password change from PZ and syncs to web', function () {
        // User already exists with linked whitelist entry
        $user = User::factory()->create([
            'username' => 'sync_player',
            'password' => Hash::make('oldpass'),
        ]);
        WhitelistEntry::create([
            'user_id' => $user->id,
            'pz_username' => 'sync_player',
            'pz_password_hash' => 'oldpass',
            'active' => true,
            'synced_at' => now()->subDay(),
        ]);

        // PZ password was changed in-game
        insertPzAccount('sync_player', 'newgamepass');

        $this->artisan('pz:sync-accounts')
            ->assertSuccessful();

        $user->refresh();
        expect(Hash::check('newgamepass', $user->password))->toBeTrue();

        $entry = WhitelistEntry::where('pz_username', 'sync_player')->first();
        expect($entry->pz_password_hash)->toBe('newgamepass');
    });

    it('does not update password when unchanged', function () {
        $user = User::factory()->create([
            'username' => 'stable_player',
            'password' => Hash::make('samepass'),
        ]);
        $syncedAt = now()->subDay();
        WhitelistEntry::create([
            'user_id' => $user->id,
            'pz_username' => 'stable_player',
            'pz_password_hash' => 'samepass',
            'active' => true,
            'synced_at' => $syncedAt,
        ]);

        insertPzAccount('stable_player', 'samepass');

        $this->artisan('pz:sync-accounts')
            ->assertSuccessful();

        $entry = WhitelistEntry::where('pz_username', 'stable_player')->first();
        // synced_at should NOT have changed since password is the same
        expect($entry->synced_at->toDateTimeString())->toBe($syncedAt->toDateTimeString());
    });

    it('handles multiple PZ accounts in one sync run', function () {
        insertPzAccount('player_one', 'pass1');
        insertPzAccount('player_two', 'pass2');
        insertPzAccount('player_three', 'pass3');

        $this->artisan('pz:sync-accounts')
            ->assertSuccessful()
            ->expectsOutputToContain('3 created');

        expect(User::whereIn('username', ['player_one', 'player_two', 'player_three'])->count())->toBe(3);
    });
});

describe('Access without email verification', function () {
    it('allows unverified admin to access dashboard', function () {
        $user = User::factory()->unverified()->admin()->create();

        $this->actingAs($user)
            ->get(route('dashboard'))
            ->assertOk();
    });

    it('allows verified admin to access dashboard', function () {
        $user = User::factory()->admin()->create();

        $this->actingAs($user)
            ->get(route('dashboard'))
            ->assertOk();
    });

    it('allows unverified player to change password', function () {
        $user = User::factory()->unverified()->create();

        $this->actingAs($user)
            ->get(route('user-password.edit'))
            ->assertOk();
    });

    it('allows player without email to access portal', function () {
        $user = User::factory()->create(['email' => null, 'email_verified_at' => null]);

        $this->actingAs($user)
            ->get(route('portal'))
            ->assertOk();
    });
});

describe('Password sync to PZ SQLite', function () {
    it('syncs web password change to PZ SQLite', function () {
        insertPzAccount('pw_sync_user', 'original');

        $user = User::factory()->create(['username' => 'pw_sync_user']);
        WhitelistEntry::create([
            'user_id' => $user->id,
            'pz_username' => 'pw_sync_user',
            'pz_password_hash' => 'original',
            'active' => true,
            'synced_at' => now(),
        ]);

        $this->actingAs($user)
            ->from(route('user-password.edit'))
            ->put(route('user-password.update'), [
                'current_password' => 'password',
                'password' => 'newsecret',
                'password_confirmation' => 'newsecret',
            ]);

        // Verify PostgreSQL password updated
        $user->refresh();
        expect(Hash::check('newsecret', $user->password))->toBeTrue();

        // Verify PZ SQLite password updated (PZ hash format)
        $pzAccount = DB::connection('pz_sqlite')
            ->table('whitelist')
            ->where('username', 'pw_sync_user')
            ->first();
        expect(password_verify(md5('newsecret'), $pzAccount->password))->toBeTrue();

        // Verify WhitelistEntry tracking updated
        $entry = WhitelistEntry::where('pz_username', 'pw_sync_user')->first();
        expect(password_verify(md5('newsecret'), $entry->pz_password_hash))->toBeTrue();
    });

    it('updates PostgreSQL even when PZ SQLite is unavailable', function () {
        $user = User::factory()->create(['username' => 'offline_user']);

        $this->actingAs($user)
            ->from(route('user-password.edit'))
            ->put(route('user-password.update'), [
                'current_password' => 'password',
                'password' => 'newpass1!',
                'password_confirmation' => 'newpass1!',
            ])
            ->assertSessionHasNoErrors();

        // PostgreSQL password should still be updated
        $user->refresh();
        expect(Hash::check('newpass1!', $user->password))->toBeTrue();
    });
});
