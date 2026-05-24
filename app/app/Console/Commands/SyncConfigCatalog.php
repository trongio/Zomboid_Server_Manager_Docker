<?php

namespace App\Console\Commands;

use App\Models\Language;
use App\Services\ModSandboxTranslationsScanner;
use App\Services\SandboxVarsCommentParser;
use App\Services\ServerIniCommentParser;
use App\Services\VanillaSandboxTranslationsScanner;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Storage;

class SyncConfigCatalog extends Command
{
    protected $signature = 'zomboid:sync-config-catalog {--dry-run : Print the diff against the existing catalog without writing}';

    protected $description = 'Build a settings catalog from PZ-generated <NAME>_SandboxVars.lua comments';

    public function __construct(
        private readonly SandboxVarsCommentParser $parser,
        private readonly ModSandboxTranslationsScanner $translations,
        private readonly VanillaSandboxTranslationsScanner $vanillaTranslations,
        private readonly ServerIniCommentParser $serverIniParser,
    ) {
        parent::__construct();
    }

    public function handle(): int
    {
        $sandboxPath = config('zomboid.paths.sandbox_lua');
        if (! is_string($sandboxPath) || ! is_file($sandboxPath)) {
            $this->warn("SandboxVars.lua not found at: {$sandboxPath}");
            $this->warn('Catalog will be empty until the game server has booted once.');
        }

        $parsed = is_string($sandboxPath)
            ? $this->parser->parseFile($sandboxPath)
            : ['vanilla' => [], 'mods' => []];

        // EN is the baseline locale — labels, descriptions, and enum
        // option names get merged onto the flat top-level fields. PZ
        // ships every dedicated server with the English translations
        // already in place, so this is the safe "always present"
        // fallback every other locale layers on top of.
        $this->enrichVanillaBaseline($parsed['vanilla'], $this->vanillaTranslations->collect('EN'));
        $this->enrichModsBaseline($parsed['mods'], $this->translations->collect('EN'));

        // For every other active locale (RU, KA, ...) we attach a
        // nested `i18n.<LOCALE>` overlay so the frontend can pick the
        // right translation per user. We never overwrite the baseline.
        $extraLocales = $this->collectExtraLocales();
        foreach ($extraLocales as $locale) {
            // Use the strict (no-fallback) variants so the overlay
            // only carries entries that genuinely come from the
            // requested locale's translation file. Anything missing
            // simply isn't written — the frontend falls back to the
            // EN baseline already on the entry.
            $this->attachVanillaOverlay($parsed['vanilla'], $this->vanillaTranslations->collectStrict($locale), $locale);
            $this->attachModsOverlay($parsed['mods'], $this->translations->collectStrict($locale), $locale);
        }

        // Parse the live `<NAME>.ini` for the comment-driven metadata PZ
        // writes next to every key (description + `# Min: X Max: Y
        // Default: Z` hints). Unlike sandbox vars, server.ini stays
        // human-readable across restarts on B42 dedicated.
        $serverIniPath = config('zomboid.paths.server_ini');
        $serverEntries = (is_string($serverIniPath) && is_file($serverIniPath))
            ? $this->serverIniParser->parseFile($serverIniPath)
            : [];

        $catalog = [
            'generated_at' => now()->toIso8601String(),
            'source' => $sandboxPath,
            'server' => $serverEntries,
            'sandbox' => $parsed['vanilla'],
            'mods' => $parsed['mods'],
        ];

        $payload = json_encode(
            $catalog,
            JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES,
        );

        if ($payload === false) {
            $this->error('Failed to serialise catalog to JSON.');

            return self::FAILURE;
        }

        $relativePath = 'config-catalog/catalog.json';
        $disk = Storage::disk('local');

        if ($this->option('dry-run')) {
            $existing = $disk->exists($relativePath) ? $disk->get($relativePath) : '';
            $diff = $this->buildDiff((string) $existing, $payload);
            if ($diff === '') {
                $this->info('Catalog already up to date — no changes.');
            } else {
                $this->line($diff);
            }

            return self::SUCCESS;
        }

        $disk->put($relativePath, $payload);

        $this->info('Catalog written to '.$disk->path($relativePath));
        $this->line('  server entries:  '.count($serverEntries));
        $this->line('  sandbox entries: '.count($parsed['vanilla']));
        $this->line('  mod namespaces:  '.count($parsed['mods']));

        // Drop the regeneration sentinels (both possible locations) if they
        // were raised by ModManager / configure-server.sh.
        $dataPath = rtrim(config('zomboid.paths.data', '/pz-data'), '/');
        foreach ([
            $dataPath.'/.settings_catalog_dirty',
            $dataPath.'/Server/.settings_catalog_dirty',
        ] as $sentinel) {
            if (is_file($sentinel)) {
                @unlink($sentinel);
            }
        }

        return self::SUCCESS;
    }

    /**
     * @return list<string>  Uppercase locale codes excluding EN.
     */
    private function collectExtraLocales(): array
    {
        try {
            return Language::query()
                ->where('is_active', true)
                ->pluck('code')
                ->filter(fn ($code) => is_string($code) && $code !== '')
                ->map(fn (string $code) => strtoupper($code))
                ->reject(fn (string $code) => $code === 'EN')
                ->unique()
                ->values()
                ->all();
        } catch (\Throwable $e) {
            $this->warn('Could not load locales from DB: '.$e->getMessage());

            return [];
        }
    }

