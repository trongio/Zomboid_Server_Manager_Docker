"""Bootstrap pzdataspec parser into /map-tiles/lib via pzmap2dzi LibLoader."""
import os
import sys

sys.path.insert(0, '/opt/pzmap2dzi')

from pzmap2dzi.render_impl.save import LibLoader

lib_path = os.environ.get('PZDATASPEC_LIB_PATH', '/map-tiles/lib')
tag = os.environ.get('PZDATASPEC_TAG', 'latest')

os.makedirs(lib_path, exist_ok=True)

loader = LibLoader(lib_path)
result = loader.install(tag)
if result is None:
    print(f'[install_pzdataspec] FAIL: tag={tag} lib_path={lib_path}', file=sys.stderr)
    sys.exit(1)

utils = loader.load('pzdataspec.utils')
if utils is None:
    print('[install_pzdataspec] FAIL: utils module did not load', file=sys.stderr)
    sys.exit(1)

print(f'[install_pzdataspec] OK: tag={tag} lib_path={lib_path}')
print(f'[install_pzdataspec] utils module: {utils.__file__}')
