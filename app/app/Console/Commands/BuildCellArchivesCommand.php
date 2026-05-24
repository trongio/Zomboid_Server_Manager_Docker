<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;

/**
 * Pre-packs static PZ cell binaries (lotheader + lotpack) into chunked
 * archives so the browser can pull them through nginx without ever hitting
 * PHP-FPM. Each chunk groups an 8×8 block of cells (≤64 cells per chunk).
 *
 * Output layout under {tiles_path}/cell-data/:
 *   index.json                 — {version, cells:{"X_Y":"chunkKey"}, chunkSize}
 *   chunk-{cx0}_{cy0}.bin      — raw bulk-format binary
 *   chunk-{cx0}_{cy0}.bin.gz   — pre-compressed for nginx gzip_static
 *
 * Run once per PZ patch. Outputs are immutable; nginx serves them with
 * max-age=1y so browser cache holds them across sessions.
 */
class BuildCellArchivesCommand extends Command
{
    protected $signature = 'zomboid:build-cell-archives
                            {--map= : Map subdirectory name; defaults to first entry from PZ_MAP_NAMES}
                            {--chunk-size=8 : cells per chunk side (8 → 64 cells/chunk)}
                            {--force : rebuild even when output exists}';

    protected $description = 'Pre-pack PZ map cells into static binary chunks for nginx-served WebGL rendering';

    public function handle(): int
    {
        $mapName = (string) ($this->option('map') ?: $this->primaryMapName());
        $chunkSide = max(1, (int) $this->option('chunk-size'));
        $force = (bool) $this->option('force');

        $mapDir = rtrim((string) config('zomboid.game_server_path', '/pz-server'), '/').'/media/maps/'.$mapName;
        $outDir = rtrim((string) config('zomboid.map.tiles_path', '/map-tiles'), '/').'/cell-data';

        if (! is_dir($mapDir)) {
            $this->error("Map directory not found: {$mapDir}");

            return self::FAILURE;
        }

        File::ensureDirectoryExists($outDir);

        $indexPath = $outDir.'/index.json';
        if (! $force && is_file($indexPath)) {
            $this->info("Index already exists at {$indexPath} (use --force to rebuild).");

            return self::SUCCESS;
        }

        $entries = @scandir($mapDir) ?: [];
        $cells = [];
        foreach ($entries as $entry) {
            if (preg_match('/^(\d+)_(\d+)\.lotheader$/', $entry, $m) === 1) {
                $cells[] = [(int) $m[1], (int) $m[2]];
            }
        }

        if ($cells === []) {
            $this->error("No .lotheader files found in {$mapDir}");

            return self::FAILURE;
        }

        $this->info('Found '.count($cells)." cells in {$mapName}");

        /** @var array<string, array<int, array{0:int,1:int}>> $chunks */
        $chunks = [];
        foreach ($cells as [$cx, $cy]) {
            $chunkKey = intdiv($cx, $chunkSide).'_'.intdiv($cy, $chunkSide);
            $chunks[$chunkKey][] = [$cx, $cy];
        }

        $this->info('Grouped into '.count($chunks)." chunks ({$chunkSide}×{$chunkSide} cells each)");

        $index = [
            'version' => time(),
            'chunkSize' => $chunkSide,
            'cells' => [],
        ];

        $totalRaw = 0;
        $totalGz = 0;
        $bar = $this->output->createProgressBar(count($chunks));
        $bar->start();

        foreach ($chunks as $chunkKey => $chunkCells) {
            $binary = $this->packChunk($mapDir, $chunkCells);
            $binaryPath = $outDir.'/chunk-'.$chunkKey.'.bin';
            File::put($binaryPath, $binary);
            $gz = gzencode($binary, 6);
            File::put($binaryPath.'.gz', $gz);

            $totalRaw += strlen($binary);
            $totalGz += strlen($gz);

            foreach ($chunkCells as [$cx, $cy]) {
                $index['cells'][$cx.'_'.$cy] = $chunkKey;
            }

            $bar->advance();
        }

        $bar->finish();
        $this->newLine();

        File::put($indexPath, json_encode($index, JSON_UNESCAPED_SLASHES));

        $this->info(sprintf(
            'Wrote %d chunks: %.1f MB raw, %.1f MB gz (%.1fx compression)',
            count($chunks),
            $totalRaw / 1048576,
            $totalGz / 1048576,
            $totalRaw / max(1, $totalGz),
        ));
        $this->info("Index: {$indexPath}");

        return self::SUCCESS;
    }

    /**
     * Pack a chunk into the same binary stream that PzMapDataController::cellsBulk
     * emits, so the same frontend parser handles both transports.
     *
     * @param  array<int, array{0:int,1:int}>  $cells
     */
    private function packChunk(string $mapDir, array $cells): string
    {
        $out = pack('V', count($cells));
        $body = '';

        foreach ($cells as [$cx, $cy]) {
            $headerPath = $mapDir.'/'.$cx.'_'.$cy.'.lotheader';
            $lotpackPath = $mapDir.'/world_'.$cx.'_'.$cy.'.lotpack';

            $header = is_file($headerPath) ? (string) @file_get_contents($headerPath) : '';
            $lotpack = is_file($lotpackPath) ? (string) @file_get_contents($lotpackPath) : '';

            $hLen = strlen($header);
            $lLen = strlen($lotpack);

            $out .= pack('v', $cx).pack('v', $cy).pack('V', $hLen).pack('V', $lLen);
            if ($hLen > 0) {
                $body .= $header;
            }
            if ($lLen > 0) {
                $body .= $lotpack;
            }
        }

        return $out.$body;
    }

    private function primaryMapName(): string
    {
        $names = (string) env('PZ_MAP_NAMES', 'Muldraugh, KY');
        $first = explode(';', $names)[0] ?? 'Muldraugh, KY';

        return trim($first);
    }
}
