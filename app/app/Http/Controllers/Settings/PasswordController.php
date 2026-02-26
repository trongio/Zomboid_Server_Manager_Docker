<?php

namespace App\Http\Controllers\Settings;

use App\Http\Controllers\Controller;
use App\Http\Requests\Settings\PasswordUpdateRequest;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Inertia\Inertia;
use Inertia\Response;

class PasswordController extends Controller
{
    /**
     * Show the user's password settings page.
     */
    public function edit(): Response
    {
        return Inertia::render('settings/password');
    }

    /**
     * Update the user's password and sync to PZ SQLite.
     */
    public function update(PasswordUpdateRequest $request): RedirectResponse
    {
        $user = $request->user();

        $user->update([
            'password' => $request->password,
        ]);

        // Sync plain text password to PZ SQLite
        $this->syncPzPassword($user->username, $request->password);

        return back();
    }

    /**
     * Update the plain text password in PZ's SQLite whitelist.
     */
    private function syncPzPassword(string $username, string $password): void
    {
        try {
            DB::connection('pz_sqlite')
                ->table('whitelist')
                ->where('username', $username)
                ->update(['password' => $password]);

            // Also update the tracked hash in PostgreSQL
            $user = \App\Models\User::where('username', $username)->first();
            if ($user) {
                $user->whitelistEntries()
                    ->where('pz_username', $username)
                    ->update([
                        'pz_password_hash' => $password,
                        'synced_at' => now(),
                    ]);
            }
        } catch (\Exception $e) {
            Log::warning('Failed to sync password to PZ SQLite', [
                'username' => $username,
                'error' => $e->getMessage(),
            ]);
        }
    }
}
