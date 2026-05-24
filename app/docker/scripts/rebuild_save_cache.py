#!/usr/bin/env python3
"""
Парсит все PZ save .bin chunks в save-каталоге, агрегирует по cell-координатам
и пишет packed Uint32Array файлы для WebGL рендера на клиенте.

Output per cell:
    cell-{cellX}_{cellY}.packed  — массив u32 entries:
        bits 0-15:  sprite_id (global, из sprites.json порядка ключей)
        bits 16-23: sx (cell-local, 0..255)
        bits 24-31: sy (cell-local, 0..255)
    cell-{cellX}_{cellY}.strides — Uint32Array(7) strideOffsets (compat с base map renderer)

Manifest:
    manifest.json — версия + cells + mtimes

Coordinate math (B42):
    cell = 32 × 32 chunks = 256 × 256 squares
    chunkX → cellX = chunkX // 32
    inside chunk: local x, y in [0..7] (block_size=8)
    cell-local sx = (chunkX % 32) * 8 + x
"""

from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import os
import re
import struct
import sys
import time
from pathlib import Path

sys.path.insert(0, '/opt/pzmap2dzi')

NEW_BLOCK_NAME = re.compile(r'^(\d+)\.bin$')
OLD_BLOCK_NAME = re.compile(r'^map_(\d+)_(\d+)\.bin$')

BLOCK_SIZE_B41 = 10
BLOCK_SIZE_B42 = 8
CELL_SIZE_IN_BLOCKS_B41 = 30
CELL_SIZE_IN_BLOCKS_B42 = 32
KEEP_LAYER_MIN = 0
# 0=ground, 1=walls/окна/двери, 2=furniture, 3=низ объектов второго этажа.
# Поднимаем до 4 чтобы парсить window boards / баррикады (они на layer 1+),
# но не залезаем на крыши и стены верхних этажей.
KEEP_LAYER_MAX = 4
CELL_SIZE_IN_SQUARES = 256  # одинаково для B41/B42

# Sprite prefixes которые отбрасываются из save.
#
# Save в PZ хранит полный snapshot тайла при активации chunk'а: ground
# variants, natural plants, erosion sprites. Они полно-тайл (cover whole
# diamond) и перекрывают base blend overlays если рисуются поверх.
#
# Base map их рисует сам (или близкие variants). Чтобы не ломать blend
# transitions трава↔асфальт↔песок, drop эти категории из save:
#
#   blends_*           — ground blend variants (base owns blends)
#   floors_natural_*   — natural floor variants (base owns)
#   e_*                — erosion grass/plants/trees растущие со временем
#   f_bushes_*         — natural bushes (PZ-managed natural state)
#   f_grass_*          — grass tufts (similar)
#   vegetation_trees_* — static trees от base map
#   jumbo_tree_*       — jumbo trees from base
#
# Keep: d_*, walls_*, furniture_*, fixtures_*, appliances_*, windowboard_*,
#       carpentry_*, lighting_*, boulders_*, crafting_*, etc. — реальные
#       модификации игрока + статичные объекты что в base но не natural.
# Defaults — все известно-проблемные ground/natural prefixes. F_* можно
# отдельно регулировать через --extra-noise-prefixes (UI checkbox'ы).
SAVE_NOISE_PREFIXES = (
    'e_',
    'blends_',
    'floors_natural_',
    'vegetation_trees_',
    'jumbo_tree_',
)


def scan_chunks(save_dir: str) -> tuple[list[tuple[int, int, str]], int]:
    """Возвращает [(chunkX, chunkY, path), ...] и save_version (41 или 42)."""
    chunks: list[tuple[int, int, str]] = []
    map_dir = os.path.join(save_dir, 'map')
    save_version = 42

    if os.path.isdir(map_dir):
        for x_entry in os.listdir(map_dir):
            x_path = os.path.join(map_dir, x_entry)
            if not os.path.isdir(x_path) or not x_entry.isdigit():
                continue
            cx = int(x_entry)
            for y_entry in os.listdir(x_path):
                m = NEW_BLOCK_NAME.match(y_entry)
                if not m:
                    continue
                cy = int(m.group(1))
                chunks.append((cx, cy, os.path.join(x_path, y_entry)))
    else:
        save_version = 41
        for entry in os.listdir(save_dir):
            m = OLD_BLOCK_NAME.match(entry)
            if not m:
                continue
            chunks.append((int(m.group(1)), int(m.group(2)),
                           os.path.join(save_dir, entry)))

    return chunks, save_version


