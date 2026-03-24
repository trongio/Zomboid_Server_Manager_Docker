<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * Validates that a value is safe for use in PZ config files (server.ini, SandboxVars.lua).
 * Uses an allowlist approach to prevent Lua code injection and INI newline injection.
 *
 * Use allowBackslash: true for INI files (B42 mod IDs use backslashes).
 * Keep allowBackslash: false for Lua files (backslashes are escape characters).
 */
class SafeConfigValue implements ValidationRule
{
    /** Safe characters WITHOUT backslash (for Lua config values). */
    private const SAFE_PATTERN = '/^[a-zA-Z0-9 ,.:;\/\-_=+@#!%^*\[\]\'?]+$/';

    /** Safe characters WITH backslash (for INI config values — B42 mod IDs use \). */
    private const SAFE_PATTERN_WITH_BACKSLASH = '/^[a-zA-Z0-9 ,.:;\/\\\\\-_=+@#!%^*\[\]\'?]+$/';

    public function __construct(
        private readonly bool $allowBackslash = false,
    ) {}

    /**
     * @param  \Closure(string, ?string=): \Illuminate\Translation\PotentiallyTranslatedString  $fail
     */
    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        // Reject non-scalar values (arrays/objects cast to "Array"/"Object" string)
        if (is_array($value) || is_object($value)) {
            $fail('The :attribute must be a scalar value.');

            return;
        }

        $str = (string) $value;

        // Allow empty values (PZ uses empty values like Password=)
        if ($str === '') {
            return;
        }

        // Reject Lua concatenation operator
        if (str_contains($str, '..')) {
            $fail('The :attribute contains unsafe characters for config files.');

            return;
        }

        // Allowlist: only safe characters permitted
        $pattern = $this->allowBackslash ? self::SAFE_PATTERN_WITH_BACKSLASH : self::SAFE_PATTERN;
        if (! preg_match($pattern, $str)) {
            $fail('The :attribute contains unsafe characters for config files.');
        }
    }
}
