<?php

namespace App\Services;

/**
 * Walks installed-mod Workshop directories looking for sandbox-option
 * translations: `Sandbox_<Namespace>_<Key>` / `_tooltip` entries inside
 * `media/lua/shared/Translate/<LANG>/Sandbox_<LANG>.txt`.
 *
 * The mod-supplied `_SandboxVars.lua` namespace only carries values, not
 * the human-readable label/tooltip pairs — those live in these per-locale
 * lua-table files. We harvest them so the admin UI can show real labels
 * instead of raw camel-case keys.
 */
class ModSandboxTranslationsScanner
{
    /** Where SteamCMD lands Workshop mod payloads inside the game-server volume. */
    private const WORKSHOP_ROOT = '/pz-data/Workshop';

    /** Default Workshop root for the dedicated server image. */
    private const DEDICATED_WORKSHOP_ROOT = '/pz-data/Server'; // not used; kept for clarity

    /**
     * @param  list<string>  $extraRoots  Extra base paths to scan. The PHP-FPM
     *                                    container mounts `/pz-data`, which is
     *                                    enough for everything we ship; tests
     *                                    can inject a fixture path.
     */
    public function __construct(private readonly array $extraRoots = []) {}

    /**
     * Walk every Workshop mod (and `Zomboid/mods/<id>`) and merge translation
     * entries for the requested locale, falling back to EN when a key has no
     * translation.
     *
     * @return array<string, array<string, array{label: string, tooltip?: string}>>
     *         Outer key = namespace (eg "SOTO"); inner key = option name.
     */
    public function collect(string $preferredLocale = 'EN'): array
    {
        $roots = array_filter(array_merge(
            [
                '/pz-data/Workshop',
                // Workshop cache inside the dedicated server install.
                '/pz-server/steamapps/workshop/content/108600',
                // Game-server bind-mounted volume path (visible to the
                // game-server container as /home/steam/...).
                '/pz-data/mods',
            ],
            $this->extraRoots,
        ), 'is_dir');

        $files = [];
        foreach ($roots as $root) {
            $files = array_merge($files, $this->findTranslationFiles($root, $preferredLocale));
            if ($preferredLocale !== 'EN') {
                $files = array_merge($files, $this->findTranslationFiles($root, 'EN'));
            }
        }

        // De-duplicate by absolute path while preserving the preferred-locale
        // ordering (preferred locale first → fallbacks overwrite only missing
        // entries).
        $files = array_values(array_unique($files));

        $result = [];
        foreach ($files as $file) {
            foreach ($this->parseFile($file) as $namespace => $entries) {
                foreach ($entries as $key => $entry) {
                    if (! isset($result[$namespace][$key])) {
                        $result[$namespace][$key] = $entry;
                    } else {
                        $result[$namespace][$key] = $entry + $result[$namespace][$key];
                    }
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
     * @return array<string, array<string, array<string, mixed>>>
     */
    public function collectStrict(string $locale): array
    {
        $roots = array_filter(array_merge(
            [
                '/pz-data/Workshop',
                '/pz-server/steamapps/workshop/content/108600',
                '/pz-data/mods',
            ],
            $this->extraRoots,
        ), 'is_dir');

        $files = [];
        foreach ($roots as $root) {
            $files = array_merge($files, $this->findTranslationFiles($root, $locale));
        }
        $files = array_values(array_unique($files));

        $result = [];
        foreach ($files as $file) {
            foreach ($this->parseFile($file) as $namespace => $entries) {
                foreach ($entries as $key => $entry) {
                    if (! isset($result[$namespace][$key])) {
                        $result[$namespace][$key] = $entry;
                    } else {
                        $result[$namespace][$key] = $entry + $result[$namespace][$key];
                    }
                }
            }
        }

        return $result;
    }

    /**
     * Locate every `Sandbox_<LOCALE>.txt` reachable from a mod root.
     *
     * Layout in B42 Workshop:
     *
     *     <root>/<workshopId>/mods/<modName>/
     *         42.15/media/lua/shared/Translate/<LOC>/Sandbox_<LOC>.txt   (preferred)
     *         42.14/media/lua/shared/Translate/<LOC>/Sandbox_<LOC>.txt
     *         media/lua/shared/Translate/<LOC>/Sandbox_<LOC>.txt        (legacy fallback)
     *
     * We pick the highest `XX.YY` versioned dir per mod and fall back
     * to the legacy `media/` only if no versioned dir carries a
     * translation file for the locale. Returning both would let the
     * older copy overwrite newer strings during de-dup merge.
     *
     * @return list<string>
     */
    private function findTranslationFiles(string $root, string $locale): array
    {
        $modDirs = array_merge(
            glob($root.'/*/mods/*', GLOB_ONLYDIR) ?: [], // Workshop layout
            glob($root.'/*', GLOB_ONLYDIR) ?: [],        // Host-mounted layout (root/<modId>)
        );
        $modDirs = array_values(array_unique($modDirs));

        $results = [];
        foreach ($modDirs as $modDir) {
            $candidate = $this->resolveTranslationFile($modDir, $locale);
            if ($candidate !== null) {
                $results[] = $candidate;
            }
        }

        return $results;
    }

    /**
     * Pick the highest-versioned `<modDir>/<XX.YY>/media/...` translation
     * file for the requested locale; fall back to `<modDir>/media/...`
     * when none of the versioned dirs ship the locale.
     */
    private function resolveTranslationFile(string $modDir, string $locale): ?string
    {
        $relative = 'media/lua/shared/Translate/'.$locale.'/Sandbox_'.$locale.'.txt';

        $versionedDirs = glob($modDir.'/[0-9]*.[0-9]*', GLOB_ONLYDIR) ?: [];
        usort($versionedDirs, fn (string $a, string $b) => version_compare(
            basename($b),
            basename($a),
        ));

        foreach ($versionedDirs as $versionedDir) {
            $candidate = $versionedDir.'/'.$relative;
            if (is_readable($candidate)) {
                return $candidate;
            }
        }

        $legacy = $modDir.'/'.$relative;
        if (is_readable($legacy)) {
            return $legacy;
        }

        return null;
    }

    /**
     * Parse a `Sandbox_<LANG>.txt` file into `[namespace => [key => {label, tooltip}]]`.
     *
     * @return array<string, array<string, array{label: string, tooltip?: string}>>
     */
    public function parseFile(string $path): array
    {
        if (! is_readable($path)) {
            return [];
        }

        $contents = @file_get_contents($path);
        if (! is_string($contents)) {
            return [];
        }

        return $this->parseContent($contents);
    }

    /**
     * @return array<string, array<string, array{label: string, tooltip?: string}>>
     */
    public function parseContent(string $contents): array
    {
        $result = [];

        // Namespace label: `Sandbox_SOTO = "Simple Overhaul: ..."` (no
        // trailing `_<Key>`). We anchor on `\s*=` immediately after the
        // namespace to avoid matching pair entries.
        $nsPattern = '/Sandbox_([A-Za-z][A-Za-z0-9]*)\s*=\s*"((?:[^"\\\\]|\\\\.)*)"/u';
        if (preg_match_all($nsPattern, $contents, $nsMatches, PREG_SET_ORDER)) {
            foreach ($nsMatches as $m) {
                $namespace = $m[1];
                $result[$namespace]['__namespace__'] = ['label' => $this->normaliseLabel($m[2])];
            }
        }

        // Pair entries: `Sandbox_<Ns>_<Key>` and `Sandbox_<Ns>_<Key>_tooltip`.
        //
        // Namespace is constrained to a single word (no underscore) so that a
        // greedy match doesn't swallow the option key on a `_tooltip` line.
        // Almost every PZ B42 mod we have seen uses a single-word namespace
        // (`SOTO`, `FWOFitness`, `BarricadedWorld`...); the few exceptions can
        // be added explicitly when they appear.
        $pattern = '/Sandbox_([A-Za-z][A-Za-z0-9]*)_([A-Za-z][A-Za-z0-9_]+?)(_tooltip)?\s*=\s*"((?:[^"\\\\]|\\\\.)*)"/u';
        if (! preg_match_all($pattern, $contents, $matches, PREG_SET_ORDER)) {
            return $result;
        }

        foreach ($matches as $m) {
            $namespace = $m[1];
            $key = $m[2];
            $isTooltip = $m[3] === '_tooltip';
            $value = $this->normaliseLabel($m[4]);

            if (! isset($result[$namespace][$key])) {
                $result[$namespace][$key] = ['label' => $key];
            }

            if ($isTooltip) {
                $result[$namespace][$key]['tooltip'] = $value;
            } else {
                $result[$namespace][$key]['label'] = $value;
            }
        }

        return $result;
    }

    /**
     * Strip trailing colons, decode the simple HTML PZ ships inside its
     * tooltip strings, and unescape lua string escapes.
     */
    private function normaliseLabel(string $value): string
    {
        $value = str_replace(['\\"', '\\n'], ['"', "\n"], $value);
        // PZ tooltips embed pseudo-HTML; render their line breaks as actual
        // newlines so the admin UI can wrap them with whitespace-pre-wrap.
        $value = preg_replace('/<\s*br\s*\/?>/i', "\n", $value) ?? $value;
        $value = preg_replace('/<\s*LINE\s*>/i', "\n", $value) ?? $value;

        return rtrim($value, " :\t");
    }
}
