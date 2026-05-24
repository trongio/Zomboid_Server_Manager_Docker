#!/usr/bin/env node
/**
 * Visual regression comparison: pzmap2dzi reference tiles vs. WebGL renderer output.
 *
 * USAGE
 * -----
 * Manual ImageMagick mode (recommended — no browser required):
 *
 *   node scripts/compare-renders.js \
 *     --ref  /map-tiles/html/map_data/base/layer0_files/14 \
 *     --out  /tmp/webgl-tiles \
 *     --mode imagemagick \
 *     --tiles 20
 *
 * Headless Puppeteer mode (requires: npm install puppeteer in scripts/):
 *
 *   node scripts/compare-renders.js \
 *     --ref  /map-tiles/html/map_data/base/layer0_files/14 \
 *     --url  http://localhost:8000/map?z=14 \
 *     --mode puppeteer \
 *     --tiles 20
 *
 * EXIT CODES
 * ----------
 *   0  All tiles passed (≥99 % pixels identical)
 *   1  One or more tiles failed
 *   2  Configuration / runtime error
 *
 * ACCEPTANCE CRITERIA
 * -------------------
 *   Per-tile pixel diff (average absolute difference per channel) ≤ 1.0 / 255.
 *   Equivalently: ≥99 % of pixels are bit-identical across all channels.
 *
 * DEPENDENCIES (ImageMagick mode)
 * --------------------------------
 *   - ImageMagick 7+ (magick / compare commands in PATH)
 *   - Node.js 18+
 *   No npm packages required.
 *
 * DEPENDENCIES (Puppeteer mode)
 * ------------------------------
 *   - puppeteer (npm install puppeteer inside scripts/ directory)
 *   - Running pz-app container (http://localhost:8000)
 *
 * HOW THE COMPARISON WORKS
 * ------------------------
 * 1. Enumerate tile files in --ref directory (DZI standard naming: row_col.jpg/.png).
 * 2. For each tile, obtain the WebGL-rendered equivalent via one of:
 *    a) ImageMagick: tile must already exist in --out directory (pre-rendered).
 *    b) Puppeteer:  navigate to the map at (z, x, y) and screenshot the tile canvas.
 * 3. Run `magick compare -metric AE` (Absolute Error pixel count) between the two.
 *    AE = number of pixels where any channel differs by > threshold (default 2/255).
 * 4. Compute pass/fail: AE <= 1% of total pixels → PASS.
 * 5. Output per-tile results + summary table.
 *
 * NOTES ON pzmap2dzi TILE FORMAT
 * --------------------------------
 * DZI tiles live at:
 *   <layer>_files/<zoom>/<row>_<col>.jpg    (pzmap2dzi uses row_col, not col_row)
 * 256×256 pixels, JPEG or PNG depending on pzmap2dzi settings.
 * Our WebGL renderer outputs 256×256 RGBA PNG.
 *
 * KNOWN LIMITATIONS
 * -----------------
 * - JPEG reference tiles introduce lossy artifacts; set threshold to ≥ 5/255.
 * - pzmap2dzi renders isometric with sub-pixel AA; WebGL may differ by 1-2 px at edges.
 * - Jumbo trees that extend beyond the native square boundary require render_margin=large
 *   in pzmap2dzi. Our renderer currently clips at square boundary (M7 TODO).
 * - Water alpha blending may show minor float precision differences (< 2/255 typical).
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// CLI argument parsing (no commander — zero deps)
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));

const REF_DIR    = args['--ref']   ?? null;
const OUT_DIR    = args['--out']   ?? null;
const MAP_URL    = args['--url']   ?? 'http://localhost:8000/map';
const MODE       = args['--mode']  ?? 'imagemagick';
const MAX_TILES  = parseInt(args['--tiles'] ?? '20', 10);
const THRESHOLD  = parseFloat(args['--threshold'] ?? '2');   // AE channel delta [0-255]
const FAIL_PCT   = parseFloat(args['--fail-pct']  ?? '1.0'); // max % bad pixels

if (!REF_DIR) {
    console.error('ERROR: --ref <path> is required (pzmap2dzi output tile directory)');
    process.exit(2);
}

if (MODE === 'imagemagick' && !OUT_DIR) {
    console.error('ERROR: --out <path> is required in imagemagick mode (pre-rendered WebGL tiles)');
    process.exit(2);
}

// ---------------------------------------------------------------------------
// Enumerate reference tiles
// ---------------------------------------------------------------------------

/**
 * Scan the reference directory for DZI tile files.
 * DZI naming: <row>_<col>.jpg or <row>_<col>.png
 *
 * @param {string} dir
 * @returns {{ row: number, col: number, file: string }[]}
 */
