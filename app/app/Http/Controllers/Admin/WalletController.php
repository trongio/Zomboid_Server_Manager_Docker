<?php

namespace App\Http\Controllers\Admin;

use App\Enums\TransactionSource;
use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\CreditWalletRequest;
use App\Models\User;
use App\Services\AuditLogger;
use App\Services\WalletService;
use Illuminate\Http\JsonResponse;
use Inertia\Inertia;
use Inertia\Response;

class WalletController extends Controller
{
    public function __construct(
        private readonly WalletService $walletService,
        private readonly AuditLogger $auditLogger,
    ) {}

    /**
     * Display all player wallets.
     */
    public function index(): Response
    {
        $users = User::query()
            ->with('wallet')
            ->orderBy('username')
            ->get()
            ->map(fn (User $user) => [
                'id' => $user->id,
                'username' => $user->username,
                'name' => $user->name,
                'role' => $user->role->value,
                'balance' => $user->wallet ? (float) $user->wallet->balance : 0,
                'total_earned' => $user->wallet ? (float) $user->wallet->total_earned : 0,
                'total_spent' => $user->wallet ? (float) $user->wallet->total_spent : 0,
            ]);

        return Inertia::render('admin/wallets', [
            'users' => $users,
        ]);
    }

    /**
     * Award currency to a user's wallet.
     */
    public function credit(CreditWalletRequest $request, User $user): JsonResponse
    {
        $validated = $request->validated();

        $wallet = $this->walletService->getOrCreateWallet($user);

        $this->walletService->credit(
            $wallet,
            $validated['amount'],
            TransactionSource::AdminAward,
            $validated['description'] ?? "Awarded by {$request->user()->name}",
        );

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'shop.currency.awarded',
            target: $user->username,
            details: [
                'amount' => $validated['amount'],
                'description' => $validated['description'] ?? null,
                'new_balance' => (float) $wallet->fresh()->balance,
            ],
            ip: $request->ip(),
        );

        return response()->json([
            'message' => "Awarded {$validated['amount']} to {$user->username}",
            'balance' => (float) $wallet->fresh()->balance,
        ]);
    }

    /**
     * Get transaction history for a user.
     */
    public function transactions(User $user): JsonResponse
    {
        $transactions = $this->walletService->getTransactionHistory($user, 50);

        return response()->json([
            'user' => [
                'id' => $user->id,
                'username' => $user->username,
            ],
            'transactions' => $transactions,
        ]);
    }
}
