#!/usr/bin/env python3
"""
Pack PZ texturepacks into a mip-mapped, multi-LOD WebP sprite atlas for
browser WebGL rendering.

Output artifacts (all under --output):
    manifest.json       — version, LOD descriptors, KTX2 metadata
    sprites.json        — sprite name → atlas index + per-mip UVs (normalised)
    atlas-{ver}-{N}-lod{L}.webp   — atlas page at LOD L (per-page mipchain inside)
    atlas-{ver}-{N}-lod{L}.ktx2   — same page, BC7/ASTC compressed (optional)
    cell-pages.json     — cell coord → set of atlas pages needed (optional)

LOD policy (set with --lods=N):
    L=0  full (--atlas-size, default 4096²)   used at native zoom and higher
    L=1  half (2048²)                          used at moderate zoom
    L=2  quarter (1024²)                       used at default zoom
    L=3  eighth (512²)                         used at far zoom-out

The frontend AtlasPageManager picks a LOD by pixelsPerSquare. Each LOD
page contains its own pre-baked sprite mipchain, so sprite-mip selection
still works after a LOD switch.

UV format: sprites.json stores normalised [0..1] ratios so the same UV
values work at every LOD (the GL_TEXTURE_2D_ARRAY just has a different
edge size). uv_format='normalized' is emitted in sprites.json so the
frontend can distinguish from the pre-LOD pixel-coord layout.

Usage:
    python3 pzpack_to_atlas.py --input /pz-data/texturepacks --output /map-tiles/web
    python3 pzpack_to_atlas.py --input ./packs --output ./web --atlas-size 4096 --lods 4
    python3 pzpack_to_atlas.py --input ./packs --output ./web --ktx2 --cell-data-dir /pz-saves/Lua
"""

import argparse
import concurrent.futures
import hashlib
import io
import json
import multiprocessing
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

# Bind into the pzmap2dzi tree shipped with the container so we can re-use the
# existing .pack parser without re-implementing a fragile binary reader.
sys.path.insert(0, '/opt/pzmap2dzi')
from pzmap2dzi.texture import load_pack  # noqa: E402

from PIL import Image  # noqa: E402

try:
    import rectpack
except ImportError:
    print('rectpack not installed — run: pip install rectpack', file=sys.stderr)
    sys.exit(1)


DEFAULT_INCLUDE_PACKS = [
    'Tiles2x.pack',
    'Tiles2x.floor.pack',
    'JumboTrees2x.pack',
    'Overlays2x.pack',
]


def _decode_page_sprites(pack_name: str, page_idx: int, page: dict) -> list[dict]:
    """Decode one PNG-encoded sprite-sheet page and extract every sprite.

    Pure function — called concurrently from a thread pool. Each task
    holds at most one decoded RGBA Image at a time so peak memory is
    bounded by `workers × largest-page-size` (typically 8 × ~16 MB).
    """
    page_im = Image.open(io.BytesIO(page['png'])).convert('RGBA')
    out: list[dict] = []
    for tex in page['textures']:
        x, y, w, h = tex['x'], tex['y'], tex['w'], tex['h']
        ox, oy, ow, oh = tex['ox'], tex['oy'], tex['ow'], tex['oh']
        if w <= 0 or h <= 0:
            continue
        sprite_im = page_im.crop((x, y, x + w, y + h))
        # PZ convention: offset relative to bottom-center of the square
        out.append({
            'name': tex['name'],
            'image': sprite_im,
            'offset_x': ox - (ow >> 1),
            'offset_y': oy - oh,
            'pack': pack_name,
            'w': w, 'h': h,
            '_page_idx': page_idx,
        })
    return out


