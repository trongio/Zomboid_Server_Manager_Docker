"""Анализирует какие именно sprite-names остаются в save после filter vs base.

Цель: понять что переопределяет blend transitions на ground.
"""
import os
import sys
from collections import Counter
sys.path.insert(0, '/opt/pzmap2dzi')
sys.path.insert(0, '/map-tiles/lib')

from pzdataspec import utils
from pzmap2dzi.cell import load_cell

SAVE_DIR = '/pz-data/Saves/Multiplayer/IsnarmServ'
BASE_DIR = '/pz-server/media/maps/Muldraugh, KY'
SAVE_VERSION = 42
BLOCK_SIZE = 8
CELLS_PER_AXIS = 32

# Load tile_defs
tile_defs = utils.load_tile_defs('/pz-server', None, SAVE_VERSION)
wd_path = os.path.join(SAVE_DIR, 'WorldDictionary.bin')
if os.path.exists(wd_path):
    tile_defs.update(utils.load_world_dict_sprites(wd_path, SAVE_VERSION))

# Sample a few cells from save manifest
CELLS = [(45, 29), (45, 30), (45, 32), (41, 27), (50, 20)]

kept_prefix_counts: Counter = Counter()
kept_full_names: Counter = Counter()
total_save_l0 = 0
total_kept = 0
total_dropped_dup = 0

for cell_x, cell_y in CELLS:
    base_cell = load_cell(BASE_DIR, cell_x, cell_y)
    if base_cell is None:
        continue

    # Iterate chunks for this cell
    g_x0 = cell_x * CELLS_PER_AXIS
    g_y0 = cell_y * CELLS_PER_AXIS
    for chunk_x in range(g_x0, g_x0 + CELLS_PER_AXIS):
        chunk_dir = os.path.join(SAVE_DIR, 'map', str(chunk_x))
        if not os.path.isdir(chunk_dir):
            continue
        for fn in os.listdir(chunk_dir):
            if not fn.endswith('.bin'):
                continue
            chunk_y = int(fn[:-4])
            if not (g_y0 <= chunk_y < g_y0 + CELLS_PER_AXIS):
                continue
            block = utils.load_chunk(os.path.join(chunk_dir, fn), SAVE_VERSION)
            if block is None:
                continue
            chunk_in_cell_x = chunk_x % CELLS_PER_AXIS
            chunk_in_cell_y = chunk_y % CELLS_PER_AXIS

            for x in range(BLOCK_SIZE):
                for y in range(BLOCK_SIZE):
                    save_sprites = block.get_sprites(0, x, y)  # layer 0 only
                    if not save_sprites:
                        continue
                    sx = chunk_in_cell_x * BLOCK_SIZE + x
                    sy = chunk_in_cell_y * BLOCK_SIZE + y
                    base_sprites = base_cell.get_square(sx, sy, 0)
                    base_names_set = set(base_sprites) if base_sprites else set()

                    for sprite_id in save_sprites:
                        total_save_l0 += 1
                        name = tile_defs.get(sprite_id)
                        if name is None:
                            continue
                        if name in base_names_set:
                            total_dropped_dup += 1
                            continue
                        total_kept += 1
                        prefix = name.split('_')[0] + ('_' + name.split('_')[1] if '_' in name and len(name.split('_')) > 1 else '')
                        kept_prefix_counts[prefix] += 1
                        kept_full_names[name] += 1

print(f'Total save l0 sprites in sample cells: {total_save_l0}')
print(f'Dropped as base duplicates: {total_dropped_dup}')
print(f'KEPT after filter: {total_kept}')
print(f'\n--- Top prefixes of KEPT save sprites: ---')
for prefix, count in kept_prefix_counts.most_common(30):
    print(f'  {count:6d}  {prefix}')
print(f'\n--- Top 30 KEPT sprite names: ---')
for name, count in kept_full_names.most_common(30):
    print(f'  {count:6d}  {name}')
