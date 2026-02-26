<?php

namespace App\Http\Controllers;

use App\Models\WhitelistEntry;
use App\Services\RconClient;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Inertia\Inertia;
use Inertia\Response;

class PortalController extends Controller
{
    public function __construct(private RconClient $rcon) {}

    public function __invoke(Request $request): Response
    {
        $user = $request->user();

        $whitelistEntry = WhitelistEntry::where('pz_username', $user->username)
            ->where('active', true)
            ->first();

        $isOnline = $this->checkPlayerOnline($user->username);

        return Inertia::render('portal', [
            'pzAccount' => [
                'username' => $user->username,
                'whitelisted' => $whitelistEntry !== null,
                'isOnline' => $isOnline,
                'syncedAt' => $whitelistEntry?->synced_at?->toISOString(),
            ],
            'hasEmail' => $user->email !== null,
            'emailVerified' => $user->email_verified_at !== null,
        ]);
    }

    private function checkPlayerOnline(string $username): bool
    {
        try {
            $response = $this->rcon->command('players');

            // PZ returns "Players connected (N):\n-player1\n-player2\n..."
            return str_contains($response, "-{$username}\n") || str_ends_with($response, "-{$username}");
        } catch (\Exception $e) {
            Log::debug('RCON unavailable for online check', ['error' => $e->getMessage()]);

            return false;
        }
    }
}
