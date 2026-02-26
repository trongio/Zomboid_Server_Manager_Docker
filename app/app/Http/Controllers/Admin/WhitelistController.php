<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Services\AuditLogger;
use App\Services\WhitelistManager;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class WhitelistController extends Controller
{
    public function __construct(
        private readonly WhitelistManager $whitelistManager,
        private readonly AuditLogger $auditLogger,
    ) {}

    public function index(): Response
    {
        $entries = [];

        try {
            $entries = $this->whitelistManager->list();
        } catch (\Throwable) {
            // SQLite not available
        }

        return Inertia::render('admin/whitelist', [
            'entries' => $entries,
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'username' => 'required|string|min:3|max:50',
            'password' => 'required|string|min:4|max:100',
        ]);

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
