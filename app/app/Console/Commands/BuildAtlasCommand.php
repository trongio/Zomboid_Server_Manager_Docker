<?php

namespace App\Console\Commands;

use App\Models\MapRenderSetting;
use App\Services\AuditLogger;
use Illuminate\Console\Command;
use Symfony\Component\Process\Process;

class BuildAtlasCommand extends Command
{
    /** @var string */
    protected $signature = 'zomboid:build-atlas
        {--input= : Directory containing .pack files (default: zomboid.map.texturepacks_path)}
        {--output= : Output directory for atlas (default: <tiles_path>/web)}
        {--atlas-size=4096 : Edge size of each atlas page in pixels}
        {--max-mip=10 : Maximum mip-level depth (down to 1x1 by default)}
        {--lods=4 : Number of LOD variants per page (1..8). 4 yields lod0/1/2/3.}
        {--ktx2 : Also emit KTX2/BC7 variants alongside WebP (needs basisu in PATH).}
        {--cell-data-dir= : Directory of .lotheader files; enables cell-pages.json output.}
        {--workers=0 : Parallel page-rendering threads (0=auto-detect cpu count).}
        {--include-pack=* : Substring filter for .pack filenames; repeatable. Pass once with "" to include everything.}
        {--all : Shortcut for --include-pack="" — include every .pack found}';

    /** @var string */
    protected $description = 'Build multi-LOD sprite atlas (WebP + optional KTX2/BC7) from PZ texturepacks for the WebGL renderer';

    public function handle(): int
    {
        $script = base_path('scripts/pzpack_to_atlas.py');

        if (! is_file($script)) {
            $this->error("Atlas builder script missing: {$script}");

            return self::FAILURE;
        }

        $input = (string) ($this->option('input')
            ?: config('zomboid.map.texturepacks_path', '/pz-data/texturepacks'));
        $output = (string) ($this->option('output')
            ?: rtrim((string) config('zomboid.map.tiles_path', '/map-tiles'), '/').'/web');

        if (! is_dir($input)) {
            $this->error("Input directory does not exist: {$input}");

            return self::FAILURE;
        }

        $args = [
            'python3', $script,
            '--input', $input,
            '--output', $output,
            '--atlas-size', (string) $this->option('atlas-size'),
            '--max-mip', (string) $this->option('max-mip'),
            '--lods', (string) $this->option('lods'),
        ];

        if ($this->option('ktx2')) {
            $args[] = '--ktx2';
        }

        if ($cellDir = (string) $this->option('cell-data-dir')) {
            $args[] = '--cell-data-dir';
            $args[] = $cellDir;
        }

        $workers = (int) $this->option('workers');
        if ($workers > 0) {
            $args[] = '--workers';
            $args[] = (string) $workers;
        }

        if ($this->option('all')) {
            $args[] = '--include-pack';
            $args[] = '';
        } else {
            foreach ((array) $this->option('include-pack') as $pattern) {
                $args[] = '--include-pack';
                $args[] = (string) $pattern;
            }
        }

        $this->info("Running: {$args[0]} {$args[1]} ...");
        $this->line("Input:  {$input}");
        $this->line("Output: {$output}");
        $this->line('');

        $process = new Process($args);
        // Multi-LOD + cell-pages.json builds walk every .lotheader on disk
        // (~thousands of files across every map), then encode 4 LOD-scaled
        // WebPs per atlas page. On large modpacks the .pack parsing phase
        // alone is ≥15 minutes with no stdout writes. Allow 4 hours total
        // and 60 minutes between log lines so Symfony's idle watchdog
        // doesn't kill the run mid-render.
        $process->setTimeout(14400);
        $process->setIdleTimeout(3600);

        $exitCode = $process->run(function (string $type, string $buffer): void {
            $this->output->write($buffer);
        });

        if ($exitCode !== 0) {
            $this->error("Atlas builder failed with exit code {$exitCode}");

            return self::FAILURE;
        }

        $manifestPath = $output.'/manifest.json';

        if (is_file($manifestPath)) {
            $manifest = json_decode((string) file_get_contents($manifestPath), true);

            if (is_array($manifest)) {
                $this->line('');
                $this->info('Atlas summary:');
                $this->line('  version:      '.($manifest['version'] ?? '?'));
                $this->line('  atlas pages:  '.($manifest['atlas_count'] ?? '?'));
                $this->line('  sprites:      '.($manifest['sprite_count'] ?? '?'));
                $this->line('  total bytes:  '.number_format((int) ($manifest['total_bytes'] ?? 0)));

                $setting = MapRenderSetting::instance();
                $lodCount = is_array($manifest['lods'] ?? null) ? count($manifest['lods']) : 1;
                $hasKtx2 = (bool) ($manifest['has_ktx2'] ?? false);
                $ktx2Format = $hasKtx2 ? (string) ($manifest['ktx2_format'] ?? 'BC7') : null;
                $hasCellPages = (bool) ($manifest['has_cell_pages'] ?? false);
                $setting->forceFill([
                    'atlas_built_at' => now(),
                    'atlas_version' => (string) ($manifest['version'] ?? ''),
                    'atlas_size_bytes' => (int) ($manifest['total_bytes'] ?? 0),
                    'atlas_sprite_count' => (int) ($manifest['sprite_count'] ?? 0),
                    'atlas_page_count' => (int) ($manifest['atlas_count'] ?? 0),
                    'atlas_lod_count' => $lodCount,
                    'atlas_has_ktx2' => $hasKtx2,
                    'atlas_compression_format' => $ktx2Format,
                    'cell_pages_built_at' => $hasCellPages ? now() : null,
                ])->save();

                $this->line('  LODs:         '.$lodCount);
                $this->line('  KTX2:         '.($hasKtx2 ? $ktx2Format : 'no'));
                $this->line('  cell-pages:   '.($hasCellPages ? 'yes' : 'no'));

                AuditLogger::record(
                    actor: 'system',
                    action: 'map.atlas.built',
                    target: (string) ($manifest['version'] ?? ''),
                    details: [
                        'sprite_count' => $manifest['sprite_count'] ?? 0,
                        'atlas_count' => $manifest['atlas_count'] ?? 0,
                        'total_bytes' => $manifest['total_bytes'] ?? 0,
                        'lods' => $lodCount,
                        'has_ktx2' => $hasKtx2,
                        'has_cell_pages' => $hasCellPages,
                    ],
                );
            }
        }

        return self::SUCCESS;
    }
}
