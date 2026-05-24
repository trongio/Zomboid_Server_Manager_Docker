<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Read-only data endpoints for the browser-side WebGL2 map renderer.
 *
 * The heavy lifting (the atlas image and sprites.json) is served straight by
 * nginx via aliases — see docker/nginx.conf. PHP only handles cell binary
 * lookups, which need filesystem traversal protection plus 404 handling.
 */
class PzMapDataController extends Controller
{
    public function manifest(): JsonResponse|Response
    {
        $path = $this->webDir().'/manifest.json';

        if (! is_file($path)) {
            return response()->json([
                'error' => 'atlas-not-built',
                'message' => 'Atlas has not been generated yet. Run: php artisan zomboid:build-atlas',
            ], 503);
        }

        return response()->file($path, [
            'Content-Type' => 'application/json',
            'Cache-Control' => 'no-cache, must-revalidate',
        ]);
    }

    public function spritesIndex(): Response|BinaryFileResponse
    {
        $path = $this->webDir().'/sprites.json';

        if (! is_file($path)) {
            return response()->json(['error' => 'atlas-not-built'], 503);
        }

        return response()->file($path, [
            'Content-Type' => 'application/json',
            'Cache-Control' => 'public, max-age=86400',
        ]);
    }

    public function atlas(string $page): Response|BinaryFileResponse
    {
        // page is like "v1234-0" — version and atlas index. Anchor at start of name to block traversal.
        if (! preg_match('/^[A-Za-z0-9_.-]+$/', $page)) {
            return response('Bad request', 400);
        }

        $path = $this->webDir().'/atlas-'.$page.'.webp';
        $realWebDir = realpath($this->webDir()) ?: '';
        $realPath = realpath($path);

        if ($realPath === false || $realWebDir === '' || ! str_starts_with($realPath, $realWebDir)) {
            return response('Not found', 404);
        }

        return response()->file($realPath, [
            'Content-Type' => 'image/webp',
            'Cache-Control' => 'public, max-age=31536000, immutable',
        ]);
    }

    public function cellsManifest(): JsonResponse
    {
        $dir = $this->baseMapDir();

        if (! is_dir($dir)) {
            return response()->json(['error' => 'no-map-data'], 503);
        }

        $entries = @scandir($dir);

        if ($entries === false) {
            return response()->json(['error' => 'no-map-data'], 503);
        }

        $cells = [];

        foreach ($entries as $entry) {
            if (preg_match('/^(\d+)_(\d+)\.lotheader$/', $entry, $m) !== 1) {
                continue;
            }
            $cells[] = [(int) $m[1], (int) $m[2]];
        }

        if ($cells === []) {
            return response()->json(['error' => 'no-map-data'], 503);
        }

        // Sort for a stable hash: first by X, then by Y.
        usort($cells, static fn (array $a, array $b): int => $a[0] !== $b[0] ? $a[0] - $b[0] : $a[1] - $b[1]);

        $version = sha1(implode(',', array_map(static fn (array $c): string => $c[0].'_'.$c[1], $cells)));

        return response()->json(['version' => $version, 'cells' => $cells], 200, [
            'Cache-Control' => 'public, max-age=300',
        ]);
    }

    public function cellHeader(string $x, string $y): Response|BinaryFileResponse
    {
        return $this->serveCellBinary(
            $this->baseMapDir().'/'.intval($x).'_'.intval($y).'.lotheader',
            $this->baseMapDir(),
            'application/octet-stream',
        );
    }

    public function cellLotpack(string $x, string $y): Response|BinaryFileResponse
    {
        // B42 stores chunk data in {save}/map/X/Y.bin; if it's a save-game cell.
        // Vanilla base lives in /pz-server/media/maps/Muldraugh, KY/X_Y_*.bin (per-layer).
        // For now we serve the base map lotpack equivalent — the WebGL renderer joins it with save data separately.
        $cellX = intval($x);
        $cellY = intval($y);

        $candidates = [
            $this->baseMapDir().'/world_'.$cellX.'_'.$cellY.'.bin',
            $this->baseMapDir().'/chunkdata_'.$cellX.'_'.$cellY.'.bin',
        ];

        foreach ($candidates as $candidate) {
            $real = realpath($candidate);
            if ($real !== false && str_starts_with($real, realpath($this->baseMapDir()) ?: '/')) {
                return response()->file($real, [
                    'Content-Type' => 'application/octet-stream',
                    'Cache-Control' => 'public, max-age=3600',
                ]);
            }
        }

        return response('Not found', 404);
    }

