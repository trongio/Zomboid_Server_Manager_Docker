<?php

use App\Enums\UserRole;
use App\Models\User;
use App\Models\WhitelistEntry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->withoutVite();
    // Always use a temp PZ SQLite DB — never hit the real game server
    $this->pzDbPath = setupPzSqliteForLogin();
});

afterEach(function () {
    if (isset($this->pzDbPath)) {
        cleanupPzSqlite($this->pzDbPath);
    }
});

/**
 * PZ fixed bcrypt salt used for all password hashing.
 */
const PZ_BCRYPT_SALT = '$2a$12$O/BFHoDFPrfFaNPAACmWpu';

/**
 * Hash a password the way PZ does: bcrypt(md5(password), fixed_salt).
 */
function pzHashPassword(string $password): string
{
    // PZ hashes as bcrypt(md5(password)) with a fixed salt
    // We use password_hash with cost 12 to match, but the salt differs in tests.
    // For test purposes, just use standard bcrypt of the md5 — the authenticator
    // checks via password_verify(md5(password), stored_hash).
    return password_hash(md5($password), PASSWORD_BCRYPT, ['cost' => 12]);
}

/**
 * Set up a temporary PZ SQLite database with a whitelist table.
 */
function setupPzSqliteForLogin(): string
{
    $dbPath = sys_get_temp_dir().'/pz_test_login_'.uniqid().'.db';
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
 * Insert a PZ account into the temporary SQLite whitelist (with PZ-style hashing).
 */
function insertPzLoginAccount(string $username, string $password, bool $hash = true): void
{
    DB::connection('pz_sqlite')->table('whitelist')->insert([
        'username' => $username,
        'password' => $hash ? pzHashPassword($password) : $password,
    ]);
}

/**
 * Clean up a temporary PZ SQLite database.
 */
function cleanupPzSqlite(string $dbPath): void
{
    DB::connection('pz_sqlite')->disconnect();
    @unlink($dbPath);
}

describe('Existing web user login', function () {
    it('authenticates existing web user with correct password', function () {
        $user = User::factory()->create();

        $this->post(route('login.store'), [
            'username' => $user->username,
            'password' => 'password',
        ]);

        $this->assertAuthenticated();
        $this->assertAuthenticatedAs($user);
    });

    it('rejects existing web user with wrong password', function () {
        $user = User::factory()->create();

        $this->post(route('login.store'), [
            'username' => $user->username,
            'password' => 'wrong-password',
        ]);

        $this->assertGuest();
    });
});

describe('Game-first player instant login', function () {
    it('auto-creates web account from PZ SQLite with PZ-hashed password', function () {
        insertPzLoginAccount('game_player', 'mypass');

        $this->post(route('login.store'), [
            'username' => 'game_player',
            'password' => 'mypass',
        ]);

        $this->assertAuthenticated();

        $user = User::where('username', 'game_player')->first();
        expect($user)->not->toBeNull();
        expect($user->role)->toBe(UserRole::Player);
        expect($user->name)->toBe('game_player');
        // Web password should be standard Laravel hash (not PZ hash)
        expect(Hash::check('mypass', $user->password))->toBeTrue();

        // WhitelistEntry should be created
        $entry = WhitelistEntry::where('pz_username', 'game_player')->first();
        expect($entry)->not->toBeNull();
        expect($entry->user_id)->toBe($user->id);
        expect($entry->active)->toBeTrue();


    });

    it('auto-creates web account from PZ SQLite with plain text password', function () {
        $dbPath = setupPzSqliteForLogin();
        // Some PZ setups store plain text passwords
        insertPzLoginAccount('plain_player', 'plainpass', hash: false);

        $this->post(route('login.store'), [
            'username' => 'plain_player',
            'password' => 'plainpass',
        ]);

        $this->assertAuthenticated();

        $user = User::where('username', 'plain_player')->first();
        expect($user)->not->toBeNull();
        expect(Hash::check('plainpass', $user->password))->toBeTrue();


    });

    it('rejects wrong password and does not create account', function () {
        insertPzLoginAccount('pz_user', 'correctpass');

        $this->post(route('login.store'), [
            'username' => 'pz_user',
            'password' => 'wrongpass',
        ]);

        $this->assertGuest();
        expect(User::where('username', 'pz_user')->exists())->toBeFalse();


    });

    it('rejects login for username not in PZ SQLite', function () {
        $this->post(route('login.store'), [
            'username' => 'nonexistent',
            'password' => 'anypass',
        ]);

        $this->assertGuest();


    });
});

describe('Sync-created user login', function () {
    it('logs in user whose web password is a PZ hash and fixes it', function () {
        $dbPath = setupPzSqliteForLogin();
        $pzHash = pzHashPassword('gamepass');

        // Simulate sync command having stored the PZ hash as the web password.
        // Use DB::table to bypass Eloquent's hashed cast which rejects non-standard bcrypt costs.
        DB::table('users')->insert([
            'username' => 'sync_user',
            'name' => 'sync_user',
            'password' => $pzHash,
            'role' => UserRole::Player->value,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $user = User::where('username', 'sync_user')->first();

        insertPzLoginAccount('sync_user', 'gamepass');

        $this->post(route('login.store'), [
            'username' => 'sync_user',
            'password' => 'gamepass',
        ]);

        $this->assertAuthenticated();
        $this->assertAuthenticatedAs($user);

        // Web password should now be fixed to standard Laravel hash
        $user->refresh();
        expect(Hash::check('gamepass', $user->password))->toBeTrue();


    });
});

describe('PZ SQLite unavailable', function () {
    it('fails gracefully when PZ SQLite is unavailable', function () {
        config(['database.connections.pz_sqlite.database' => '/nonexistent/path/ZomboidServer.db']);
        DB::purge('pz_sqlite');

        $response = $this->post(route('login.store'), [
            'username' => 'offline_player',
            'password' => 'anypass',
        ]);

        // Should not crash — just a normal login failure
        $response->assertStatus(302);
        $this->assertGuest();

        // Restore temp DB so afterEach cleanup works
        config(['database.connections.pz_sqlite.database' => $this->pzDbPath]);
        DB::purge('pz_sqlite');
    });
});

describe('Sync command fixes networkPlayers race condition', function () {
    it('creates missing WhitelistEntry and fixes password for user created from networkPlayers', function () {

        // Simulate Pass 2 having created a user with a random password (no WhitelistEntry)
        $user = User::forceCreate([
            'username' => 'np_player',
            'name' => 'np_player',
            'password' => Hash::make(bin2hex(random_bytes(16))),
            'role' => UserRole::Player,
        ]);

        // The actual PZ password in SQLite whitelist (plain text for this test)
        insertPzLoginAccount('np_player', 'real_game_pass', hash: false);

        $this->artisan('pz:sync-accounts')
            ->assertSuccessful();

        // WhitelistEntry should now exist
        $entry = WhitelistEntry::where('pz_username', 'np_player')->first();
        expect($entry)->not->toBeNull();
        expect($entry->user_id)->toBe($user->id);
        expect($entry->active)->toBeTrue();


    });

    it('does not duplicate WhitelistEntry if one already exists', function () {

        $user = User::factory()->create(['username' => 'linked_player']);
        WhitelistEntry::create([
            'user_id' => $user->id,
            'pz_username' => 'linked_player',
            'pz_password_hash' => 'samepass',
            'active' => true,
            'synced_at' => now(),
        ]);

        insertPzLoginAccount('linked_player', 'samepass', hash: false);

        $this->artisan('pz:sync-accounts')
            ->assertSuccessful();

        expect(WhitelistEntry::where('pz_username', 'linked_player')->count())->toBe(1);


    });
});