def detect_save_version(first_chunk_path: str) -> int:
    with open(first_chunk_path, 'rb') as f:
        data = f.read(5)
    if len(data) < 5:
        return 42
    world_version = struct.unpack('>I', data[1:5])[0]
    return 41 if world_version <= 195 else 42


def load_sprite_name_to_id(sprites_json_path: str) -> dict[str, int]:
    with open(sprites_json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    mapping: dict[str, int] = {}
    for idx, name in enumerate(data.get('sprites', {}).keys()):
        mapping[name] = idx
    return mapping


_worker_state: dict = {}


def _worker_init(pz_root: str, mod_root: str | None, save_version: int,
                 world_dict_path: str | None, lib_path: str,
                 sprite_name_to_id: dict[str, int]) -> None:
    """Инициализация форкнутого воркера (lazy-load pzdataspec)."""
    sys.path.insert(0, lib_path)
    sys.path.insert(0, '/opt/pzmap2dzi')
    from pzmap2dzi.plants import jumbo_tree_defs
    from pzdataspec import utils
    _worker_state['utils'] = utils
    _worker_state['save_version'] = save_version
    _worker_state['block_size'] = BLOCK_SIZE_B41 if save_version == 41 else BLOCK_SIZE_B42

    tile_defs = utils.load_tile_defs(pz_root, mod_root, save_version)
    jumbo_file_number = 5 if save_version == 41 else 6
    tile_defs.update(jumbo_tree_defs(jumbo_file_number))
    if world_dict_path and os.path.exists(world_dict_path):
        wd_sprites = utils.load_world_dict_sprites(world_dict_path, save_version)
        tile_defs.update(wd_sprites)
    _worker_state['tile_defs'] = tile_defs
    _worker_state['sprite_name_to_id'] = sprite_name_to_id


def _parse_chunk(
    args: tuple[int, int, str],
) -> tuple[int, int, dict[int, list[tuple[int, int, str]]]]:
    """Парсит один chunk.

    Возвращает per_layer_entries: { layer: [(sx, sy, sprite_name)] }.
    Main process потом фильтрует save entries, которые дублируют base, и
    резолвит name → global atlas ID. Без этого фильтра save sprites
    перекрывают base blend overlays (PZ сохраняет полный snapshot тайла
    при активации chunk, поэтому save содержит много дубликатов base).
    """
    chunk_x, chunk_y, path = args
    utils = _worker_state['utils']
    block_size = _worker_state['block_size']
    tile_defs = _worker_state['tile_defs']
    save_version = _worker_state['save_version']

    block = utils.load_chunk(path, save_version)
    if block is None:
        return chunk_x, chunk_y, {}

    cell_size_in_blocks = CELL_SIZE_IN_BLOCKS_B41 if save_version == 41 else CELL_SIZE_IN_BLOCKS_B42
    chunk_in_cell_x = chunk_x % cell_size_in_blocks
    chunk_in_cell_y = chunk_y % cell_size_in_blocks
    base_sx = chunk_in_cell_x * block_size
    base_sy = chunk_in_cell_y * block_size

    per_layer: dict[int, list[tuple[int, int, str]]] = {}
    min_layer = max(block.min_layer, KEEP_LAYER_MIN)
    max_layer = min(block.max_layer, KEEP_LAYER_MAX - 1)
    for layer in range(min_layer, max_layer + 1):
        for x in range(block_size):
            sx = (base_sx + x) & 0xff
            for y in range(block_size):
                sy = (base_sy + y) & 0xff
                sprites = block.get_sprites(layer, x, y)
                if not sprites:
                    continue
                for sprite_id in sprites:
                    name = tile_defs.get(sprite_id)
                    if name is None:
                        continue
                    # Drop базовых ground prefixes. F_* категории
                    # обрабатываются в main process (CLI extra-noise-prefixes
                    # из UI checkboxes).
                    if name.startswith(SAVE_NOISE_PREFIXES):
                        continue
                    per_layer.setdefault(layer, []).append((sx, sy, name))

    return chunk_x, chunk_y, per_layer


def write_cell_packed(output_dir: str, cell_x: int, cell_y: int,
                      per_layer_entries: dict[int, list[tuple[int, int, int]]]) -> tuple[int, dict[int, int]]:
    """Пишет per-layer packed файлы. Save содержит только модифицированные
    sprites — base рисуется браузером самостоятельно.

    Layer N → cell-{cx}_{cy}.l{N}.packed + .l{N}.strides
    """
    layer_counts: dict[int, int] = {}
    total_bytes = 0

    for layer, entries in per_layer_entries.items():
        if not entries:
            continue
        layer_counts[layer] = len(entries)

        buf = bytearray(4 * len(entries))
        for i, (sx, sy, sprite_id) in enumerate(entries):
            packed = (sprite_id & 0xffff) | ((sx & 0xff) << 16) | ((sy & 0xff) << 24)
            struct.pack_into('<I', buf, i * 4, packed)
        out_path = os.path.join(output_dir, f'cell-{cell_x}_{cell_y}.l{layer}.packed')
        with open(out_path, 'wb') as f:
            f.write(buf)
        total_bytes += len(buf)

        total = len(entries)
        strides = struct.pack('<7I', total, total, total, total, total, total, total)
        with open(os.path.join(output_dir, f'cell-{cell_x}_{cell_y}.l{layer}.strides'), 'wb') as f:
            f.write(strides)
        total_bytes += 28

    return total_bytes, layer_counts


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--save-dir', required=True,
                        help='/pz-data/Saves/Multiplayer/{server}')
    parser.add_argument('--pz-root', required=True, help='/pz-server')
    parser.add_argument('--mod-root', default=None, help='Workshop mods root')
    parser.add_argument('--output-dir', required=True,
                        help='/map-tiles/save-cache')
    parser.add_argument('--sprites-json', required=True,
                        help='/map-tiles/web/sprites.json')
    parser.add_argument('--lib-path', default='/map-tiles/lib',
                        help='Где живёт pzdataspec')
    parser.add_argument('--workers', type=int,
                        default=max(1, (os.cpu_count() or 4) - 1))
    parser.add_argument('--server-name', default='Server')
    parser.add_argument('--verbose', action='store_true')
    parser.add_argument('--since-mtime', type=int, default=0,
                        help='Incremental mode: re-parse только cells содержащие '
                             'chunks с mtime > since-mtime. 0 = full rebuild.')
    parser.add_argument('--base-map-path', default=None,
                        help='Каталог с base lotpack для filter (например '
                             '/pz-server/media/maps/Muldraugh, KY). Используется '
                             'чтобы отбросить save sprites дублирующие base.')
    parser.add_argument('--extra-noise-prefixes', default='',
                        help='Дополнительные sprite name prefixes к фильтру '
                             '(comma-separated). Пример: "f_bushes_,f_grass_". '
                             'Добавляется к встроенному SAVE_NOISE_PREFIXES.')
    args = parser.parse_args()

    if not os.path.isdir(args.save_dir):
        print(f'[rebuild] save-dir missing: {args.save_dir}', file=sys.stderr)
        return 2

    t_start = time.time()
    chunks, _ = scan_chunks(args.save_dir)
    if not chunks:
        print('[rebuild] no save chunks found, nothing to do')
        os.makedirs(args.output_dir, exist_ok=True)
        manifest = {
            'version': 'empty',
            'world': args.server_name,
            'cells': [],
            'generated_at': int(time.time()),
        }
        with open(os.path.join(args.output_dir, 'manifest.json'), 'w', encoding='utf-8') as f:
            json.dump(manifest, f)
        return 0

    save_version = detect_save_version(chunks[0][2])
    block_size = BLOCK_SIZE_B41 if save_version == 41 else BLOCK_SIZE_B42
    cell_size_in_blocks = CELL_SIZE_IN_BLOCKS_B41 if save_version == 41 else CELL_SIZE_IN_BLOCKS_B42
    print(f'[rebuild] chunks={len(chunks)} save_version=B{save_version} '
          f'block_size={block_size} cells_per_axis_per_cell={cell_size_in_blocks}')

    sprite_name_to_id = load_sprite_name_to_id(args.sprites_json)
    print(f'[rebuild] sprite atlas vocabulary: {len(sprite_name_to_id)} names')

    world_dict_path = os.path.join(args.save_dir, 'WorldDictionary.bin')

    os.makedirs(args.output_dir, exist_ok=True)

    # Incremental mode: определить какие cells затронуты chunks с mtime > since.
    # Внутри затронутых cells re-parse'им ВСЕ chunks (нельзя partial — entries
    # хранятся за cell как сплошной список, у нас нет per-chunk granularity
    # на диске).
    cells_to_rebuild: set[tuple[int, int]] | None = None
    if args.since_mtime > 0:
        cells_to_rebuild = set()
        for cx, cy, path in chunks:
            try:
                if os.path.getmtime(path) > args.since_mtime:
                    cells_to_rebuild.add(
                        (cx // cell_size_in_blocks, cy // cell_size_in_blocks))
            except OSError:
                continue
        if not cells_to_rebuild:
            print('[rebuild] incremental: 0 cells to update, skipping work')
            return 0
        print(f'[rebuild] incremental: {len(cells_to_rebuild)} cells need rebuild')
        # Фильтруем chunks к подмножеству этих cells.
        chunks = [
            c for c in chunks
            if (c[0] // cell_size_in_blocks, c[1] // cell_size_in_blocks) in cells_to_rebuild
        ]
        print(f'[rebuild] incremental: chunks reduced to {len(chunks)}')

    # Multiprocess parsing
    init_args = (args.pz_root, args.mod_root, save_version, world_dict_path,
                 args.lib_path, sprite_name_to_id)
    # cell_entries[(cellX, cellY)][layer] = [(sx, sy, sprite_name), ...]
    # Имена резолвятся в global IDs ПОСЛЕ фильтрации против base lotpack
    # (см. ниже filter phase).
    cell_entries: dict[tuple[int, int], dict[int, list[tuple[int, int, str]]]] = {}
    cell_mtimes: dict[tuple[int, int], int] = {}

    def merge_layer_entries(target: dict[int, list], incoming: dict[int, list]) -> None:
        for layer, entries in incoming.items():
            target.setdefault(layer, []).extend(entries)

    parse_start = time.time()
    if args.workers <= 1:
        _worker_init(*init_args)
        for chunk_args in chunks:
            cx, cy, per_layer = _parse_chunk(chunk_args)
            cell_key = (cx // cell_size_in_blocks, cy // cell_size_in_blocks)
            if per_layer:
                merge_layer_entries(cell_entries.setdefault(cell_key, {}), per_layer)
            mtime = int(os.path.getmtime(chunk_args[2]))
            if mtime > cell_mtimes.get(cell_key, 0):
                cell_mtimes[cell_key] = mtime
    else:
        with mp.Pool(args.workers, initializer=_worker_init,
                     initargs=init_args) as pool:
            for cx, cy, per_layer in pool.imap_unordered(
                _parse_chunk, chunks, chunksize=64,
            ):
                cell_key = (cx // cell_size_in_blocks, cy // cell_size_in_blocks)
                if per_layer:
                    merge_layer_entries(cell_entries.setdefault(cell_key, {}), per_layer)
            for cx, cy, path in chunks:
                cell_key = (cx // cell_size_in_blocks, cy // cell_size_in_blocks)
                try:
                    mtime = int(os.path.getmtime(path))
                except OSError:
                    continue
                if mtime > cell_mtimes.get(cell_key, 0):
                    cell_mtimes[cell_key] = mtime

    parse_secs = time.time() - parse_start
    print(f'[rebuild] parse done in {parse_secs:.2f}s — {len(cell_entries)} non-empty cells')

    # === Discover ВСЕ sprite prefixes encountered в save ===
    # Используется в UI: показываем checkbox per discovered prefix чтобы
    # пользователь решил какие конкретные категории фильтровать.
    # Категория = первые два name сегмента (e.g. "f_bushes_01_22" → "f_bushes_",
    # "d_generic_1_49" → "d_generic_", "walls_exterior_wooden_01_5" →
    # "walls_exterior_").
    prefix_counts: dict[str, int] = {}
    for per_layer in cell_entries.values():
        for entries in per_layer.values():
            for _, _, name in entries:
                parts = name.split('_', 2)
                if len(parts) >= 2:
                    prefix = parts[0] + '_' + parts[1] + '_'
                    prefix_counts[prefix] = prefix_counts.get(prefix, 0) + 1
    discovered_f = sorted(prefix_counts.items(), key=lambda kv: -kv[1])
    print(f'[rebuild] discovered sprite prefixes in save: {len(discovered_f)}')

    # === Build effective noise prefixes (defaults + CLI extra) ===
    extra_prefixes = tuple(
        p.strip() for p in args.extra_noise_prefixes.split(',')
        if p.strip()
    )
    effective_noise = SAVE_NOISE_PREFIXES + extra_prefixes
    if extra_prefixes:
        print(f'[rebuild] extra noise prefixes (from CLI): {extra_prefixes}')

    # === Filter duplicates against base lotpack ===
    # PZ сохраняет полный snapshot тайла при активации chunk'а (даже если
    # ничего не изменилось). Save sprites которые совпадают с base sprites
    # на той же позиции — это дубликаты, они overdraw'ят base blend overlays
    # и убивают плавные переходы трава↔асфальт. Удаляем их.
    #
    # Save sprite остаётся ТОЛЬКО если его имя НЕ в base sprite list для
    # (sx, sy, layer). Это и есть actual modification (open door, broken
    # furniture, window boards и т.д.).
    cell_filtered_entries: dict[tuple[int, int], dict[int, list[tuple[int, int, int]]]] = {}
    if args.base_map_path and os.path.isdir(args.base_map_path):
        from pzmap2dzi.cell import load_cell as _load_base_cell

        filter_start = time.time()
        total_in = 0
        total_kept = 0
        for cell_key, per_layer in cell_entries.items():
            cell_x, cell_y = cell_key
            base_cell = _load_base_cell(args.base_map_path, cell_x, cell_y)
            filtered: dict[int, list[tuple[int, int, int]]] = {}
            for layer, entries in per_layer.items():
                total_in += len(entries)
                # Кэш base sprite names per (sx, sy, layer) для этой cell.
                base_names_cache: dict[tuple[int, int], set[str]] = {}
                kept_entries: list[tuple[int, int, int]] = []
                for sx, sy, name in entries:
                    # Extra noise filter из CLI (UI checkbox'ы для f_*).
                    if extra_prefixes and name.startswith(extra_prefixes):
                        continue
                    if base_cell is not None:
                        cache_key = (sx, sy)
                        names_set = base_names_cache.get(cache_key)
                        if names_set is None:
                            base_sprites = base_cell.get_square(sx, sy, layer)
                            names_set = set(base_sprites) if base_sprites else set()
                            base_names_cache[cache_key] = names_set
                        if name in names_set:
                            continue  # дубликат base — skip
                    global_id = sprite_name_to_id.get(name)
                    if global_id is None or global_id > 0xffff:
                        continue
                    kept_entries.append((sx, sy, global_id))
                if kept_entries:
                    filtered[layer] = kept_entries
                    total_kept += len(kept_entries)
            if filtered:
                cell_filtered_entries[cell_key] = filtered
        filter_secs = time.time() - filter_start
        print(f'[rebuild] filter vs base: {total_in} → {total_kept} entries kept '
              f'({100 * (total_in - total_kept) / max(1, total_in):.1f}% дубликатов отброшено) '
              f'в {filter_secs:.2f}s')
    else:
        # Без base_map_path: просто резолвим имена в IDs без фильтрации.
        for cell_key, per_layer in cell_entries.items():
            resolved: dict[int, list[tuple[int, int, int]]] = {}
            for layer, entries in per_layer.items():
                kept_entries: list[tuple[int, int, int]] = []
                for sx, sy, name in entries:
                    if extra_prefixes and name.startswith(extra_prefixes):
                        continue
                    global_id = sprite_name_to_id.get(name)
                    if global_id is None or global_id > 0xffff:
                        continue
                    kept_entries.append((sx, sy, global_id))
                if kept_entries:
                    resolved[layer] = kept_entries
            if resolved:
                cell_filtered_entries[cell_key] = resolved

    # Write per-cell per-layer packed файлы
    write_start = time.time()
    total_bytes = 0
    total_entries = 0
    cell_layer_counts: dict[tuple[int, int], dict[int, int]] = {}
    for cell_key, per_layer in cell_filtered_entries.items():
        bytes_written, layer_counts = write_cell_packed(
            args.output_dir, cell_key[0], cell_key[1], per_layer,
        )
        total_bytes += bytes_written
        for cnt in layer_counts.values():
            total_entries += cnt
        cell_layer_counts[cell_key] = layer_counts
    write_secs = time.time() - write_start
    print(f'[rebuild] wrote {len(cell_filtered_entries)} cells / {total_entries} entries / '
          f'{total_bytes/1024/1024:.2f} MB in {write_secs:.2f}s')

    # Clean stale files. Per-layer pattern: cell-X_Y.l{N}.packed/strides + legacy .mask
    stale_re = re.compile(r'^cell-(\d+)_(\d+)\.(?:l\d+\.(?:packed|strides)|mask)$')
    existing_files = {f for f in os.listdir(args.output_dir) if stale_re.match(f)}

    def expected_for_cell(cx: int, cy: int, layer_counts: dict[int, int]) -> set[str]:
        files: set[str] = set()
        for layer in layer_counts.keys():
            files.add(f'cell-{cx}_{cy}.l{layer}.packed')
            files.add(f'cell-{cx}_{cy}.l{layer}.strides')
        return files

    expected_files: set[str] = set()
    for (cx, cy), layer_counts in cell_layer_counts.items():
        expected_files |= expected_for_cell(cx, cy, layer_counts)

    if cells_to_rebuild is None:
        for stale in existing_files - expected_files:
            try:
                os.remove(os.path.join(args.output_dir, stale))
            except OSError:
                pass
    else:
        for (cx, cy) in cells_to_rebuild:
            for stale in existing_files:
                m = stale_re.match(stale)
                if not m:
                    continue
                if int(m.group(1)) == cx and int(m.group(2)) == cy and stale not in expected_files:
                    try:
                        os.remove(os.path.join(args.output_dir, stale))
                    except OSError:
                        pass

    # Manifest — в incremental mode объединяем с предыдущим
    if cells_to_rebuild is not None:
        prev_manifest_path = os.path.join(args.output_dir, 'manifest.json')
        if os.path.isfile(prev_manifest_path):
            try:
                with open(prev_manifest_path, 'r', encoding='utf-8') as f:
                    prev = json.load(f)
                for cell in prev.get('cells', []):
                    pcx, pcy, pmtime = cell[0], cell[1], cell[2]
                    pcounts = cell[3] if len(cell) > 3 else {}
                    if (pcx, pcy) in cells_to_rebuild:
                        continue
                    if (pcx, pcy) not in cell_mtimes:
                        cell_mtimes[(pcx, pcy)] = pmtime
                        cell_entries.setdefault((pcx, pcy), {})
                        if isinstance(pcounts, dict):
                            cell_layer_counts.setdefault(
                                (pcx, pcy), {int(k): v for k, v in pcounts.items()},
                            )
            except (json.JSONDecodeError, OSError):
                pass

    all_cells = set(cell_mtimes.keys())
    # Cell entry в manifest: [cellX, cellY, mtime, {layer: count}]
    cells_list = sorted([
        [cx, cy, cell_mtimes[(cx, cy)], cell_layer_counts.get((cx, cy), {})]
        for (cx, cy) in all_cells
    ])
    max_mtime = max((row[2] for row in cells_list), default=0)
    # Filter prefixes тоже включаем в version: если пользователь сменил
    # фильтр без изменения save файлов, version всё равно поменяется и
    # watcher на клиенте подхватит обновление.
    filter_sig = ','.join(sorted(extra_prefixes))
    version_str = f'{args.server_name}|{max_mtime}|{len(cells_list)}|{filter_sig}'
    import hashlib
    version_hash = hashlib.sha1(version_str.encode()).hexdigest()

    manifest = {
        'version': version_hash,
        'world': args.server_name,
        'save_version': save_version,
        'cells': cells_list,
        'generated_at': int(time.time()),
        # Все discovered prefixes (отсортировано по count desc) — фронт
        # показывает checkbox'ы чтобы пользователь выбрал какие фильтровать.
        # Имя поля sохраняется для backward compat (раньше было только f_).
        'discovered_f_prefixes': [
            {'prefix': p, 'count': c} for p, c in discovered_f
        ],
        'active_extra_noise_prefixes': list(extra_prefixes),
    }
    with open(os.path.join(args.output_dir, 'manifest.json'), 'w', encoding='utf-8') as f:
        json.dump(manifest, f)

    total_secs = time.time() - t_start
    print(f'[rebuild] DONE in {total_secs:.2f}s: '
          f'{len(chunks)} chunks → {len(cells_list)} cells, '
          f'avg {parse_secs * 1000 / max(1, len(chunks)):.2f}ms/chunk '
          f'({args.workers} workers)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