    /**
     * Merge English labels, tooltips, and option-enum names onto the
     * top-level vanilla catalog entries. Modifies $vanilla in place.
     *
     * @param  array<string, array<string, mixed>>  $vanilla
     * @param  array<string, array<string, mixed>>  $translations
     */
    private function enrichVanillaBaseline(array &$vanilla, array $translations): void
    {
        foreach ($vanilla as $key => $meta) {
            $tr = $translations[$key] ?? null;
            if ($tr === null) {
                continue;
            }
            if (! empty($tr['label'])) {
                $vanilla[$key]['label'] = $tr['label'];
            }
            if (! empty($tr['tooltip']) && empty($meta['description'])) {
                $vanilla[$key]['description'] = $tr['tooltip'];
            }
            if (! empty($tr['options']) && ! empty($meta['options'])) {
                $enriched = [];
                foreach ($meta['options'] as $opt) {
                    $enriched[] = [
                        'value' => $opt['value'],
                        'label' => $tr['options'][$opt['value']] ?? $opt['label'],
                    ];
                }
                $vanilla[$key]['options'] = $enriched;
            }
        }
    }

    /**
     * @param  array<string, array<string, mixed>>  $mods
     * @param  array<string, array<string, mixed>>  $translations  Per-namespace map.
     */
    private function enrichModsBaseline(array &$mods, array $translations): void
    {
        foreach ($mods as $namespace => $modBlock) {
            foreach ($modBlock['options'] ?? [] as $key => $meta) {
                $tr = $translations[$namespace][$key] ?? null;
                if ($tr === null) {
                    continue;
                }
                if (! empty($tr['label']) && $tr['label'] !== $key) {
                    $mods[$namespace]['options'][$key]['label'] = $tr['label'];
                }
                if (! empty($tr['tooltip']) && empty($meta['description'])) {
                    $mods[$namespace]['options'][$key]['description'] = $tr['tooltip'];
                }
            }
            if (isset($translations[$namespace]) && ! empty($translations[$namespace]['__namespace__']['label'])) {
                $mods[$namespace]['label'] = $translations[$namespace]['__namespace__']['label'];
            }
        }
    }

    /**
     * Attach `i18n.<LOCALE>` overlay to vanilla entries. Only writes
     * fields that PZ actually translated for that locale — missing
     * keys quietly fall back to baseline on the frontend.
     *
     * @param  array<string, array<string, mixed>>  $vanilla
     * @param  array<string, array<string, mixed>>  $translations
     */
    private function attachVanillaOverlay(array &$vanilla, array $translations, string $locale): void
    {
        foreach ($vanilla as $key => $meta) {
            $tr = $translations[$key] ?? null;
            if ($tr === null) {
                continue;
            }
            $overlay = [];
            if (! empty($tr['label'])) {
                $overlay['label'] = $tr['label'];
            }
            if (! empty($tr['tooltip'])) {
                $overlay['description'] = $tr['tooltip'];
            }
            if (! empty($tr['options']) && ! empty($meta['options'])) {
                $optionOverlay = [];
                foreach ($meta['options'] as $opt) {
                    if (isset($tr['options'][$opt['value']])) {
                        $optionOverlay[] = [
                            'value' => $opt['value'],
                            'label' => $tr['options'][$opt['value']],
                        ];
                    }
                }
                if ($optionOverlay !== []) {
                    $overlay['options'] = $optionOverlay;
                }
            }
            if ($overlay !== []) {
                $vanilla[$key]['i18n'][$locale] = $overlay;
            }
        }
    }

    /**
     * @param  array<string, array<string, mixed>>  $mods
     * @param  array<string, array<string, mixed>>  $translations  Per-namespace map.
     */
    private function attachModsOverlay(array &$mods, array $translations, string $locale): void
    {
        foreach ($mods as $namespace => $modBlock) {
            $nsTr = $translations[$namespace] ?? null;
            if ($nsTr === null) {
                continue;
            }
            if (! empty($nsTr['__namespace__']['label'])) {
                $mods[$namespace]['i18n'][$locale]['label'] = $nsTr['__namespace__']['label'];
            }
            foreach ($modBlock['options'] ?? [] as $key => $meta) {
                $tr = $nsTr[$key] ?? null;
                if ($tr === null) {
                    continue;
                }
                $overlay = [];
                if (! empty($tr['label']) && $tr['label'] !== $key) {
                    $overlay['label'] = $tr['label'];
                }
                if (! empty($tr['tooltip'])) {
                    $overlay['description'] = $tr['tooltip'];
                }
                if ($overlay !== []) {
                    $mods[$namespace]['options'][$key]['i18n'][$locale] = $overlay;
                }
            }
        }
    }

    /**
     * Tiny line-by-line diff for `--dry-run`. Avoids pulling a full diff
     * library for what amounts to "show me what changed".
     */
    private function buildDiff(string $before, string $after): string
    {
        if ($before === $after) {
            return '';
        }

        $beforeLines = explode("\n", $before);
        $afterLines = explode("\n", $after);
        $max = max(count($beforeLines), count($afterLines));
        $out = [];

        for ($i = 0; $i < $max; $i++) {
            $b = $beforeLines[$i] ?? null;
            $a = $afterLines[$i] ?? null;
            if ($b === $a) {
                continue;
            }
            if ($b !== null) {
                $out[] = "- {$b}";
            }
            if ($a !== null) {
                $out[] = "+ {$a}";
            }
        }

        return implode("\n", $out);
    }
}
