<?php

return [
    /*
    |--------------------------------------------------------------------------
    | RCON Configuration
    |--------------------------------------------------------------------------
    */
    'rcon' => [
        'host' => env('PZ_RCON_HOST', 'game-server'),
        'port' => (int) env('PZ_RCON_PORT', 27015),
        'password' => env('PZ_RCON_PASSWORD', ''),
        'timeout' => (int) env('PZ_RCON_TIMEOUT', 5),
    ],

    /*
    |--------------------------------------------------------------------------
    | Docker Engine API
    |--------------------------------------------------------------------------
    */
    'docker' => [
        'socket' => env('DOCKER_SOCKET', '/var/run/docker.sock'),
        'container_name' => env('GAME_SERVER_CONTAINER_NAME', 'pz-game-server'),
    ],

    /*
    |--------------------------------------------------------------------------
    | PZ Server Paths (inside app container)
    |--------------------------------------------------------------------------
    */
    'paths' => [
        'data' => env('PZ_DATA_PATH', '/pz-data'),
        'server_ini' => env('PZ_DATA_PATH', '/pz-data').'/Server/'.env('PZ_SERVER_NAME', 'ZomboidServer').'.ini',
        'sandbox_lua' => env('PZ_DATA_PATH', '/pz-data').'/Server/'.env('PZ_SERVER_NAME', 'ZomboidServer').'_SandboxVars.lua',
        'db' => env('PZ_DATA_PATH', '/pz-data').'/db/serverPZ.db',
        'players_db' => env('PZ_DATA_PATH', '/pz-data').'/Saves/Multiplayer/'.env('PZ_SERVER_NAME', 'ZomboidServer').'/players.db',
    ],

    /*
    |--------------------------------------------------------------------------
    | Map Tile Configuration
    |--------------------------------------------------------------------------
    */
    'game_server_path' => env('PZ_SERVER_PATH', '/pz-server'),

    'map' => [
        'tiles_path' => env('PZ_MAP_TILES_PATH', '/map-tiles'),
        'tile_size' => 256,
        'min_zoom' => 13,
        'max_zoom' => 17,
        'default_zoom' => 13,
        'center_x' => 10500.0,
        'center_y' => 9800.0,
        'proxy_url' => env('PZ_MAP_PROXY_URL', 'https://map.projectzomboid.com/maps/SurvivalB417812L0/map_files/{z}/{x}_{y}.jpg'),
        'proxy_tile_size' => 1024,
        'proxy_dzi' => [
            'width' => 2285184,
            'height' => 990400,
            'x0' => 1017856,
            'y0' => -152032,
            'sqr' => 128,
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Server Identity
    |--------------------------------------------------------------------------
    */
    'server_name' => env('PZ_SERVER_NAME', 'ZomboidServer'),

    /*
    |--------------------------------------------------------------------------
    | Backup Configuration
    |--------------------------------------------------------------------------
    */
    'backups' => [
        'path' => env('BACKUP_PATH', '/backups'),
        'retention' => [
            'manual' => (int) env('BACKUP_RETENTION_MANUAL', 10),
            'scheduled' => (int) env('BACKUP_RETENTION_SCHEDULED', 24),
            'daily' => (int) env('BACKUP_RETENTION_DAILY', 7),
            'pre_rollback' => (int) env('BACKUP_RETENTION_PRE_ROLLBACK', 5),
            'pre_update' => (int) env('BACKUP_RETENTION_PRE_UPDATE', 3),
        ],
    ],

    /*
    |--------------------------------------------------------------------------
    | Lua Bridge — File-based communication with PZ Lua mod
    |--------------------------------------------------------------------------
    */
    'lua_bridge' => [
        'path' => env('LUA_BRIDGE_PATH', '/lua-bridge'),
        'inventory_dir' => env('LUA_BRIDGE_PATH', '/lua-bridge').'/inventory',
        'delivery_queue' => env('LUA_BRIDGE_PATH', '/lua-bridge').'/delivery_queue.json',
        'delivery_results' => env('LUA_BRIDGE_PATH', '/lua-bridge').'/delivery_results.json',
        'players_live' => env('LUA_BRIDGE_PATH', '/lua-bridge').'/players_live.json',
        'items_catalog' => env('LUA_BRIDGE_PATH', '/lua-bridge').'/items_catalog.json',
        'game_state' => env('LUA_BRIDGE_PATH', '/lua-bridge').'/game_state.json',
    ],

    /*
    |--------------------------------------------------------------------------
    | API Authentication
    |--------------------------------------------------------------------------
    */
    'api_key' => env('API_KEY', ''),
];
