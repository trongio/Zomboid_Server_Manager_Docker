<?php

namespace App\Services;

use App\Models\MapRenderSetting;

class MapConfigBuilder
{
    /**
     * Build map configuration, preferring local tiles then falling back to proxy.
     *
     * @return array{tileUrl: string|null, tileSize: int, minZoom: int, maxZoom: int, defaultZoom: int, center: array{x: int, y: int}, dzi: array|null}
     */
    public function build(): array
    {
        $localDzi = $this->getLocalDziConfig();

        if ($localDzi) {
            $levels = $this->availableTileLevels();
            $maxLevel = $levels !== [] ? max($levels) : (int) ($localDzi['maxNativeZoom']);
            // minLevel: first pyramid level with > 1 tile, +1 to skip the
            // top-down-looking far-overview level the user explicitly didn't
            // want. Leaflet won't allow zooming out past this.
            $minLevel = $this->firstMultiTileLevel($levels) + 1;
            // maxLevel: allow Leaflet to digital-zoom 7 levels beyond the
            // deepest pyramid level on disk. The raster fallback gets
            // upscaled (blurry) past +2, but the WebGL renderer paints
            // every level natively from cell data — pixelsPerSquare at z+7
            // hits ~64 px/square, which is close to native PZ sprite size.
            $leafletMaxZoom = $maxLevel + 10;
            // pzmap2dzi may emit a pyramid that goes higher than ceil(log2(w/tile_size))
            // (e.g. with tile_align_levels offset or large tile_size). Leaflet's CRS
            // transformation needs maxNativeZoom = highest pyramid level on disk —
            // otherwise tile_x/tile_y math is off by 2^(maxLevel - computedNative).
            $localDzi['maxNativeZoom'] = $maxLevel;

            // The dimensions in map_info.json are post-"skip" sizes that don't
            // reflect the actual native pyramid extent on disk. CRS bounds built
            // from those would clip the viewport and stop Leaflet from
            // requesting any tile. Rebuild width/height from the real max
            // tile coordinate on the deepest level.
            $tileSize = MapRenderSetting::instance()->effectiveTileSize();
            $deepBounds = $this->tileBoundsForLevel($maxLevel);
            if ($deepBounds !== null) {
                $localDzi['width'] = ($deepBounds['maxX'] + 1) * $tileSize;
                $localDzi['height'] = ($deepBounds['maxY'] + 1) * $tileSize;
            }
            // Open the map close to max detail — most users want streets and
            // buildings, not a far overview. Two levels below native is a
            // good balance: detailed enough to see roads, wide enough to see
            // surroundings.
            $defaultLevel = max($minLevel+4, $maxLevel +4);

            // pzmap2dzi shifts tile coordinates (tile_align_levels), so reading
            // them straight from disk is the only reliable way to land Leaflet's
            // viewport on real tiles instead of empty (0, 0) coords.
            $tileBounds = $deepBounds;
            $center = $tileBounds !== null
                ? $this->centerFromTileBounds($tileBounds, $maxLevel, $tileSize, $localDzi, $maxLevel)
                : $this->localDziCenter($localDzi);

            $webglMeta = $this->readAtlasManifest();

            return [
                'tileUrl' => '/map-tiles/{z}/{x}_{y}.jpg',
                'tileSize' => $tileSize,
                'minZoom' => $minLevel,
                'maxZoom' => $leafletMaxZoom,
                'defaultZoom' => $defaultLevel,
                'center' => $center,
                'dzi' => $localDzi,
                'useWebGL' => $this->isWebGLAtlasAvailable(),
                'webGLAtlasUrl' => '/pz-atlas',
                'webGLLodCount' => $webglMeta['lod_count'],
                'webGLHasKtx2' => $webglMeta['has_ktx2'],
                'webGLHasCellPages' => $webglMeta['has_cell_pages'],
                'webGLCellPagesUrl' => '/pz-atlas/cell-pages.json',
                'cellsManifestUrl' => '/admin/api/pz-map/cells.json',
            ];
        }

        // Fall back to proxy tiles from map.projectzomboid.com
        $proxyDzi = config('zomboid.map.proxy_dzi');
        $w = $proxyDzi['width'];
        $h = $proxyDzi['height'];
        $sqr = $proxyDzi['sqr'];
        $maxNativeZoom = (int) ceil(log(max($w, $h), 2));

        return [
            'tileUrl' => config('zomboid.map.proxy_url'),
            'tileSize' => config('zomboid.map.proxy_tile_size'),
            'minZoom' => config('zomboid.map.min_zoom'),
            'maxZoom' => config('zomboid.map.max_zoom'),
            'defaultZoom' => config('zomboid.map.default_zoom'),
            'center' => [
                'x' => config('zomboid.map.center_x'),
                'y' => config('zomboid.map.center_y'),
            ],
            'dzi' => [
                'width' => $w,
                'height' => $h,
                'x0' => $proxyDzi['x0'],
                'y0' => $proxyDzi['y0'],
                'sqr' => $sqr,
                'maxNativeZoom' => $maxNativeZoom,
                'isometric' => true,
            ],
        ];
    }

