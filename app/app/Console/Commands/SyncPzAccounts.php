<?php

namespace App\Console\Commands;

use App\Enums\UserRole;
use App\Models\User;
use App\Models\WhitelistEntry;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;

class SyncPzAccounts extends Command
{
    /** @var string */
    protected $signature = 'pz:sync-accounts';

    /** @var string */
    protected $description = 'Sync PZ game accounts from SQLite to web users';

    public function handle(): int
    {
        try {
            $pzAccounts = DB::connection('pz_sqlite')
                ->table('whitelist')
                ->select('username', 'password')
                ->get();
        } catch (\Exception $e) {
            $this->error('Failed to connect to PZ SQLite: '.$e->getMessage());

            return self::FAILURE;
        }

        $created = 0;
        $synced = 0;
        $passwordUpdated = 0;

        foreach ($pzAccounts as $account) {
            $existingUser = User::where('username', $account->username)->first();

            if ($existingUser) {
                // Check if PZ password changed (compare plain text)
                $entry = $existingUser->whitelistEntries()
                    ->where('pz_username', $account->username)
                    ->first();

                if ($entry && $entry->pz_password_hash !== $account->password) {
                    // PZ password was changed in-game — update web password
                    $existingUser->update([
                        'password' => Hash::make($account->password),
                    ]);

                    $entry->update([
                        'pz_password_hash' => $account->password,
                        'synced_at' => now(),
                    ]);

                    $passwordUpdated++;

                    Log::info('Synced PZ password change to web', [
                        'username' => $account->username,
                    ]);
                }

                $synced++;

                continue;
            }

            // New PZ account — auto-create web user
            $user = User::create([
                'username' => $account->username,
                'name' => $account->username,
                'password' => Hash::make($account->password),
                'role' => UserRole::Player,
            ]);

            // Link or create whitelist entry
            $entry = WhitelistEntry::where('pz_username', $account->username)->first();

            if ($entry) {
                $entry->update([
                    'user_id' => $user->id,
                    'pz_password_hash' => $account->password,
                    'synced_at' => now(),
                ]);
            } else {
                WhitelistEntry::create([
                    'user_id' => $user->id,
                    'pz_username' => $account->username,
                    'pz_password_hash' => $account->password,
                    'active' => true,
                    'synced_at' => now(),
                ]);
            }

            $created++;

            Log::info('Auto-created web user from PZ account', [
                'username' => $account->username,
            ]);
        }

        $this->info("Sync complete: {$created} created, {$synced} existing, {$passwordUpdated} passwords updated.");

        return self::SUCCESS;
    }
}