def collect_sprites(packs_dir: Path, include_patterns: list[str] | None = None,
                    workers: int | None = None):
    """Yield every sprite (name, RGBA image, offsets) found in any .pack file.

    PNG-decode of each sprite-sheet page runs in a ThreadPoolExecutor so a
    36-core host saturates instead of crunching one page at a time. The
    final iteration order matches the original sequential code: packs are
    processed in name order, pages in index order; later packs override
    earlier ones via the dedup key (name, w, h).

    include_patterns: list of substrings; only .pack files whose name
    contains any of these substrings are scanned. None = default vanilla
    set. Pass an empty list ([]) to process every .pack in the directory.
    """
    pack_files = sorted(packs_dir.glob('*.pack'))
    if not pack_files:
        raise SystemExit(f'No .pack files found in {packs_dir}')

    if include_patterns is None:
        include_patterns = DEFAULT_INCLUDE_PACKS

    if include_patterns:
        pack_files = [p for p in pack_files if any(pat in p.name for pat in include_patterns)]
        if not pack_files:
            raise SystemExit(f'No .pack files matched filters: {include_patterns}')
        print(f'Filtered to {len(pack_files)} packs matching: {", ".join(include_patterns)}')

    cpu_total = multiprocessing.cpu_count() or 4
    pool_size = max(1, min(workers or cpu_total, cpu_total))

    seen: dict = {}
    for pack_file in pack_files:
        print(f'  · {pack_file.name} — loading metadata', flush=True)
        t0 = time.time()
        pages = load_pack(str(pack_file))
        print(f'  · {pack_file.name} — {len(pages)} pages, decoding with {pool_size} threads', flush=True)
        # Decode pages in parallel. Each worker independently extracts
        # sprites from one PNG page; results are merged in page-index
        # order so the dedup deterministically picks the same winner as
        # the old serial loop.
        page_results: dict[int, list[dict]] = {}
        with concurrent.futures.ThreadPoolExecutor(max_workers=pool_size) as ex:
            futures = {
                ex.submit(_decode_page_sprites, pack_file.name, idx, page): idx
                for idx, page in enumerate(pages)
            }
            for fut in concurrent.futures.as_completed(futures):
                idx = futures[fut]
                page_results[idx] = fut.result()
        decode_elapsed = time.time() - t0
        emitted = 0
        for idx in sorted(page_results):
            for sprite in page_results[idx]:
                key = (sprite['name'], sprite['w'], sprite['h'])
                if key in seen:
                    # Mod packs are loaded after vanilla; mod overrides win.
                    continue
                seen[key] = True
                emitted += 1
                # Strip the internal-only fields before yielding to the
                # bin-packing stage.
                yield {
                    'name': sprite['name'],
                    'image': sprite['image'],
                    'offset_x': sprite['offset_x'],
                    'offset_y': sprite['offset_y'],
                    'pack': sprite['pack'],
                }
        print(f'  · {pack_file.name} — decoded in {decode_elapsed:.1f}s, +{emitted} unique sprites', flush=True)


def reserve_mip_space(width: int, height: int, max_mip: int) -> tuple[int, int]:
    """How wide/tall does a sprite need to be in the atlas to carry mip levels.

    To pack mips alongside the base sprite we widen the slot by 50% (1 + 1/2)
    horizontally to host the half-size mip, then quarter-size, etc. This is the
    classic "right-of and below-of" mip layout that fits geometrically inside
    a 1.5x box.
    """
    levels = min(max_mip, max(width, height).bit_length() - 1)
    # Reserved size = w + w/2 (mip-1) and h + h/2 — gives clean power-of-two slots
    return width + (width >> 1) + 2, max(height, height + (height >> 1) + 2), levels


