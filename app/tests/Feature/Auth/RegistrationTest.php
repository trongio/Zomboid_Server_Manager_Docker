<?php

namespace Tests\Feature\Auth;

use App\Models\WhitelistEntry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class RegistrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_registration_screen_can_be_rendered()
    {
        $response = $this->get(route('register'));

        $response->assertOk();
    }

    public function test_new_users_can_register()
    {
        $response = $this->post(route('register.store'), [
            'username' => 'testplayer',
            'password' => 'P@ssw0rd!2024x',
            'password_confirmation' => 'P@ssw0rd!2024x',
        ]);

        $this->assertAuthenticated();
        $response->assertRedirect(route('portal', absolute: false));
    }

    public function test_registration_creates_whitelist_entry()
    {
        $this->post(route('register.store'), [
            'username' => 'testplayer',
            'password' => 'P@ssw0rd!2024x',
            'password_confirmation' => 'P@ssw0rd!2024x',
        ]);

        $this->assertAuthenticated();

        $this->assertDatabaseHas('whitelist_entries', [
            'pz_username' => 'testplayer',
            'active' => true,
        ]);

        $entry = WhitelistEntry::where('pz_username', 'testplayer')->first();
        $this->assertNotNull($entry->user_id);
        $this->assertEquals('P@ssw0rd!2024x', $entry->pz_password_hash);
    }

    public function test_registration_with_optional_email()
    {
        $response = $this->post(route('register.store'), [
            'username' => 'emailplayer',
            'email' => 'player@example.com',
            'password' => 'P@ssw0rd!2024x',
            'password_confirmation' => 'P@ssw0rd!2024x',
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
            'password' => 'P@ssw0rd!2024x',
            'password_confirmation' => 'P@ssw0rd!2024x',
        ]);

        // Log out so we can attempt a second registration
        $this->post(route('logout'));

        $response = $this->post(route('register.store'), [
            'username' => 'takenname',
            'password' => 'P@ssw0rd!2024x',
            'password_confirmation' => 'P@ssw0rd!2024x',
        ]);

        $response->assertSessionHasErrors('username');
    }

    public function test_registration_validates_username_format()
    {
        $response = $this->post(route('register.store'), [
            'username' => 'invalid user!',
            'password' => 'P@ssw0rd!2024x',
            'password_confirmation' => 'P@ssw0rd!2024x',
        ]);

        $response->assertSessionHasErrors('username');
    }

    public function test_registration_rejects_short_username()
    {
        $response = $this->post(route('register.store'), [
            'username' => 'ab',
            'password' => 'P@ssw0rd!2024x',
            'password_confirmation' => 'P@ssw0rd!2024x',
        ]);

        $response->assertSessionHasErrors('username');
    }
}
