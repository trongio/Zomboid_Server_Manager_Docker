<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\ImportConfigApplyRequest;
use App\Http\Requests\Admin\ImportConfigPreviewRequest;
use App\Rules\SafeConfigValue;
use App\Services\AuditLogger;
use App\Services\ConfigImporter;
use App\Services\ConfigStateManager;
use App\Services\RespawnDelayManager;
use App\Services\SandboxLuaParser;
use App\Services\ServerIniParser;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class ConfigController extends Controller
{
    public function __construct(
        private readonly ServerIniParser $iniParser,
        private readonly SandboxLuaParser $luaParser,
        private readonly AuditLogger $auditLogger,
        private readonly RespawnDelayManager $respawnDelay,
        private readonly ConfigStateManager $configState,
        private readonly ConfigImporter $configImporter,
    ) {}

    public function index(): Response
    {
        $serverConfig = [];
        $sandboxConfig = [];

        try {
            $serverConfig = $this->iniParser->read(config('zomboid.paths.server_ini'));
        } catch (\Throwable) {
            // File not available
        }

        try {
            $sandboxConfig = $this->luaParser->read(config('zomboid.paths.sandbox_lua'));
        } catch (\Throwable) {
            // File not available
        }

        return Inertia::render('admin/config', [
            'server_config' => $serverConfig,
            'sandbox_config' => $sandboxConfig,
            'respawn_delay' => $this->respawnDelay->getConfig(),
        ]);
    }

    public function updateServer(Request $request): JsonResponse
    {
        $settings = $request->validate([
            'settings' => 'required|array|min:1',
            'settings.*' => ['string', new SafeConfigValue(allowBackslash: true)],
        ])['settings'];

        $path = config('zomboid.paths.server_ini');
        $before = $this->iniParser->read($path);

        $this->iniParser->write($path, $settings);
        $this->configState->persistSettings($settings, $path);

        $after = $this->iniParser->read($path);

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'config.server.update',
            target: 'server.ini',
            details: [
                'updated_fields' => array_keys($settings),
                'before' => array_intersect_key($before, $settings),
                'after' => array_intersect_key($after, $settings),
            ],
            ip: $request->ip(),
        );

        return response()->json([
            'updated_fields' => array_keys($settings),
            'restart_required' => true,
        ]);
    }

    public function updateSandbox(Request $request): JsonResponse
    {
        $settings = $request->validate([
            'settings' => 'required|array|min:1',
            'settings.*' => ['required', new SafeConfigValue],
        ])['settings'];

        $path = config('zomboid.paths.sandbox_lua');
        $before = $this->luaParser->read($path);

        $this->luaParser->write($path, $settings);

        $after = $this->luaParser->read($path);

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'config.sandbox.update',
            target: 'SandboxVars.lua',
            details: [
                'updated_fields' => array_keys($settings),
            ],
            ip: $request->ip(),
        );

        return response()->json([
            'updated_fields' => array_keys($settings),
            'restart_required' => true,
        ]);
    }

    public function importPreview(ImportConfigPreviewRequest $request): JsonResponse
    {
        $preview = $this->configImporter->preview(
            $request->validated('type'),
            $request->validated('content'),
        );

        return response()->json($preview);
    }

    public function importApply(ImportConfigApplyRequest $request): JsonResponse
    {
        $type = $request->validated('type');
        $settings = $request->validated('settings');

        $updatedFields = $this->configImporter->apply($type, $settings);

        if ($type === 'server') {
            $this->configState->persistSettings($settings, config('zomboid.paths.server_ini'));
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: "config.{$type}.import",
            target: $type === 'server' ? 'server.ini' : 'SandboxVars.lua',
            details: [
                'updated_fields' => $updatedFields,
                'imported_count' => count($updatedFields),
            ],
            ip: $request->ip(),
        );

        return response()->json([
            'updated_fields' => $updatedFields,
            'restart_required' => true,
        ]);
    }
}