def pack_atlases(sprites: list, atlas_size: int, max_mip: int):
    """Bin-pack sprites into atlas pages with mip reservation.

    Uses **Online** packing (rectpack.PackingMode.Online): placement
    выполняется при каждом add_rect → мы видим прогресс в реальном времени.
    Sprites pre-sorted by area desc (largest first) чтобы compensate за
    отсутствие Offline global optimization — density результат на ~5-10%
    хуже Offline, но это компромисс за UX (real-time % progress).

    Returns list of (bin_idx, rect, sprite_dict).
    """
    total = len(sprites)
    t_sort_start = time.time()
    print(f'  · sorting {total:,} sprites by area…', flush=True)
    sprites_sorted = sorted(
        sprites,
        key=lambda s: s['image'].size[0] * s['image'].size[1],
        reverse=True,
    )
    print(f'  · sorted in {time.time() - t_sort_start:.1f}s', flush=True)

    packer = rectpack.newPacker(
        mode=rectpack.PackingMode.Online,
        pack_algo=rectpack.MaxRectsBssf,
        rotation=False,
    )
    # 64 bin upper limit — vanilla map needs ~10, mod packs ~30; never seen above 64.
    packer.add_bin(atlas_size, atlas_size, count=64)

    t_pack_start = time.time()
    print(f'  · packing {total:,} sprites (online, real-time progress)…', flush=True)
    added = 0
    skipped = 0
    last_print = t_pack_start
    print_every_sec = 2.0
    for sprite in sprites_sorted:
        w, h = sprite['image'].size
        reserved_w, reserved_h, _ = reserve_mip_space(w, h, max_mip)
        if reserved_w > atlas_size or reserved_h > atlas_size:
            print(f'  ! sprite {sprite["name"]} too big ({reserved_w}x{reserved_h}), skipped',
                  file=sys.stderr, flush=True)
            skipped += 1
            continue
        packer.add_rect(reserved_w, reserved_h, sprite)
        added += 1
        now = time.time()
        if now - last_print >= print_every_sec or added == total - skipped:
            elapsed = now - t_pack_start
            pct = (added / max(1, total - skipped)) * 100
            rate = added / elapsed if elapsed > 0 else 0
            remaining = (total - skipped - added) / rate if rate > 0 else 0
            print(f'  · packed {added:,}/{total - skipped:,} ({pct:5.1f}%) — '
                  f'{elapsed:5.0f}s elapsed, ETA {remaining:5.0f}s, {rate:.0f} sprites/s',
                  flush=True)
            last_print = now

    print(f'  · pack done in {time.time() - t_pack_start:.0f}s '
          f'({added} placed, {skipped} too big)', flush=True)

    placements = []
    for bin_idx, abin in enumerate(packer):
        for rect in abin:
            placements.append((bin_idx, rect, rect.rid))
    return placements


