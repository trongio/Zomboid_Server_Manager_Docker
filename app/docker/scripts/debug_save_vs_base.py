"""Compare save chunk vs base lotpack for the same square — what does save store?"""
import os
import sys
sys.path.insert(0, '/opt/pzmap2dzi')
sys.path.insert(0, '/map-tiles/lib')

from pzdataspec import utils
from pzmap2dzi.cell import load_cell

# Pick a cell from save manifest
SAVE_DIR = '/pz-data/Saves/Multiplayer/IsnarmServ'
BASE_DIR = '/pz-server/media/maps/Muldraugh, KY'
SAVE_VERSION = 42

# Cell 45,29 — most save data per output ranking
CELL_X, CELL_Y = 45, 29
BLOCK_SIZE = 8
CELLS_PER_AXIS = 32

base_cell = load_cell(BASE_DIR, CELL_X, CELL_Y)
if base_cell is None:
    print('ERR: base cell not loaded')
    sys.exit(1)

tile_defs = utils.load_tile_defs('/pz-server', None, SAVE_VERSION)
wd_path = os.path.join(SAVE_DIR, 'WorldDictionary.bin')
if os.path.exists(wd_path):
    wd = utils.load_world_dict_sprites(wd_path, SAVE_VERSION)
    tile_defs.update(wd)

# Find chunks in this cell
g_x0 = CELL_X * CELLS_PER_AXIS
g_y0 = CELL_Y * CELLS_PER_AXIS
sample_chunks = []
for cx in range(g_x0, g_x0 + CELLS_PER_AXIS):
    chunk_dir = os.path.join(SAVE_DIR, 'map', str(cx))
    if not os.path.isdir(chunk_dir):
        continue
    for fn in sorted(os.listdir(chunk_dir)):
        if not fn.endswith('.bin'):
            continue
        cy = int(fn[:-4])
        if g_y0 <= cy < g_y0 + CELLS_PER_AXIS:
            sample_chunks.append((cx, cy, os.path.join(chunk_dir, fn)))
            if len(sample_chunks) >= 3:
                break
    if len(sample_chunks) >= 3:
        break

print(f'cell ({CELL_X},{CELL_Y}) → first {len(sample_chunks)} chunks')

for chunk_x, chunk_y, path in sample_chunks:
    print(f'\n=== chunk ({chunk_x},{chunk_y}) ===')
    block = utils.load_chunk(path, SAVE_VERSION)
    if block is None:
        print('  load failed')
        continue

    chunk_in_cell_x = chunk_x % CELLS_PER_AXIS
    chunk_in_cell_y = chunk_y % CELLS_PER_AXIS

    # Sample 3 squares within chunk where save has data
    found = 0
    for x in range(BLOCK_SIZE):
        for y in range(BLOCK_SIZE):
            save_sprites = block.get_sprites(0, x, y)
            if not save_sprites:
                continue
            cell_local_sx = chunk_in_cell_x * BLOCK_SIZE + x
            cell_local_sy = chunk_in_cell_y * BLOCK_SIZE + y
            base_sprites = base_cell.get_square(cell_local_sx, cell_local_sy, 0)
            base_names = list(base_sprites) if base_sprites else []
            save_names = [tile_defs.get(s, f'<unknown_{s}>') for s in save_sprites]
            print(f'  ({cell_local_sx},{cell_local_sy}) layer 0:')
            print(f'    save: {save_names}')
            print(f'    base: {base_names}')
            found += 1
            if found >= 3:
                break
        if found >= 3:
            break
