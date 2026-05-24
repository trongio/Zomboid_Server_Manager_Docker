"""Smoke test for pzdataspec parsing of a real save chunk."""
import os
import sys
import struct

sys.path.insert(0, '/opt/pzmap2dzi')
sys.path.insert(0, '/map-tiles/lib')

from pzdataspec import utils

chunk_path = '/pz-data/Saves/Multiplayer/IsnarmServ/map/1000/1448.bin'
world_dict_path = '/pz-data/Saves/Multiplayer/IsnarmServ/WorldDictionary.bin'
pz_root = '/pz-server'

with open(chunk_path, 'rb') as f:
    header = f.read(5)
version = struct.unpack('>I', header[1:5])[0]
save_version = 41 if version <= 195 else 42
print(f'chunk={chunk_path}')
print(f'version={version} save_version=B{save_version}')

block = utils.load_chunk(chunk_path, save_version)
print(f'block: {type(block).__name__}')
print(f'min_layer={block.min_layer} max_layer={block.max_layer}')

tile_defs = utils.load_tile_defs(pz_root, None, save_version)
print(f'tile_defs count: {len(tile_defs)}')

if os.path.exists(world_dict_path):
    wd_sprites = utils.load_world_dict_sprites(world_dict_path, save_version)
    tile_defs.update(wd_sprites)
    print(f'after WorldDictionary: {len(tile_defs)}')
else:
    print('WorldDictionary.bin NOT FOUND')

block_size = 8 if save_version == 42 else 10
total_sprites = 0
unique_sprites = set()
unresolved = 0
for layer in range(block.min_layer, block.max_layer + 1):
    for x in range(block_size):
        for y in range(block_size):
            sprites = block.get_sprites(layer, x, y)
            if not sprites:
                continue
            for s in sprites:
                total_sprites += 1
                name = tile_defs.get(s)
                if name is None:
                    unresolved += 1
                else:
                    unique_sprites.add(name)

print(f'total sprite refs: {total_sprites}')
print(f'unique sprite names: {len(unique_sprites)}')
print(f'unresolved sprite ids: {unresolved}')
print(f'sample names: {sorted(unique_sprites)[:5]}')
