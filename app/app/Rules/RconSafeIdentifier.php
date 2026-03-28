<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Validates that a string matches a safe RCON identifier format.
 * Supports three modes: 'player' (alphanumeric + underscore), 'item' (+ dots),
 * and 'skill' (alphanumeric only).
 */
class RconSafeIdentifier implements ValidationRule
{
    private const PATTERNS = [
        'player' => '/^[a-zA-Z0-9_]{1,50}$/',
        'item' => '/^[a-zA-Z0-9_.]{1,100}$/',
        'skill' => '/^[a-zA-Z0-9]{1,50}$/',
    ];

    public function __construct(
        private readonly string $type = 'player',
    ) {}

    /**
     * @param  \Closure(string, ?string=): \Illuminate\Translation\PotentiallyTranslatedString  $fail
     */
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        $pattern = self::PATTERNS[$this->type] ?? self::PATTERNS['player'];

        if (! preg_match($pattern, (string) $value)) {
            $fail($this->message());
        }
    }

    private function message(): string
    {
        return match ($this->type) {
            'item' => 'The :attribute must contain only letters, numbers, dots, and underscores.',
            'skill' => 'The :attribute must contain only letters and numbers.',
            default => 'The :attribute must contain only letters, numbers, and underscores.',
        };
    }
}
