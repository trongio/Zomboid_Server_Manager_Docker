<?php

namespace App\Services;

use Illuminate\Support\Facades\Storage;

/**
 * Read-only accessor for the JSON catalog written by
 * `php artisan zomboid:sync-config-catalog`.
 *
 * The catalog enriches the hard-coded `config-metadata.ts` with PZ-supplied
 * descriptions, Min/Max hints and enum labels (which the game embeds as
 * comments inside `<NAME>_SandboxVars.lua` every time it boots).
 *
 * Empty arrays are returned when the file is missing — the controller passes
 * them through to the UI which falls back to its hard-coded metadata.
 */
class ConfigCatalog
{
    private const RELATIVE_PATH = 'config-catalog/catalog.json';

    /** @var array<string, mixed>|null */
    private ?array $cached = null;

    private ?int $cachedMtime = null;

    /**
     * @return array<string, array<string, mixed>>
     */
    public function sandbox(?string $locale = null): array
    {
        $data = $this->load();
        $sandbox = is_array($data['sandbox'] ?? null) ? $data['sandbox'] : [];

        if ($locale === null || strtoupper($locale) === 'EN') {
            return $this->stripI18n($sandbox);
        }

        return $this->applySandboxOverlay($sandbox, strtoupper($locale));
    }

    /**
     * @return array<string, array{label: string, options: array<string, array<string, mixed>>}>
     */
    public function mods(?string $locale = null): array
    {
        $data = $this->load();
        $mods = is_array($data['mods'] ?? null) ? $data['mods'] : [];

        if ($locale === null || strtoupper($locale) === 'EN') {
            return $this->stripModsI18n($mods);
        }

        return $this->applyModsOverlay($mods, strtoupper($locale));
    }

    /**
     * @param  array<string, array<string, mixed>>  $sandbox
     * @return array<string, array<string, mixed>>
     */
    private function applySandboxOverlay(array $sandbox, string $locale): array
    {
        $result = [];
        foreach ($sandbox as $key => $entry) {
            $overlay = $entry['i18n'][$locale] ?? null;
            unset($entry['i18n']);
            if (is_array($overlay)) {
                if (isset($overlay['label'])) {
                    $entry['label'] = $overlay['label'];
                }
                if (isset($overlay['description'])) {
                    $entry['description'] = $overlay['description'];
                }
                if (isset($overlay['options']) && is_array($overlay['options']) && isset($entry['options']) && is_array($entry['options'])) {
                    $byValue = [];
                    foreach ($overlay['options'] as $opt) {
                        if (isset($opt['value'])) {
                            $byValue[(string) $opt['value']] = $opt['label'] ?? null;
                        }
                    }
                    $entry['options'] = array_map(function (array $opt) use ($byValue) {
                        $key = (string) ($opt['value'] ?? '');
                        if (isset($byValue[$key]) && $byValue[$key] !== null) {
                            $opt['label'] = $byValue[$key];
                        }

                        return $opt;
                    }, $entry['options']);
                }
            }
            $result[$key] = $entry;
        }

        return $result;
    }

    /**
     * @param  array<string, array<string, mixed>>  $mods
     * @return array<string, array<string, mixed>>
     */
    private function applyModsOverlay(array $mods, string $locale): array
    {
        $result = [];
        foreach ($mods as $namespace => $block) {
            $overlay = $block['i18n'][$locale] ?? null;
            unset($block['i18n']);
            if (is_array($overlay) && isset($overlay['label'])) {
                $block['label'] = $overlay['label'];
            }
            if (isset($block['options']) && is_array($block['options'])) {
                $localizedOptions = [];
                foreach ($block['options'] as $key => $opt) {
                    $optOverlay = $opt['i18n'][$locale] ?? null;
                    unset($opt['i18n']);
                    if (is_array($optOverlay)) {
                        if (isset($optOverlay['label'])) {
                            $opt['label'] = $optOverlay['label'];
                        }
                        if (isset($optOverlay['description'])) {
                            $opt['description'] = $optOverlay['description'];
                        }
                    }
                    $localizedOptions[$key] = $opt;
                }
                $block['options'] = $localizedOptions;
            }
            $result[$namespace] = $block;
        }

        return $result;
    }

    /**
     * Drop `i18n` blocks when the caller wants raw EN — keeps the
     * wire payload smaller and the frontend free of overlay shape.
     *
     * @param  array<string, array<string, mixed>>  $sandbox
     * @return array<string, array<string, mixed>>
     */
    private function stripI18n(array $sandbox): array
    {
        foreach ($sandbox as $key => $entry) {
            unset($entry['i18n']);
            $sandbox[$key] = $entry;
        }

        return $sandbox;
    }

    /**
     * @param  array<string, array<string, mixed>>  $mods
     * @return array<string, array<string, mixed>>
     */
    private function stripModsI18n(array $mods): array
    {
        foreach ($mods as $namespace => $block) {
            unset($block['i18n']);
            if (isset($block['options']) && is_array($block['options'])) {
                foreach ($block['options'] as $key => $opt) {
                    unset($opt['i18n']);
                    $block['options'][$key] = $opt;
                }
            }
            $mods[$namespace] = $block;
        }

        return $mods;
    }

    /**
     * Server.ini catalog source isn't available on dedicated servers (PZ
     * rewrites the INI without comments). Returns an empty map so callers
     * can call this method unconditionally.
     *
     * @return array<string, array<string, mixed>>
     */
    public function server(): array
    {
        $data = $this->load();

        return is_array($data['server'] ?? null) ? $data['server'] : [];
    }

    /**
     * @return array<string, mixed>
     */
    private function load(): array
    {
        $disk = Storage::disk('local');
        if (! $disk->exists(self::RELATIVE_PATH)) {
            return [];
        }

        $absolutePath = $disk->path(self::RELATIVE_PATH);
        $mtime = @filemtime($absolutePath);
        if ($mtime === false) {
            return [];
        }

        if ($this->cached !== null && $this->cachedMtime === $mtime) {
            return $this->cached;
        }

        $raw = $disk->get(self::RELATIVE_PATH);
        if (! is_string($raw) || $raw === '') {
            return [];
        }

        $decoded = json_decode($raw, true);
        if (! is_array($decoded)) {
            return [];
        }

        $this->cached = $decoded;
        $this->cachedMtime = $mtime;

        return $decoded;
    }
}