    /**
     * Scan the layer0_files directory for the actual numeric zoom levels on
     * disk. This is the authoritative source for Leaflet's min/max zoom — it
     * follows whatever pzmap2dzi produced for the current tile_size /
     * omit_levels combination, instead of relying on stale config defaults.
     *
     * @return array<int, int>
     */
    private function availableTileLevels(): array
    {
        $dziPath = config('zomboid.map.tiles_path').'/html/map_data/base/layer0_files';

        if (! is_dir($dziPath)) {
            return [];
        }

        $entries = @scandir($dziPath);

        if ($entries === false) {
            return [];
        }

        $levels = [];

        foreach ($entries as $entry) {
            if (! ctype_digit($entry)) {
                continue;
            }

            $levelDir = $dziPath.'/'.$entry;

            if (is_dir($levelDir) && (glob($levelDir.'/*.jpg') || glob($levelDir.'/*.webp'))) {
                $levels[] = (int) $entry;
            }
        }

        return $levels;
    }

    /**
     * Whether the WebGL renderer atlas has been built and is ready to serve.
     */
    private function isWebGLAtlasAvailable(): bool
    {
        $manifestPath = rtrim((string) config('zomboid.map.tiles_path', '/map-tiles'), '/').'/web/manifest.json';

        return is_file($manifestPath);
    }

    /**
     * Read the atlas manifest.json to surface LOD/KTX2 metadata to the
     * frontend. Returns sane defaults when the manifest is missing or
     * malformed — the frontend already gracefully degrades to single-LOD.
     *
     * @return array{lod_count: int, has_ktx2: bool, has_cell_pages: bool}
     */
    private function readAtlasManifest(): array
    {
        $defaults = ['lod_count' => 1, 'has_ktx2' => false, 'has_cell_pages' => false];
        $manifestPath = rtrim((string) config('zomboid.map.tiles_path', '/map-tiles'), '/').'/web/manifest.json';
        if (! is_file($manifestPath)) {
            return $defaults;
        }
        $data = json_decode((string) file_get_contents($manifestPath), true);
        if (! is_array($data)) {
            return $defaults;
        }

        return [
            'lod_count' => is_array($data['lods'] ?? null) ? count($data['lods']) : 1,
            'has_ktx2' => (bool) ($data['has_ktx2'] ?? false),
            'has_cell_pages' => (bool) ($data['has_cell_pages'] ?? false),
        ];
    }

    /**
     * Return the first pyramid level that contains more than one rendered
     * tile. Levels below that fit the whole map into a single tile and
     * provide no useful zoom-out — Leaflet shouldn't let the user dive
     * down there.
     *
     * @param  array<int, int>  $levels
     */
    private function firstMultiTileLevel(array $levels): int
    {
        if ($levels === []) {
            return 0;
        }

        sort($levels);

        $dziPath = config('zomboid.map.tiles_path').'/html/map_data/base/layer0_files';

        foreach ($levels as $level) {
            $tileFiles = glob($dziPath.'/'.$level.'/*.jpg') ?: [];

            if (count($tileFiles) > 1) {
                return $level;
            }

            $webp = glob($dziPath.'/'.$level.'/*.webp') ?: [];

            if (count($webp) > 1) {
                return $level;
            }
        }

        // Fallback: deepest level if nothing has multiple tiles (very small map).
        return end($levels);
    }

