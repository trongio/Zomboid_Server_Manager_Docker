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
            // Load JSON file defaults
            $defaults = self::loadJsonFile($locale);

            // Fall back to English defaults if the requested locale file doesn't exist
            if (empty($defaults) && $locale !== 'en') {
                $defaults = self::loadJsonFile('en');
            }

            // Overlay DB overrides
            $overrides = Translation::query()
                ->where('locale', $locale)
                ->whereNull('group')
                ->pluck('value', 'key')
                ->all();

            return array_merge($defaults, $overrides);
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
        $path = lang_path("{$locale}.json");

        if (! file_exists($path)) {
            return [];
        }

        $contents = file_get_contents($path);

        if ($contents === false) {
            return [];
        }

        return json_decode($contents, true) ?: [];
    }
}
