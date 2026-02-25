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
    ],

    /*
    |--------------------------------------------------------------------------
    | Server Identity
    |--------------------------------------------------------------------------
    */
    'server_name' => env('PZ_SERVER_NAME', 'ZomboidServer'),

    /*
    |--------------------------------------------------------------------------
    | API Authentication
    |--------------------------------------------------------------------------
    */
    'api_key' => env('API_KEY', ''),
];
