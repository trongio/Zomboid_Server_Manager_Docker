<?php

namespace Tests\Feature\Auth;

use App\Models\WhitelistEntry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class RegistrationTest extends TestCase
{
    use RefreshDatabase;

    private string $pzDbPath;

    protected function setUp(): void
    {
        parent::setUp();

        // Always use a temp PZ SQLite DB — never hit the real game server
        $this->pzDbPath = sys_get_temp_dir().'/pz_test_reg_'.uniqid().'.db';
        touch($this->pzDbPath);

        config(['database.connections.pz_sqlite.database' => $this->pzDbPath]);
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
    }

    protected function tearDown(): void
    {
        DB::connection('pz_sqlite')->disconnect();
        @unlink($this->pzDbPath);

        parent::tearDown();
    }

    public function test_registration_screen_can_be_rendered()
    {
        $response = $this->get(route('register'));

        $response->assertOk();
    }

    public function test_new_users_can_register()
    {
        $response = $this->post(route('register.store'), [
            'username' => 'testplayer',
            'password' => 'secret',
            'password_confirmation' => 'secret',
        ]);

        $this->assertAuthenticated();
        $response->assertRedirect(route('portal', absolute: false));
    }

    public function test_registration_creates_whitelist_entry()
    {
        $this->post(route('register.store'), [
            'username' => 'testplayer',
            'password' => 'secret',
            'password_confirmation' => 'secret',
        ]);

        $this->assertAuthenticated();

        $this->assertDatabaseHas('whitelist_entries', [
            'pz_username' => 'testplayer',
            'active' => true,
        ]);

        $entry = WhitelistEntry::where('pz_username', 'testplayer')->first();
        $this->assertNotNull($entry->user_id);
        $this->assertNotNull($entry->pz_password_hash);
        $this->assertTrue(str_starts_with($entry->pz_password_hash, '$2'));
    }

    public function test_registration_with_optional_email()
    {
        $response = $this->post(route('register.store'), [
            'username' => 'emailplayer',
            'email' => 'player@example.com',
            'password' => 'secret',
            'password_confirmation' => 'secret',
        ]);

        $this->assertAuthenticated();
        $this->assertDatabaseHas('users', [
            'username' => 'emailplayer',
            'email' => 'player@example.com',
        ]);
    }

    public function test_registration_rejects_duplicate_username()
    {
        $this->post(route('register.store'), [
            'username' => 'takenname',
            'password' => 'secret',
            'password_confirmation' => 'secret',
        ]);

        // Log out so we can attempt a second registration
        $this->post(route('logout'));

        $response = $this->post(route('register.store'), [
            'username' => 'takenname',
            'password' => 'secret',
            'password_confirmation' => 'secret',
        ]);

        $response->assertSessionHasErrors('username');
    }

    public function test_registration_validates_username_format()
    {
        $response = $this->post(route('register.store'), [
            'username' => 'invalid user!',
            'password' => 'secret',
            'password_confirmation' => 'secret',
        ]);

        $response->assertSessionHasErrors('username');
    }

    public function test_registration_rejects_short_username()
    {
        $response = $this->post(route('register.store'), [
            'username' => 'ab',
            'password' => 'secret',
            'password_confirmation' => 'secret',
        ]);

        $response->assertSessionHasErrors('username');
    }
}