    /**
     * Read every .jpg/.webp filename in a given level directory and return the
     * x/y bounds. pzmap2dzi names tiles "<x>_<y>.jpg" — the smallest/largest
     * coordinates are the only thing that tell us where the rendered area is.
     *
     * @return array{minX: int, maxX: int, minY: int, maxY: int}|null
     */
    private function tileBoundsForLevel(int $level): ?array
    {
        $dziPath = config('zomboid.map.tiles_path').'/html/map_data/base/layer0_files/'.$level;

        if (! is_dir($dziPath)) {
            return null;
        }

        $entries = @scandir($dziPath);

        if ($entries === false) {
            return null;
        }

        $minX = $maxX = $minY = $maxY = null;

        foreach ($entries as $entry) {
            // Only count real tiles; pzmap2dzi drops ".empty" markers for
            // chunks that contain no map data, and those would skew bounds
            // outward into empty space.
            if (preg_match('/^(\d+)_(\d+)\.(?:jpg|webp)$/', $entry, $m) !== 1) {
                continue;
            }

            $x = (int) $m[1];
            $y = (int) $m[2];

            $minX = $minX === null ? $x : min($minX, $x);
            $maxX = $maxX === null ? $x : max($maxX, $x);
            $minY = $minY === null ? $y : min($minY, $y);
            $maxY = $maxY === null ? $y : max($maxY, $y);
        }

        if ($minX === null) {
            return null;
        }

        return ['minX' => $minX, 'maxX' => $maxX, 'minY' => $minY, 'maxY' => $maxY];
    }

    /**
     * Convert tile-coordinate bounds on a given level into the PZ (sx, sy) pair
     * that the isometric projection in pz-map.tsx will project back onto the
     * geometric centre of the rendered area.
     *
     * @param  array{minX: int, maxX: int, minY: int, maxY: int}  $bounds
     * @param  array{width: int, height: int, x0: int, y0: int, sqr: int, isometric: bool, maxNativeZoom: int}  $dzi
     * @return array{x: int, y: int}
     */
    private function centerFromTileBounds(array $bounds, int $level, int $tileSize, array $dzi, int $maxLevel): array
    {
        $scale = 1 << max(0, $maxLevel - $level);

        // tile (mid, mid) on this level → native pixel coords
        $tileMidX = ($bounds['minX'] + $bounds['maxX']) / 2 + 0.5;
        $tileMidY = ($bounds['minY'] + $bounds['maxY']) / 2 + 0.5;
        $nativePx = $tileMidX * $tileSize * $scale;
        $nativePy = $tileMidY * $tileSize * $scale;

        if (! $dzi['isometric']) {
            $sqr = max(1, $dzi['sqr']);

            return [
                'x' => (int) round(($nativePx - $dzi['x0']) / $sqr),
                'y' => (int) round(($nativePy - $dzi['y0']) / $sqr),
            ];
        }

        // Inverse of pz-map.tsx isometric projection.
        $sqr = max(1, $dzi['sqr']);
        $halfSqr = $sqr / 2;
        $quarterSqr = $sqr / 4;

        $sxMinusSy = ($nativePx - $dzi['x0']) / $halfSqr;
        $sxPlusSy = ($nativePy - $dzi['y0'] - $quarterSqr) / $quarterSqr;

        return [
            'x' => (int) round(($sxPlusSy + $sxMinusSy) / 2),
            'y' => (int) round(($sxPlusSy - $sxMinusSy) / 2),
        ];
    }