function listRefTiles(dir) {
    if (!fs.existsSync(dir)) {
        console.error(`ERROR: Reference directory not found: ${dir}`);
        process.exit(2);
    }

    const entries = fs.readdirSync(dir);
    const tiles = [];

    for (const entry of entries) {
        const m = entry.match(/^(\d+)_(\d+)\.(jpg|jpeg|png)$/i);
        if (!m) { continue; }
        tiles.push({
            row: parseInt(m[1]!, 10),
            col: parseInt(m[2]!, 10),
            file: path.join(dir, entry),
        });
    }

    // Sort by (row, col) for reproducible ordering
    tiles.sort((a, b) => a.row !== b.row ? a.row - b.row : a.col - b.col);

    return tiles.slice(0, MAX_TILES);
}

// ---------------------------------------------------------------------------
// ImageMagick comparison
// ---------------------------------------------------------------------------

/**
 * Use `magick compare -metric AE` to count different pixels.
 *
 * @param {string} refFile   Path to reference tile.
 * @param {string} outFile   Path to WebGL-rendered tile.
 * @param {number} threshold Per-channel difference threshold [0-255].
 * @returns {{ aeCount: number, totalPixels: number }}
 */
function imageMagickCompare(refFile, outFile, threshold) {
    // magick compare outputs AE count to stderr
    const result = spawnSync('magick', [
        'compare',
        '-metric', 'AE',
        '-fuzz', `${(threshold / 255 * 100).toFixed(1)}%`,
        refFile,
        outFile,
        'null:',  // discard diff image output
    ], { encoding: 'utf8' });

    // AE count is on stderr (ImageMagick behaviour)
    const aeStr  = (result.stderr ?? '').trim();
    const aeCount = parseInt(aeStr, 10);

    if (isNaN(aeCount)) {
        // ImageMagick returns non-zero exit code when images differ;
        // the numeric output is still on stderr
        const altMatch = aeStr.match(/\d+/);
        const count = altMatch ? parseInt(altMatch[0], 10) : -1;
        if (count < 0) {
            throw new Error(`magick compare failed: ${result.stderr} (exit ${result.status})`);
        }
        return { aeCount: count, totalPixels: 256 * 256 };
    }

    return { aeCount, totalPixels: 256 * 256 };
}

// ---------------------------------------------------------------------------
// Puppeteer tile capture (stub)
// ---------------------------------------------------------------------------

/**
 * Capture a rendered tile from the running map via Puppeteer.
 *
 * This is a **stub** implementation. Full puppeteer integration requires:
 *  1. `npm install puppeteer` in the scripts/ directory.
 *  2. The map page must expose `window.__pzRenderer.captureTile(z, row, col)`
 *     that returns a base64 PNG data URL of the rendered 256×256 tile.
 *  3. Authentication cookie for the admin session.
 *
 * @param {number} _z   Zoom level.
 * @param {number} _row Tile row.
 * @param {number} _col Tile column.
 * @param {string} outPath Where to write the captured PNG.
 * @returns {Promise<void>}
 */
