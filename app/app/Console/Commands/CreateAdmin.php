<?php

namespace App\Console\Commands;

use App\Enums\UserRole;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class CreateAdmin extends Command
{
    /** @var string */
    protected $signature = 'zomboid:create-admin
        {--username= : Admin username}
        {--email= : Admin email address}
        {--password= : Admin password}';

    /** @var string */
    protected $description = 'Create or update the super admin user';

    public function handle(): int
    {
        $username = $this->option('username') ?: config('zomboid.admin.username');
        $password = $this->option('password') ?: config('zomboid.admin.password');
        $email = $this->option('email') ?: config('zomboid.admin.email') ?: null;

        if (empty($username) || empty($password)) {
            $this->error('Username and password are required. Provide via --username/--password options or ADMIN_USERNAME/ADMIN_PASSWORD env vars.');

            return self::FAILURE;
        }

        $existing = User::where('role', UserRole::SuperAdmin)->first();

        if ($existing) {
            $existing->update([
                'username' => $username,
                'name' => $username,
                'email' => $email,
                'password' => $password,
            ]);

            if ($email) {
                $existing->forceFill(['email_verified_at' => now()])->save();
            }

            Log::info('Super admin user updated', ['username' => $username]);
            $this->info("Super admin '{$username}' updated successfully.");

            return self::SUCCESS;
        }

        $user = User::create([
            'username' => $username,
            'name' => $username,
            'email' => $email,
            'password' => $password,
            'role' => UserRole::SuperAdmin,
        ]);

        if ($email) {
            $user->forceFill(['email_verified_at' => now()])->save();
        }

        Log::info('Super admin user created', ['username' => $username]);
        $this->info("Super admin '{$username}' created successfully.");

        return self::SUCCESS;
    }
}
