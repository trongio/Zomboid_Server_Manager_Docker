<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Validates that a string is safe for use in RCON command arguments.
 * Rejects double quotes and newlines that could break RCON command boundaries.
 */
class RconSafeMessage implements ValidationRule
{
    /**
     * @param  \Closure(string, ?string=): \Illuminate\Translation\PotentiallyTranslatedString  $fail
     */
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (preg_match('/["\n\r]/', (string) $value)) {
            $fail('The :attribute must not contain double quotes or newlines.');
        }
    }
}
