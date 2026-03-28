<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\AddWhitelistRequest;
use App\Http\Requests\Admin\ToggleWhitelistRequest;
use App\Http\Requests\Admin\UpdateWhitelistSettingsRequest;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\ServerIniParser;
use App\Services\WhitelistManager;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Inertia\Inertia;
use Inertia\Response;

class WhitelistController extends Controller
{
    public function __construct(
        private readonly WhitelistManager $whitelistManager,
        private readonly AuditLogger $auditLogger,
        private readonly ServerIniParser $iniParser,
    ) {}

    public function index(): Response
    {
        // Build a list of whitelisted usernames from PZ SQLite
        $whitelistedUsernames = [];

        try {
            $whitelistEntries = $this->whitelistManager->list();
            $whitelistedUsernames = array_column($whitelistEntries, 'username');
        } catch (\Throwable) {
            // SQLite not available
        }

        // Build character name lookup from players.db
        $characterNames = [];

        try {
            $networkPlayers = DB::connection('pz_players')
                ->table('networkPlayers')
                ->select('username', 'name')
                ->get();

            foreach ($networkPlayers as $player) {
                $characterNames[$player->username] = $player->name;
            }
        } catch (\Throwable) {
            // players.db not available
        }

        // Build lookup of usernames that have stored password hashes in PostgreSQL
        $storedHashUsernames = \App\Models\WhitelistEntry::whereNotNull('pz_password_hash')
            ->pluck('pz_username')
            ->all();

        // Get all web users and enrich with whitelist status + character name
        $players = User::query()
            ->orderBy('username')
            ->get()
            ->map(fn (User $user) => [
                'username' => $user->username,
                'name' => $user->name,
                'character_name' => $characterNames[$user->username] ?? null,
                'whitelisted' => in_array($user->username, $whitelistedUsernames, true),
                'role' => $user->role->value,
                'has_stored_credentials' => in_array($user->username, $storedHashUsernames, true),
            ])
            ->values()
            ->all();

        $whitelistSettings = ['open' => true, 'auto_create_user_in_whitelist' => true];

        try {
            $ini = $this->iniParser->read(config('zomboid.paths.server_ini'));
            $whitelistSettings['open'] = ($ini['Open'] ?? 'true') === 'true';
            $whitelistSettings['auto_create_user_in_whitelist'] = ($ini['AutoCreateUserInWhiteList'] ?? 'true') === 'true';
        } catch (\Throwable) {
            // INI not available — use defaults
        }

        return Inertia::render('admin/whitelist', [
            'players' => $players,
            'whitelist_settings' => $whitelistSettings,
        ]);
    }

    public function updateSettings(UpdateWhitelistSettingsRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $updates = [];

        if (array_key_exists('open', $validated)) {
            $updates['Open'] = $validated['open'] ? 'true' : 'false';
        }

        if (array_key_exists('auto_create_user_in_whitelist', $validated)) {
            $updates['AutoCreateUserInWhiteList'] = $validated['auto_create_user_in_whitelist'] ? 'true' : 'false';
        }

        $path = config('zomboid.paths.server_ini');
        $before = $this->iniParser->read($path);

        $this->iniParser->write($path, $updates);

        $after = $this->iniParser->read($path);

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'whitelist.settings.update',
            target: 'server.ini',
            details: [
                'before' => array_intersect_key($before, $updates),
                'after' => array_intersect_key($after, $updates),
            ],
            ip: $request->ip(),
        );

        return response()->json([
            'message' => 'Whitelist settings updated',
            'restart_required' => true,
        ]);
    }

    public function store(AddWhitelistRequest $request): JsonResponse
    {
        $validated = $request->validated();

        $added = $this->whitelistManager->add($validated['username'], $validated['password']);

        if (! $added) {
            return response()->json(['error' => 'User already whitelisted'], 409);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'whitelist.add',
            target: $validated['username'],
            ip: $request->ip(),
        );

        return response()->json([
            'message' => 'User added to whitelist',
            'username' => $validated['username'],
        ], 201);
    }

    public function destroy(Request $request, string $username): JsonResponse
    {
        $removed = $this->whitelistManager->remove($username);

        if (! $removed) {
            return response()->json(['error' => 'User not found'], 404);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'whitelist.remove',
            target: $username,
            ip: $request->ip(),
        );

        return response()->json([
            'message' => 'User removed from whitelist',
            'username' => $username,
        ]);
    }

    public function toggle(ToggleWhitelistRequest $request, string $username): JsonResponse
    {
        $isWhitelisted = $this->whitelistManager->exists($username);

        if ($isWhitelisted) {
            $this->whitelistManager->remove($username);

            $this->auditLogger->log(
                actor: $request->user()->name ?? 'admin',
                action: 'whitelist.remove',
                target: $username,
                ip: $request->ip(),
            );

            return response()->json([
                'message' => 'User removed from whitelist',
                'whitelisted' => false,
            ]);
        }

        // Try to restore using stored bcrypt hash from PostgreSQL
        $restored = $this->whitelistManager->restore($username);

        if (! $restored) {
            // No stored hash — require a password
            $password = $request->validated('password');

            if (empty($password)) {
                throw \Illuminate\Validation\ValidationException::withMessages([
                    'password' => ['The password field is required.'],
                ]);
            }

            $this->whitelistManager->add($username, $password);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'whitelist.add',
            target: $username,
            ip: $request->ip(),
        );

        return response()->json([
            'message' => 'User added to whitelist',
            'whitelisted' => true,
        ]);
    }

    public function sync(Request $request): JsonResponse
    {
        $result = $this->whitelistManager->syncWithPostgres();

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'whitelist.sync',
            details: $result,
            ip: $request->ip(),
        );

        return response()->json([
            'message' => 'Sync completed',
            'added' => $result['added'],
            'removed' => $result['removed'],
            'mismatches' => $result['mismatches'],
        ]);
    }
}
