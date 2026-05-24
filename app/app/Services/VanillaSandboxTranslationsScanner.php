<?php

namespace App\Services;

/**
 * Reads PZ's bundled vanilla sandbox translations from
 * `<game>/media/lua/shared/Translate/<LANG>/Sandbox.json`.
 *
 * Unlike the mod-supplied `Sandbox_<LANG>.txt` (a quoted lua-table), the
 * vanilla file is a flat JSON document with three key shapes:
 *
 *   "Sandbox_<Key>"            -> human label
 *   "Sandbox_<Key>_tooltip"    -> hover description
 *   "Sandbox_<Key>_option<N>"  -> enum option label
 *
 * Unlike mods, vanilla keys are top-level (no `Namespace_` prefix), so we
 * return a flat `[key => {label, tooltip, options}]` map keyed by option
 * name (eg. `Zombies`, `Distribution`).
 */
class VanillaSandboxTranslationsScanner
{
    private const SEARCH_ROOTS = [
        '/pz-server/media/lua/shared/Translate',
        '/home/steam/ZomboidDedicatedServer/media/lua/shared/Translate',
    ];

    /**
     * @return array<string, array{label?: string, tooltip?: string, options?: array<int, string>}>
     */
    public function collect(string $preferredLocale = 'EN'): array
    {
        $paths = [];
        foreach (self::SEARCH_ROOTS as $root) {
            foreach ([$preferredLocale, 'EN'] as $locale) {
                $candidate = $root.'/'.$locale.'/Sandbox.json';
                if (is_readable($candidate) && ! in_array($candidate, $paths, true)) {
                    $paths[] = $candidate;
                }
            }
            if ($paths !== []) {
                break; // first valid root wins; locale fallback already handled inside
            }
        }

        $result = [];
        foreach ($paths as $path) {
            foreach ($this->parseFile($path) as $key => $entry) {
                if (! isset($result[$key])) {
                    $result[$key] = $entry;
                } else {
                    $result[$key] = $entry + $result[$key];
                }
            }
        }

        return $result;
    }

    /**
     * Strict locale loader. Unlike {@see self::collect()} this does
     * NOT fall back to EN — useful when building per-locale overlays
     * that should only carry entries the locale itself provides.
     *
     * @return array<string, array{label?: string, tooltip?: string, options?: array<int, string>}>
     */
    public function collectStrict(string $locale): array
    {
        foreach (self::SEARCH_ROOTS as $root) {
            $candidate = $root.'/'.$locale.'/Sandbox.json';
            if (is_readable($candidate)) {
                return $this->parseFile($candidate);
            }
        }

        return [];
    }

    /**
     * @return array<string, array{label?: string, tooltip?: string, options?: array<int, string>}>
     */
    public function parseFile(string $path): array
    {
        if (! is_readable($path)) {
            return [];
        }
        $raw = @file_get_contents($path);
        if (! is_string($raw)) {
            return [];
        }
        $data = json_decode($raw, true);
        if (! is_array($data)) {
            return [];
        }

        $result = [];
        foreach ($data as $rawKey => $value) {
            if (! is_string($rawKey) || ! is_string($value)) {
                continue;
            }
            if (! str_starts_with($rawKey, 'Sandbox_')) {
                continue;
            }
            $remainder = substr($rawKey, strlen('Sandbox_'));

            if (preg_match('/^([A-Za-z][A-Za-z0-9]*)_option(\d+)$/', $remainder, $m)) {
                $key = $m[1];
                $optionIndex = (int) $m[2];
                if (! isset($result[$key])) {
                    $result[$key] = [];
                }
                if (! isset($result[$key]['options'])) {
                    $result[$key]['options'] = [];
                }
                $result[$key]['options'][$optionIndex] = $this->normaliseLabel($value);

                continue;
            }
            if (preg_match('/^([A-Za-z][A-Za-z0-9]*)_tooltip$/', $remainder, $m)) {
                $key = $m[1];
                if (! isset($result[$key])) {
                    $result[$key] = [];
                }
                $result[$key]['tooltip'] = $this->normaliseLabel($value);

                continue;
            }
            if (preg_match('/^([A-Za-z][A-Za-z0-9]*)$/', $remainder, $m)) {
                $key = $m[1];
                if (! isset($result[$key])) {
                    $result[$key] = [];
                }
                $result[$key]['label'] = $this->normaliseLabel($value);
            }
        }

        return $result;
    }

    private function normaliseLabel(string $value): string
    {
        $value = preg_replace('/<\s*br\s*\/?>/i', "\n", $value) ?? $value;
        $value = preg_replace('/<\s*LINE\s*>/i', "\n", $value) ?? $value;

        return rtrim($value, " :\t");
    }
}