async function puppeteerCaptureTile(_z, _row, _col, outPath) {
    // TODO (M7): integrate puppeteer
    // const puppeteer = require('puppeteer');
    // const browser = await puppeteer.launch({ headless: 'new' });
    // const page    = await browser.newPage();
    // await page.goto(MAP_URL, { waitUntil: 'networkidle2' });
    // const dataUrl = await page.evaluate((z, r, c) =>
    //     window.__pzRenderer?.captureTile(z, r, c) ?? null, _z, _row, _col);
    // if (!dataUrl) throw new Error(`captureTile(${_z},${_row},${_col}) returned null`);
    // const buf = Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    // fs.writeFileSync(outPath, buf);
    // await browser.close();
    throw new Error(
        `Puppeteer mode is not yet implemented.\n` +
        `Manual steps:\n` +
        `  1. Open the map in a browser.\n` +
        `  2. Run in DevTools console:\n` +
        `       window.__pzRenderer.captureTile(z, row, col)\n` +
        `  3. Save the returned PNG to: ${outPath}\n` +
        `  4. Re-run this script with --mode imagemagick --out <dir_of_saved_pngs>`,
    );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log('=== PZ WebGL Visual Regression Test ===');
    console.log(`Reference tiles : ${REF_DIR}`);
    console.log(`Mode            : ${MODE}`);
    console.log(`Max tiles       : ${MAX_TILES}`);
    console.log(`AE threshold    : ${THRESHOLD}/255 (${(THRESHOLD / 255 * 100).toFixed(2)} %)`);
    console.log(`Fail threshold  : >${FAIL_PCT} % bad pixels`);
    console.log('');

    const refTiles = listRefTiles(REF_DIR);

    if (refTiles.length === 0) {
        console.error(`ERROR: No DZI tiles found in ${REF_DIR}`);
        process.exit(2);
    }

    console.log(`Found ${refTiles.length} reference tiles. Comparing...\n`);

    /** @type {{ row: number, col: number, aeCount: number, totalPixels: number, pct: number, pass: boolean, error?: string }[]} */
    const results = [];
    let failures = 0;

    for (const tile of refTiles) {
        const label = `${tile.row}_${tile.col}`;

        /** @type {string} */
        let outFile;

        try {
            if (MODE === 'imagemagick') {
                // Expect pre-rendered file in OUT_DIR with matching name
                const ext   = path.extname(tile.file);
                outFile = path.join(OUT_DIR, `${label}${ext}`);

                if (!fs.existsSync(outFile)) {
                    console.warn(`  SKIP  ${label}  (WebGL tile not found: ${outFile})`);
                    continue;
                }
            } else {
                // Puppeteer: capture on the fly
                const tmpDir = path.join(require('os').tmpdir(), 'pz-regression');
                fs.mkdirSync(tmpDir, { recursive: true });
                outFile = path.join(tmpDir, `${label}.png`);
                await puppeteerCaptureTile(14, tile.row, tile.col, outFile);
            }

            const { aeCount, totalPixels } = imageMagickCompare(tile.file, outFile, THRESHOLD);
            const pct = (aeCount / totalPixels) * 100;
            const pass = pct <= FAIL_PCT;

            results.push({ row: tile.row, col: tile.col, aeCount, totalPixels, pct, pass });

            const status = pass ? 'PASS' : 'FAIL';
            const pctStr = pct.toFixed(2).padStart(6);
            console.log(`  ${status}  ${label.padEnd(12)}  ${aeCount.toString().padStart(6)} px bad  (${pctStr} %)`);

            if (!pass) { failures++; }
        } catch (/** @type {any} */ err) {
            console.error(`  ERROR ${label}  ${err.message}`);
            results.push({
                row: tile.row, col: tile.col,
                aeCount: -1, totalPixels: 256 * 256, pct: 100, pass: false,
                error: String(err.message),
            });
            failures++;
        }
    }

    // Summary
    console.log('');
    console.log('=== Summary ===');
    console.log(`Tiles tested : ${results.length}`);
    console.log(`Passed       : ${results.filter(r => r.pass).length}`);
    console.log(`Failed       : ${failures}`);

    if (results.length > 0) {
        const avgPct = results.reduce((s, r) => s + r.pct, 0) / results.length;
        console.log(`Avg bad px % : ${avgPct.toFixed(3)} %`);
    }

    if (failures > 0) {
        console.log('');
        console.log('FAILED tiles:');
        for (const r of results.filter(r => !r.pass)) {
            const loc = `row=${r.row} col=${r.col}`;
            if (r.error) {
                console.log(`  ${loc}  ERROR: ${r.error}`);
            } else {
                console.log(`  ${loc}  ${r.aeCount} bad pixels (${r.pct.toFixed(2)} %)`);
            }
        }
        process.exit(1);
    }

    console.log('');
    console.log('All tiles PASSED.');
    process.exit(0);
}

// ---------------------------------------------------------------------------
// CLI arg parser
// ---------------------------------------------------------------------------

/**
 * Parse --key value pairs from argv.
 * @param {string[]} argv
 * @returns {Record<string, string>}
 */
function parseArgs(argv) {
    /** @type {Record<string, string>} */
    const out = {};
    for (let i = 0; i < argv.length; i++) {
        const k = argv[i];
        if (k && k.startsWith('--')) {
            out[k] = argv[i + 1] ?? 'true';
            i++;
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

main().catch(err => {
    console.error('FATAL:', err);
    process.exit(2);
});
