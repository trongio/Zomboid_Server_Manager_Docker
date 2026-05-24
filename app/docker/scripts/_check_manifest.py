import json
m = json.load(open('/map-tiles/save-cache/manifest.json'))
print('discovered_f:', m.get('discovered_f_prefixes'))
print('active_extra:', m.get('active_extra_noise_prefixes'))