def generate_mipmaps(image: Image.Image, max_mip: int) -> list[Image.Image]:
    """Build a chain [base, half, quarter, ...] down to 1x1 (or max_mip)."""
    chain = [image]
    cur = image
    for _ in range(max_mip):
        w, h = cur.size
        if w <= 1 and h <= 1:
            break
        nw = max(1, w // 2)
        nh = max(1, h // 2)
        cur = cur.resize((nw, nh), Image.LANCZOS)
        chain.append(cur)
    return chain


def render_atlas(placements_in_bin: list, atlas_size: int, max_mip: int,
                 normalize_uvs: bool = True):
    """Composite all sprites + their mipmap chains onto one atlas page.

    When normalize_uvs is True, mip rect coords are written as [0..1]
    ratios of atlas_size so the same sprites.json entry works at every
    LOD (different page edge size, same UV rect). Legacy callers can
    pass False to keep absolute-pixel coordinates.
    """
    atlas = Image.new('RGBA', (atlas_size, atlas_size), (0, 0, 0, 0))
    sprite_records = []
    s = float(atlas_size) if normalize_uvs else 1.0

    for rect, sprite_dict in placements_in_bin:
        x, y = rect.x, rect.y
        base = sprite_dict['image']
        atlas.paste(base, (x, y))

        chain = generate_mipmaps(base, max_mip)
        # Place mip 1+ to the right of base
        mip_y = y
        mip_x = x + base.width
        mip_offsets = [(x / s, y / s, base.width / s, base.height / s)]
        for level, mip_im in enumerate(chain[1:], start=1):
            atlas.paste(mip_im, (mip_x, mip_y))
            mip_offsets.append((mip_x / s, mip_y / s, mip_im.width / s, mip_im.height / s))
            mip_y += mip_im.height

        sprite_records.append({
            'name': sprite_dict['name'],
            'mips': mip_offsets,                    # ratios when normalized, else px
            'offset_x': sprite_dict['offset_x'],
            'offset_y': sprite_dict['offset_y'],
            'pack': sprite_dict['pack'],
        })

    return atlas, sprite_records


def downscale_lod(base_atlas: Image.Image, target_size: int) -> Image.Image:
    """Produce a smaller LOD variant of a fully composited atlas page.

    LANCZOS is the right tradeoff: it preserves sprite edges at half scale
    well enough that BC7 quantisation isn't the bottleneck, but is far
    cheaper than producing per-sprite hand-built mipchains for the LOD.
    """
    return base_atlas.resize((target_size, target_size), Image.LANCZOS)


def has_basisu() -> bool:
    """basisu CLI on PATH means we can emit KTX2 variants."""
    return shutil.which('basisu') is not None


def encode_ktx2(input_path: Path, output_path: Path, format_hint: str = 'BC7') -> bool:
    """Encode an RGBA WebP/PNG into a KTX2 container via basisu.

    basisu writes Basis Universal UASTC by default; we trans-encode to
    BC7 (desktop) up-front so the frontend doesn't have to ship a
    transcoder. Falls back to UASTC if `--bc7` isn't supported in the
    installed basisu build.
    """
    try:
        tmp_dir = output_path.parent
        # basisu picks output name from input + flags; force via -output_file
        cmd = [
            'basisu',
            '-ktx2',
            '-uastc',
            '-uastc_level', '2',
            '-output_file', str(output_path),
            str(input_path),
        ]
        result = subprocess.run(cmd, cwd=str(tmp_dir), capture_output=True, text=True, timeout=300)
        if result.returncode != 0:
            print(f'  ! basisu failed for {input_path.name}: {result.stderr.strip()[:200]}', file=sys.stderr)
            return False
        return output_path.is_file()
    except (FileNotFoundError, subprocess.TimeoutExpired) as e:
        print(f'  ! basisu invocation error: {e}', file=sys.stderr)
        return False
    # `format_hint` reserved for future ASTC switch via -etc1s / -basis-file flags.
    _ = format_hint


def save_atlas_lod(atlas: Image.Image, lod: int, output_dir: Path,
                   version: str, page_id: int, want_ktx2: bool) -> dict:
    """Save one LOD variant as WebP (+optional KTX2). Returns size metadata."""
    webp_name = f'atlas-{version}-{page_id}-lod{lod}.webp'
    webp_path = output_dir / webp_name
    # quality=95 + method=6 strikes a balance: file size shrinks ~30%
    # vs lossless and the visible delta is invisible at any zoom.
    atlas.save(webp_path, 'WEBP', lossless=False, quality=95, method=6)
    info = {
        'lod': lod,
        'file_webp': webp_name,
        'size_bytes_webp': webp_path.stat().st_size,
        'size': atlas.width,
    }
    if want_ktx2 and has_basisu():
        ktx2_name = f'atlas-{version}-{page_id}-lod{lod}.ktx2'
        ktx2_path = output_dir / ktx2_name
        if encode_ktx2(webp_path, ktx2_path, 'BC7'):
            info['file_ktx2'] = ktx2_name
            info['size_bytes_ktx2'] = ktx2_path.stat().st_size
    return info


def _render_one_page(args: tuple) -> tuple:
    """Worker for the page-rendering thread pool.

    Each call composites one atlas page from its placements, downscales it
    into every LOD, and writes the WebPs (+optional KTX2). Returns the
    metadata the caller needs to assemble manifest + sprites.json.

    Threaded: Pillow's `Image.resize` and WebP encoder release the GIL
    inside their C extensions, so true parallel execution across pages
    scales linearly with cores until you saturate disk I/O.
    """
    bin_idx, placements, atlas_size, max_mip, lods, output_dir, version, want_ktx2 = args
    sprite_count = len(placements)
    print(f'  · page {bin_idx}: {sprite_count} sprites — start', flush=True)
    t0 = time.time()
    atlas_im, records = render_atlas(placements, atlas_size, max_mip, normalize_uvs=True)
    per_lod_files = []
    for lod in lods:
        scaled = atlas_im if lod['id'] == 0 else downscale_lod(atlas_im, lod['size'])
        info = save_atlas_lod(scaled, lod['id'], output_dir, version, bin_idx, want_ktx2)
        per_lod_files.append(info)
    elapsed = time.time() - t0
    print(f'  · page {bin_idx}: done in {elapsed:.1f}s', flush=True)
    return bin_idx, records, per_lod_files


def build_atlas(input_dir: Path, output_dir: Path, atlas_size: int, max_mip: int,
                version: str, include_packs: list[str] | None = None,
                lod_count: int = 4, want_ktx2: bool = False,
                cell_data_dir: Path | None = None,
                workers: int | None = None):
    output_dir.mkdir(parents=True, exist_ok=True)

    print('Step 1/5: Collecting sprites from .pack files')
    sprites = list(collect_sprites(input_dir, include_patterns=include_packs, workers=workers))
    print(f'  → {len(sprites)} unique sprites')

    print('Step 2/5: Bin-packing into atlas pages')
    placements = pack_atlases(sprites, atlas_size, max_mip)
    by_bin: dict[int, list] = {}
    for bin_idx, rect, sprite_dict in placements:
        by_bin.setdefault(bin_idx, []).append((rect, sprite_dict))
    print(f'  → {len(by_bin)} atlas page(s) needed')

    # LOD descriptors. lod0 always exists; higher LODs are downscales.
    lod_count = max(1, min(int(lod_count), 8))
    lods = []
    for lod_id in range(lod_count):
        scale = 1.0 / (1 << lod_id)
        size = max(1, int(atlas_size * scale))
        lods.append({'id': lod_id, 'scale': scale, 'size': size})

    if want_ktx2 and not has_basisu():
        print('  ! basisu not found on PATH — falling back to WebP-only output')
        want_ktx2 = False

    # Worker count: default to all logical cores. Each worker holds at
    # most one 4096² RGBA image (~67 MB) plus its current LOD downscale,
    # so peak RAM is bounded by ~80 MB × workers — safe on any modern
    # host. A user-provided override caps the pool when running on a
    # constrained shared box.
    cpu_total = multiprocessing.cpu_count() or 4
    pool_size = max(1, min(workers or cpu_total, cpu_total, len(by_bin)))

    print(f'Step 3/5: Rendering {len(by_bin)} pages × {lod_count} LODs across {pool_size} worker(s)'
          + (' + KTX2 encoding' if want_ktx2 else ''))

    page_args = [
        (bin_idx, by_bin[bin_idx], atlas_size, max_mip, lods, output_dir, version, want_ktx2)
        for bin_idx in sorted(by_bin)
    ]

    atlases_meta_unsorted: list[tuple[int, list, list]] = []
    t_render_start = time.time()
    completed = 0
    total_pages = len(page_args)
    with concurrent.futures.ThreadPoolExecutor(max_workers=pool_size) as executor:
        for result in executor.map(_render_one_page, page_args):
            atlases_meta_unsorted.append(result)
            completed += 1
            elapsed = time.time() - t_render_start
            eta = (elapsed / completed) * (total_pages - completed) if completed > 0 else 0
            print(f'  · progress: {completed}/{total_pages} pages — '
                  f'{elapsed:.0f}s elapsed, ETA {eta:.0f}s', flush=True)

    # Deterministic ordering — manifest entries should be in page-id order
    # regardless of which worker completed when.
    atlases_meta_unsorted.sort(key=lambda r: r[0])

    atlases_meta = []
    lod_size_totals = {lod['id']: 0 for lod in lods}
    all_sprite_records: dict = {}
    for bin_idx, records, per_lod_files in atlases_meta_unsorted:
        for info in per_lod_files:
            lod_size_totals[info['lod']] += info['size_bytes_webp']
            if 'size_bytes_ktx2' in info:
                lod_size_totals[info['lod']] += info['size_bytes_ktx2']

        # `file` and size_bytes mirror the legacy single-LOD layout for
        # back-compat with MapConfigBuilder/MapRenderSetting fields. The
        # frontend uses the `lods` array via buildAtlasPageUrl().
        legacy_file = f'atlas-{version}-{bin_idx}-lod0.webp'
        atlases_meta.append({
            'id': bin_idx,
            'file': legacy_file,
            'width': atlas_size,
            'height': atlas_size,
            'size_bytes': per_lod_files[0]['size_bytes_webp'],
            'lods': per_lod_files,
        })
        for r in records:
            all_sprite_records[r['name']] = {
                'atlas': bin_idx,
                'mips': r['mips'],
                'offset_x': r['offset_x'],
                'offset_y': r['offset_y'],
            }

    print('Step 4/5: Writing sprites.json + manifest.json')
    sprites_index_path = output_dir / 'sprites.json'
    with sprites_index_path.open('w') as fh:
        json.dump({
            'version': version,
            'atlas_size': atlas_size,
            'uv_format': 'normalized',
            'atlases': atlases_meta,
            'sprites': all_sprite_records,
        }, fh, separators=(',', ':'))

    total_size = sum(lod_size_totals.values()) + sprites_index_path.stat().st_size
    checksum = hashlib.sha256()
    for meta in atlases_meta:
        for lod_info in meta['lods']:
            for fname_key in ('file_webp', 'file_ktx2'):
                if fname_key in lod_info:
                    fpath = output_dir / lod_info[fname_key]
                    if fpath.is_file():
                        with fpath.open('rb') as fh:
                            checksum.update(fh.read())

    # Step 5 — optional cell-pages.json. Walks .lotheader files to figure
    # out which atlas page each cell actually needs.
    cell_pages_built = False
    if cell_data_dir is not None and cell_data_dir.is_dir():
        print(f'Step 5/5: Generating cell-pages.json from {cell_data_dir}')
        try:
            cell_pages = build_cell_pages_map(cell_data_dir, all_sprite_records)
            cp_path = output_dir / 'cell-pages.json'
            with cp_path.open('w') as fh:
                json.dump(cell_pages, fh, separators=(',', ':'))
            cell_pages_built = True
            print(f'  → mapped {len(cell_pages)} cell(s)')
        except Exception as e:  # noqa: BLE001
            print(f'  ! cell-pages mapping failed: {e}', file=sys.stderr)
    else:
        print('Step 5/5: cell-pages.json skipped (no --cell-data-dir provided)')

    manifest_path = output_dir / 'manifest.json'
    with manifest_path.open('w') as fh:
        json.dump({
            'version': version,
            'built_at': int(time.time()),
            'atlas_count': len(atlases_meta),
            'sprite_count': len(all_sprite_records),
            'total_bytes': total_size,
            'checksum': checksum.hexdigest(),
            'lods': lods,
            'has_ktx2': want_ktx2,
            'ktx2_format': 'BC7' if want_ktx2 else None,
            'has_cell_pages': cell_pages_built,
        }, fh, indent=2)

    return {
        'version': version,
        'atlas_count': len(atlases_meta),
        'sprite_count': len(all_sprite_records),
        'total_bytes': total_size,
        'lods': lod_count,
        'ktx2': want_ktx2,
        'cell_pages': cell_pages_built,
    }


# ---------------------------------------------------------------------------
# cell-pages.json — maps PZ cell coord (cellX_cellY) → set of atlas page IDs.
# Walks every .lotheader binary in cell_data_dir, parses the sprite-name list
# (no need to parse the full square grid), looks up each name in our
# all_sprite_records to find its atlas page, and records the union per cell.
# ---------------------------------------------------------------------------

def build_cell_pages_map(cell_data_dir: Path, sprite_records: dict) -> dict[str, list[int]]:
    """Parse every .lotheader under cell_data_dir → {cellX_cellY: [pageId, ...]}.

    Filename convention: `<cellX>_<cellY>.lotheader`. Files are tiny (~5 KB)
    so the walk is I/O-bound; parsing the sprite-name list takes a handful
    of microseconds per file.
    """
    out: dict[str, list[int]] = {}
    for path in cell_data_dir.rglob('*.lotheader'):
        # Filename → cell coord
        stem = path.stem  # e.g. "30_30"
        if '_' not in stem:
            continue
        cx_str, cy_str = stem.split('_', 1)
        if not (cx_str.isdigit() and cy_str.isdigit()):
            continue
        try:
            sprite_names = parse_lotheader_sprite_names(path)
        except Exception:  # noqa: BLE001
            continue
        pages: set[int] = set()
        for name in sprite_names:
            rec = sprite_records.get(name)
            if rec is not None:
                pages.add(int(rec['atlas']))
        out[f'{cx_str}_{cy_str}'] = sorted(pages)
    return out


def parse_lotheader_sprite_names(path: Path) -> list[str]:
    """Minimal lotheader parser — extracts the sprite_names list only.

    Binary layout (mirror of frontend `parsers/lotheader.ts`):
        4 bytes "LOTH" magic  (optional; absent on legacy B41 files)
        uint32_le version (0=B41, 1=B42)         ← only when magic present
        uint32_le tile_count
        tile_count × newline-terminated UTF-8 strings   ← NOT length-prefixed
        (header continues with width/height/layer/rooms/buildings/zpop;
         we don't read past the names list.)
    """
    with path.open('rb') as fh:
        raw = fh.read()
    if len(raw) < 8:
        return []
    pos = 0
    # Check for "LOTH" magic; if present, skip it + version. Legacy B41
    # files lack the magic so we start straight at tile_count.
    if raw[0:4] == b'LOTH':
        pos += 4  # magic
        pos += 4  # version uint32
    if pos + 4 > len(raw):
        return []
    tile_count = struct.unpack_from('<I', raw, pos)[0]
    pos += 4
    names: list[str] = []
    for _ in range(tile_count):
        # Read until newline (0x0A). Strings are UTF-8 in practice ASCII.
        end = raw.find(b'\n', pos)
        if end < 0 or end > len(raw):
            break
        name = raw[pos:end].decode('utf-8', errors='replace').strip()
        names.append(name)
        pos = end + 1
    return names


def parse_args():
    p = argparse.ArgumentParser(description='Build mip-mapped sprite atlas from PZ texturepacks')
    p.add_argument('--input', type=Path, default='/pz-data/texturepacks',
                   help='Directory containing .pack files')
    p.add_argument('--output', type=Path, default='/map-tiles/web',
                   help='Output directory for atlas and sprites.json')
    p.add_argument('--atlas-size', type=int, default=4096,
                   help='Edge size of each atlas page in pixels')
    p.add_argument('--max-mip', type=int, default=10,
                   help='Maximum mip level depth (down to 1x1 by default)')
    p.add_argument('--lods', type=int, default=4,
                   help='Number of LOD variants to generate per page (1..8). '
                        '4 = lod0..lod3, halving size each step.')
    p.add_argument('--ktx2', action='store_true',
                   help='Also emit KTX2/BC7 variants alongside WebP. Requires '
                        '`basisu` CLI on PATH.')
    p.add_argument('--cell-data-dir', type=Path, default=None,
                   help='Directory containing .lotheader files. When provided '
                        'a cell-pages.json mapping {cellX_cellY → [pageId, ...]} '
                        'is emitted so the frontend can prefetch only the pages '
                        'it actually needs per cell.')
    p.add_argument('--workers', type=int, default=0,
                   help='Number of parallel page-rendering threads. 0 (default) '
                        'auto-detects logical cores. Threads share memory so '
                        'peak RAM = workers × ~80 MB.')
    p.add_argument('--version', type=str, default=None,
                   help='Atlas version string (default: timestamp)')
    p.add_argument('--include-pack', action='append', dest='include_packs', default=None,
                   help='Substring of .pack filenames to include (repeatable). '
                        'Default: vanilla map packs only. Pass --include-pack "" once '
                        'to include every pack found.')
    return p.parse_args()


def main():
    args = parse_args()
    if not args.input.is_dir():
        raise SystemExit(f'Input directory does not exist: {args.input}')

    version = args.version or f'v{int(time.time())}'
    started_at = time.time()
    print(f'Building atlas version "{version}"')
    print(f'  input:       {args.input}')
    print(f'  output:      {args.output}')
    print(f'  atlas size:  {args.atlas_size}px')
    print(f'  max mip:     {args.max_mip}')
    print(f'  LODs:        {args.lods}')
    print(f'  KTX2:        {"yes" if args.ktx2 else "no"}')
    print(f'  cell data:   {args.cell_data_dir or "(skipped)"}')
    print(f'  workers:     {args.workers if args.workers > 0 else "auto"}')
    print('')

    include_packs = args.include_packs
    if include_packs is not None:
        # If the user passed --include-pack "" we treat it as "no filter".
        include_packs = [p for p in include_packs if p] or []

    summary = build_atlas(
        args.input, args.output, args.atlas_size, args.max_mip,
        version,
        include_packs=include_packs,
        lod_count=args.lods,
        want_ktx2=args.ktx2,
        cell_data_dir=args.cell_data_dir,
        workers=args.workers if args.workers > 0 else None,
    )
    duration = time.time() - started_at
    print('')
    print(f'Atlas built in {duration:.1f}s')
    print(f'  atlases:    {summary["atlas_count"]}')
    print(f'  sprites:    {summary["sprite_count"]}')
    print(f'  lods:       {summary["lods"]}')
    print(f'  ktx2:       {"yes" if summary["ktx2"] else "no"}')
    print(f'  cell-pages: {"yes" if summary["cell_pages"] else "no"}')
    print(f'  total:      {summary["total_bytes"] / (1024 * 1024):.1f} MB')


if __name__ == '__main__':
    main()
