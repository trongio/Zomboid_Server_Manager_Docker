<?php

namespace App\Concerns;

use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

trait ProfileValidationRules
{
    /**
     * Get the validation rules used to validate user profiles.
     *
     * @return array<string, array<int, \Illuminate\Contracts\Validation\Rule|array<mixed>|string>>
     */
    protected function profileRules(?int $userId = null): array
    {
        return [
            'name' => $this->nameRules(),
            'email' => $this->emailRules($userId),
        ];
    }

    /**
     * Get the validation rules used to validate registration.
     *
     * @return array<string, array<int, \Illuminate\Contracts\Validation\Rule|array<mixed>|string>>
     */
    protected function registrationRules(): array
    {
        return [
            'username' => $this->usernameRules(),
            'email' => $this->optionalEmailRules(),
        ];
    }

    /**
     * Get the validation rules used to validate usernames.
     *
     * @return array<int, \Illuminate\Contracts\Validation\Rule|array<mixed>|string>
     */
    protected function usernameRules(?int $userId = null): array
    {
        return [
            'required',
            'string',
            'min:3',
            'max:50',
            'regex:/^[a-zA-Z0-9_]+$/',
            $userId === null
                ? Rule::unique(User::class)
                : Rule::unique(User::class)->ignore($userId),
            function (string $attribute, mixed $value, \Closure $fail) {
                if ($this->usernameExistsInPzSqlite($value)) {
                    $fail('This username is already taken on the game server.');
                }
            },
        ];
    }

    /**
     * Get the validation rules used to validate user names.
     *
     * @return array<int, \Illuminate\Contracts\Validation\Rule|array<mixed>|string>
     */
    protected function nameRules(): array
    {
        return ['required', 'string', 'max:255'];
    }

    /**
     * Get the validation rules used to validate user emails.
     *
     * @return array<int, \Illuminate\Contracts\Validation\Rule|array<mixed>|string>
     */
    protected function emailRules(?int $userId = null): array
    {
        return [
            'required',
            'string',
            'email',
            'max:255',
            $userId === null
                ? Rule::unique(User::class)
                : Rule::unique(User::class)->ignore($userId),
        ];
    }

    /**
     * Get validation rules for optional email (registration).
     *
     * @return array<int, \Illuminate\Contracts\Validation\Rule|array<mixed>|string>
     */
    protected function optionalEmailRules(?int $userId = null): array
    {
        return [
            'nullable',
            'string',
            'email',
            'max:255',
            $userId === null
                ? Rule::unique(User::class)
                : Rule::unique(User::class)->ignore($userId),
        ];
    }

    /**
     * Check if a username already exists in PZ's SQLite whitelist.
     */
    protected function usernameExistsInPzSqlite(string $username): bool
    {
        try {
            return DB::connection('pz_sqlite')
                ->table('whitelist')
                ->where('username', $username)
                ->exists();
        } catch (\Exception) {
            // SQLite DB may not be available in test/dev
            return false;
        }
    }
}