    /**
     * Bulk cell-binary fetch — one HTTP request returns header + lotpack
     * for many cells at once. The browser was choking on thousands of
     * individual 1 KB / 1 MB requests; one PHP-FPM hit batched per ~64
     * cells outperforms even nginx alias for the per-request overhead.
     *
     * Response is a custom binary stream:
     *   [count: uint32 LE]
     *   [per cell: cellX u16, cellY u16, headerLen u32, lotpackLen u32]
     *   [body: header bytes + lotpack bytes per cell, concatenated]
     *
     * Missing files have len=0 (cell does not exist on disk).
     */
    public function cellsBulk(Request $request): Response
    {
        $coordsParam = (string) $request->query('coords', '');
        if ($coordsParam === '') {
            return response('coords required', 400);
        }

        $tokens = explode(',', $coordsParam);
        if (count($tokens) > 256) {
            return response('too many cells (max 256 per request)', 400);
        }

        $coords = [];
        foreach ($tokens as $token) {
            if (preg_match('/^(\d+)_(\d+)$/', $token, $m) !== 1) {
                continue;
            }
            $coords[] = [(int) $m[1], (int) $m[2]];
        }

        $baseDir = $this->baseMapDir();
        $realBase = realpath($baseDir) ?: '';

        // Read everything into memory first so we can size the table.
        $cells = [];
        $totalSize = 4; // uint32 count
        foreach ($coords as [$cx, $cy]) {
            $header = null;
            $lotpack = null;

            $headerPath = $baseDir.'/'.$cx.'_'.$cy.'.lotheader';
            $realHeader = realpath($headerPath);
            if ($realHeader !== false && $realBase !== '' && str_starts_with($realHeader, $realBase)) {
                $header = @file_get_contents($realHeader) ?: null;
            }

            $lotpackPath = $baseDir.'/world_'.$cx.'_'.$cy.'.lotpack';
            $realLotpack = realpath($lotpackPath);
            if ($realLotpack !== false && $realBase !== '' && str_starts_with($realLotpack, $realBase)) {
                $lotpack = @file_get_contents($realLotpack) ?: null;
            }

            $hLen = $header !== null ? strlen($header) : 0;
            $lLen = $lotpack !== null ? strlen($lotpack) : 0;

            $cells[] = [$cx, $cy, $header, $lotpack, $hLen, $lLen];
            $totalSize += 12 + $hLen + $lLen;
        }

        // Build the table + body. PHP string concat with += is fine here —
        // total payload is bounded by 256 cells × ~1 MB lotpack ≈ 256 MB worst
        // case, but realistic batches sit around 50 cells × 1 MB = 50 MB.
        $out = pack('V', count($cells));
        $body = '';
        foreach ($cells as [$cx, $cy, $header, $lotpack, $hLen, $lLen]) {
            $out .= pack('v', $cx).pack('v', $cy).pack('V', $hLen).pack('V', $lLen);
            if ($hLen > 0) {
                $body .= $header;
            }
            if ($lLen > 0) {
                $body .= $lotpack;
            }
        }

        return response($out.$body, 200, [
            'Content-Type' => 'application/octet-stream',
            'Cache-Control' => 'public, max-age=300',
            'X-Cells-Count' => (string) count($cells),
            'X-Payload-Bytes' => (string) $totalSize,
        ]);
    }

    public function saveCellData(string $x, string $y): Response|BinaryFileResponse
    {
        $cellX = intval($x);
        $cellY = intval($y);
        $dataPath = rtrim(config('zomboid.paths.data', '/pz-data'), '/');
        $serverName = (string) config('zomboid.server_name', 'ZomboidServer');
        $saveRoot = $dataPath.'/Saves/Multiplayer/'.$serverName.'/map';

        // B42 organizes saves as map/X/Y.bin (primary).
        // B41 used a flat structure: chunkdata_X_Y.bin (fallback).
        $candidates = [
            $saveRoot.'/'.$cellX.'/'.$cellY.'.bin',
            $saveRoot.'/chunkdata_'.$cellX.'_'.$cellY.'.bin',
        ];

        $realRoot = realpath($saveRoot);

        if ($realRoot === false) {
            return response('Not found', 404);
        }

        foreach ($candidates as $candidate) {
            $realPath = realpath($candidate);
            if ($realPath !== false && str_starts_with($realPath, $realRoot)) {
                return response()->file($realPath, [
                    'Content-Type' => 'application/octet-stream',
                    'Cache-Control' => 'public, max-age=300',
                ]);
            }
        }

        return response('Not found', 404);
    }

    private function serveCellBinary(string $path, string $allowedRoot, string $contentType): Response|BinaryFileResponse
    {
        $realRoot = realpath($allowedRoot);
        $realPath = realpath($path);

        if ($realPath === false || $realRoot === false || ! str_starts_with($realPath, $realRoot)) {
            return response('Not found', 404);
        }

        return response()->file($realPath, [
            'Content-Type' => $contentType,
            'Cache-Control' => 'public, max-age=300',
        ]);
    }

    private function webDir(): string
    {
        return rtrim((string) config('zomboid.map.tiles_path', '/map-tiles'), '/').'/web';
    }

    private function baseMapDir(): string
    {
        $serverPath = rtrim((string) config('zomboid.game_server_path', '/pz-server'), '/');

        return $serverPath.'/media/maps/Muldraugh, KY';
    }
}
