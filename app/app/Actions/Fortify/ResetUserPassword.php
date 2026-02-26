<?php

namespace App\Actions\Fortify;

use App\Concerns\PasswordValidationRules;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Validator;
use Laravel\Fortify\Contracts\ResetsUserPasswords;

class ResetUserPassword implements ResetsUserPasswords
{
    use PasswordValidationRules;

    /**
     * Validate and reset the user's forgotten password.
     *
     * @param  array<string, string>  $input
     */
    public function reset(User $user, array $input): void
    {
        Validator::make($input, [
            'password' => $this->passwordRules(),
        ])->validate();

        $user->forceFill([
            'password' => $input['password'],
        ])->save();

        // Sync plain text password to PZ SQLite
        $this->syncPzPassword($user->username, $input['password']);
    }

    private function syncPzPassword(string $username, string $password): void
    {
        try {
            DB::connection('pz_sqlite')
                ->table('whitelist')
                ->where('username', $username)
                ->update(['password' => $password]);

            $user = User::where('username', $username)->first();
            $user?->whitelistEntries()
                ->where('pz_username', $username)
                ->update([
                    'pz_password_hash' => $password,
                    'synced_at' => now(),
                ]);
        } catch (\Exception $e) {
            Log::warning('Failed to sync reset password to PZ SQLite', [
                'username' => $username,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
