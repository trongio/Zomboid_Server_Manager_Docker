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
            $pzPassword = $account->password;
            $isBcrypt = str_starts_with($pzPassword, '$2');

            $existingUser = User::where('username', $account->username)->first();

            if ($existingUser) {
                // Check if PZ password changed
                $entry = $existingUser->whitelistEntries()
                    ->where('pz_username', $account->username)
                    ->first();

                if (! $entry) {
                    // User exists but has no WhitelistEntry (created by networkPlayers pass
                    // with a random password). Create the missing entry and fix the password.
                    WhitelistEntry::create([
                        'user_id' => $existingUser->id,
                        'pz_username' => $account->username,
                        'pz_password_hash' => $pzPassword,
                        'active' => true,
                        'synced_at' => now(),
                    ]);

                    $existingUser->forceFill([
                        'password' => $isBcrypt ? $pzPassword : Hash::make($pzPassword),
                    ])->save();

                    $passwordUpdated++;

                    Log::info('Fixed user created from networkPlayers — linked whitelist entry and updated password', [
                        'username' => $account->username,
                    ]);
                } elseif ($entry->pz_password_hash !== $pzPassword) {
                    // PZ password was changed — update web password
                    // PZ stores bcrypt hashes, so use directly; otherwise hash plain text
                    $existingUser->forceFill([
                        'password' => $isBcrypt ? $pzPassword : Hash::make($pzPassword),
                    ])->save();

                    $entry->update([
                        'pz_password_hash' => $pzPassword,
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
            // PZ stores bcrypt hashes, so use directly; otherwise hash plain text
            $user = User::forceCreate([
                'username' => $account->username,
                'name' => $account->username,
                'password' => $isBcrypt ? $pzPassword : Hash::make($pzPassword),
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

        $this->info("Whitelist sync: {$created} created, {$synced} existing, {$passwordUpdated} passwords updated.");

        // Second pass: sync players from players.db (networkPlayers table)
        $playersCreated = 0;

        try {
            $networkPlayers = DB::connection('pz_players')
                ->table('networkPlayers')
                ->select('username', 'name')
                ->get();

            foreach ($networkPlayers as $player) {
                $username = $player->username;

                $user = User::firstOrCreate(
                    ['username' => $username],
                    [
                        'name' => $player->name ?: $username,
                        'password' => Hash::make(bin2hex(random_bytes(16))),
                        'role' => UserRole::Player,
                    ]
                );

                if ($user->wasRecentlyCreated) {
                    $playersCreated++;

                    Log::info('Auto-created web user from networkPlayers', [
                        'username' => $username,
                    ]);
                }
            }

            $this->info("Network players sync: {$playersCreated} new players discovered.");
        } catch (\Exception $e) {
            $this->warn('Could not read players.db: '.$e->getMessage());
        }

        return self::SUCCESS;
    }
}
