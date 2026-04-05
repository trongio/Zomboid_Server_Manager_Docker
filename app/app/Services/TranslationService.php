<?php

namespace App\Services;

use App\Models\Translation;
use Illuminate\Support\Facades\Cache;

class TranslationService
{
    /**
     * Get all translations for a locale, merging JSON file defaults with DB overrides.
     *
     * @return array<string, string>
     */
    public static function getForLocale(string $locale): array
    {
        return Cache::remember("translations.{$locale}", 3600, function () use ($locale) {
            // Always start from English as the base (fallback for all untranslated keys)
            $result = self::loadJsonFile('en');

            // Overlay the requested locale's JSON file (if different from English)
            if ($locale !== 'en') {
                $localeDefaults = self::loadJsonFile($locale);
                if (! empty($localeDefaults)) {
                    $result = array_merge($result, $localeDefaults);
                }
            }

            // Overlay DB overrides for this locale
            $overrides = Translation::query()
                ->where('locale', $locale)
                ->whereNull('group')
                ->pluck('value', 'key')
                ->all();

            return array_merge($result, $overrides);
        });
    }

    /**
     * Clear cached translations for a locale (or all locales).
     */
    public static function bustCache(?string $locale = null): void
    {
        if ($locale) {
            Cache::forget("translations.{$locale}");
        } else {
            // Clear all known locale caches
            $locales = Translation::query()->distinct()->pluck('locale')->all();
            foreach ($locales as $loc) {
                Cache::forget("translations.{$loc}");
            }
            // Also clear common ones
            Cache::forget('translations.en');
        }
    }

    /**
     * Get all known translation keys from the English JSON file.
     *
     * @return array<int, string>
     */
    public static function allKeys(): array
    {
        $defaults = self::loadJsonFile('en');

        return array_keys($defaults);
    }

    /**
     * @return array<string, string>
     */
    private static function loadJsonFile(string $locale): array
    {
        if (! self::isValidLocale($locale)) {
            return [];
        }

        $langDirectory = realpath(lang_path());

        if ($langDirectory === false) {
            return [];
        }

        $path = $langDirectory.DIRECTORY_SEPARATOR.$locale.'.json';

        if (! file_exists($path)) {
            return [];
        }

        $resolvedPath = realpath($path);

        if ($resolvedPath === false || ! str_starts_with($resolvedPath, $langDirectory.DIRECTORY_SEPARATOR)) {
            return [];
        }

        $contents = file_get_contents($resolvedPath);

        if ($contents === false) {
            return [];
        }

        return json_decode($contents, true) ?: [];
    }

    private static function isValidLocale(string $locale): bool
    {
        return $locale !== '' && strlen($locale) <= 10 && preg_match('/\A[a-zA-Z0-9_-]+\z/', $locale);
    }
}
