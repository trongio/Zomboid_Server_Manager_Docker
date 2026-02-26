<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\UpdateSandboxConfigRequest;
use App\Http\Requests\Api\UpdateServerConfigRequest;
use App\Services\AuditLogger;
use App\Services\SandboxLuaParser;
use App\Services\ServerIniParser;
use Illuminate\Http\JsonResponse;

class ConfigController
{
    public function __construct(
        private readonly ServerIniParser $iniParser,
        private readonly SandboxLuaParser $luaParser,
        private readonly AuditLogger $auditLogger,
    ) {}

    public function showServer(): JsonResponse
    {
        $path = config('zomboid.paths.server_ini');

        $data = $this->iniParser->read($path);

        if ($data === []) {
            return response()->json([
                'error' => 'Server config not found — server may not have been started yet',
            ], 404);
        }

        return response()->json($data);
    }

    public function updateServer(UpdateServerConfigRequest $request): JsonResponse
    {
        $path = config('zomboid.paths.server_ini');
        $settings = $request->validated('settings');

        $before = $this->iniParser->read($path);

        if ($before === []) {
            return response()->json([
                'error' => 'Server config not found — server may not have been started yet',
            ], 404);
        }

        $this->iniParser->write($path, $settings);

        $after = $this->iniParser->read($path);

        $updatedFields = array_keys($settings);

        $this->auditLogger->log(
            actor: 'api-key',
            action: 'config.server.update',
            target: 'server.ini',
            details: [
                'updated_fields' => $updatedFields,
                'before' => array_intersect_key($before, $settings),
                'after' => array_intersect_key($after, $settings),
            ],
            ip: $request->ip(),
        );

        return response()->json([
            'updated_fields' => $updatedFields,
            'restart_required' => true,
        ]);
    }

    public function showSandbox(): JsonResponse
    {
        $path = config('zomboid.paths.sandbox_lua');

        $data = $this->luaParser->read($path);

        if ($data === []) {
            return response()->json([
                'error' => 'Sandbox config not found — server may not have been started yet',
            ], 404);
        }

        return response()->json($data);
    }

    public function updateSandbox(UpdateSandboxConfigRequest $request): JsonResponse
    {
        $path = config('zomboid.paths.sandbox_lua');
        $settings = $request->validated('settings');

        $before = $this->luaParser->read($path);

        if ($before === []) {
            return response()->json([
                'error' => 'Sandbox config not found — server may not have been started yet',
            ], 404);
        }

        $this->luaParser->write($path, $settings);

        $after = $this->luaParser->read($path);

        $updatedFields = array_keys($settings);

        $this->auditLogger->log(
            actor: 'api-key',
            action: 'config.sandbox.update',
            target: 'SandboxVars.lua',
            details: [
                'updated_fields' => $updatedFields,
                'before' => $this->extractUpdatedValues($before, $settings),
                'after' => $this->extractUpdatedValues($after, $settings),
            ],
            ip: $request->ip(),
        );

        return response()->json([
            'updated_fields' => $updatedFields,
            'restart_required' => true,
        ]);
    }

    /**
     * Extract values for updated keys, supporting dot notation.
     *
     * @param  array<string, mixed>  $data
     * @param  array<string, mixed>  $updates
     * @return array<string, mixed>
     */
    private function extractUpdatedValues(array $data, array $updates): array
    {
        $result = [];

        foreach ($updates as $key => $value) {
            $result[$key] = data_get($data, $key);
        }

        return $result;
    }
}