    /**
     * Compute the PZ-coordinate center of a locally rendered DZI so that the
     * isometric projection in pz-map.tsx ends up on the pixel center of the map.
     *
     * Inverse of the projection:
     *   px = (sx - sy) * sqr/2 + x0
     *   py = (sx + sy) * sqr/4 + y0 + sqr/4
     *
     * Target the pixel center (x0 + width/2, y0 + height/2) and solve for (sx, sy).
     *
     * @param  array{width: int, height: int, x0: int, y0: int, sqr: int, isometric: bool}  $dzi
     * @return array{x: int, y: int}
     */
    private function localDziCenter(array $dzi): array
    {
        if (! $dzi['isometric']) {
            // Top-view: linear mapping, center is simply width/2, height/2 in squares.
            return [
                'x' => (int) round($dzi['width'] / 2 / max(1, $dzi['sqr'])),
                'y' => (int) round($dzi['height'] / 2 / max(1, $dzi['sqr'])),
            ];
        }

        $sqr = max(1, $dzi['sqr']);
        $sxMinusSy = $dzi['width'] / $sqr;
        $sxPlusSy = (2 * $dzi['height'] - $sqr) / $sqr;

        return [
            'x' => (int) round(($sxPlusSy + $sxMinusSy) / 2),
            'y' => (int) round(($sxPlusSy - $sxMinusSy) / 2),
        ];
    }

    /**
     * Get DZI config from locally generated tiles, or null if not available.
     *
     * @return array{width: int, height: int, x0: int, y0: int, sqr: int, maxNativeZoom: int, isometric: bool}|null
     */
    private function getLocalDziConfig(): ?array
    {
        $dziPath = config('zomboid.map.tiles_path').'/html/map_data/base/layer0_files';

        if (! is_dir($dziPath)) {
            return null;
        }

        // With larger tile_size or coarser quality presets, pzmap2dzi only
        // populates the levels where the map is bigger than one tile (e.g.
        // levels 13–22), leaving levels 0–12 as empty directories. So treat
        // ANY non-empty level as proof that a local render is available.
        if ($this->availableTileLevels() === []) {
            return null;
        }

        $infoPath = config('zomboid.map.tiles_path').'/html/map_data/base/map_info.json';

        if (! is_file($infoPath)) {
            return null;
        }

        $mapInfo = json_decode(file_get_contents($infoPath), true);

        $w = (int) $mapInfo['w'];
        $h = (int) $mapInfo['h'];
        $nativeSqr = (float) ($mapInfo['sqr'] ?? 1);
        // pzmap2dzi writes x0/y0/sqr in NATIVE pyramid coordinates (top of the
        // tile pyramid, before "skip" levels are dropped). w/h on the other
        // hand describe the effective image after the skip. To use these
        // values together we must rescale x0/y0/sqr by 2^skip so every field
        // lives in the same effective coordinate system that Leaflet sees.
        $skipLevels = (int) ($mapInfo['skip'] ?? 0);
        $skipScale = 1 << max(0, $skipLevels);

        $effectiveSqr = $nativeSqr / $skipScale;
        $worldX0 = ((int) ($mapInfo['x0'] ?? 0)) / $skipScale;
        $worldY0 = ((int) ($mapInfo['y0'] ?? 0)) / $skipScale;

        // pzmap2dzi B42 lays tiles at native pixel coordinates [0, w] x [0, h].
        // The x0/y0 stored in map_info.json describe this map's offset in the
        // *global* PZ world (so multiple chunks can be aligned), not the local
        // tile origin. Feeding those values into the isometric projection in
        // pz-map.tsx shifts every Leaflet tile request far outside the rendered
        // bounds, so we anchor the local DZI at (0, 0).
        //
        // worldX0/worldY0 preserve the rescaled values for cell-coordinate
        // computation in the WebGL renderer: cells live in the actual PZ world
        // space and need the world offset to map back to (cellX, cellY) on disk.
        // Isometric flag is decided from the NATIVE sqr (a downscaled effective
        // sqr can be < 2 even when the map itself is isometric).
        return [
            'width' => $w,
            'height' => $h,
            'x0' => 0,
            'y0' => 0,
            'worldX0' => $worldX0,
            'worldY0' => $worldY0,
            'sqr' => $effectiveSqr,
            'maxNativeZoom' => (int) ceil(log(max($w, $h), 2)),
            'isometric' => $nativeSqr > 2,
            // Native pixel → effective pixel scale. WebGL shader needs this
            // to render sprite atlas data (which lives in native pixels) on
            // top of effective-space coordinates.
            'nativeToEffective' => 1.0 / $skipScale,
        ];
    }
}
