<?php

namespace App\Services;

use App\Enums\TransactionSource;
use App\Enums\TransactionType;
use App\Exceptions\InsufficientBalanceException;
use App\Models\ShopPurchase;
use App\Models\User;
use App\Models\Wallet;
use App\Models\WalletTransaction;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Support\Facades\DB;

class WalletService
{
    /**
     * Get or lazily create a wallet for the user.
     */
    public function getOrCreateWallet(User $user): Wallet
    {
        return $user->wallet ?? $user->wallet()->create([
            'balance' => 0,
            'total_earned' => 0,
            'total_spent' => 0,
        ]);
    }

    /**
     * Credit currency to a wallet.
     */
    public function credit(
        Wallet $wallet,
        float $amount,
        TransactionSource $source,
        ?string $description = null,
        ?string $referenceType = null,
        ?string $referenceId = null,
        ?array $metadata = null,
    ): WalletTransaction {
        return DB::transaction(function () use ($wallet, $amount, $source, $description, $referenceType, $referenceId, $metadata) {
            $wallet = Wallet::query()->lockForUpdate()->find($wallet->id);

            $wallet->balance = (float) $wallet->balance + $amount;
            $wallet->total_earned = (float) $wallet->total_earned + $amount;
            $wallet->save();

            return $wallet->transactions()->create([
                'type' => TransactionType::Credit,
                'amount' => $amount,
                'balance_after' => $wallet->balance,
                'source' => $source,
                'reference_type' => $referenceType,
                'reference_id' => $referenceId,
                'description' => $description,
                'metadata' => $metadata,
            ]);
        });
    }

    /**
     * Debit currency from a wallet.
     *
     * @throws InsufficientBalanceException
     */
    public function debit(
        Wallet $wallet,
        float $amount,
        TransactionSource $source,
        ?string $description = null,
        ?string $referenceType = null,
        ?string $referenceId = null,
        ?array $metadata = null,
    ): WalletTransaction {
        return DB::transaction(function () use ($wallet, $amount, $source, $description, $referenceType, $referenceId, $metadata) {
            $wallet = Wallet::query()->lockForUpdate()->find($wallet->id);

            if ((float) $wallet->balance < $amount) {
                throw new InsufficientBalanceException((float) $wallet->balance, $amount);
            }

            $wallet->balance = (float) $wallet->balance - $amount;
            $wallet->total_spent = (float) $wallet->total_spent + $amount;
            $wallet->save();

            return $wallet->transactions()->create([
                'type' => TransactionType::Debit,
                'amount' => $amount,
                'balance_after' => $wallet->balance,
                'source' => $source,
                'reference_type' => $referenceType,
                'reference_id' => $referenceId,
                'description' => $description,
                'metadata' => $metadata,
            ]);
        });
    }

    /**
     * Refund a purchase back to the wallet.
     */
    public function refund(ShopPurchase $purchase): WalletTransaction
    {
        $wallet = $this->getOrCreateWallet($purchase->user);

        return $this->credit(
            $wallet,
            (float) $purchase->total_price,
            TransactionSource::Refund,
            "Refund for purchase #{$purchase->id}",
            ShopPurchase::class,
            $purchase->id,
        );
    }

    /**
     * Get current balance for a user.
     */
    public function getBalance(User $user): float
    {
        return (float) ($user->wallet()->value('balance') ?? 0);
    }

    /**
     * Get paginated transaction history for a user.
     */
    public function getTransactionHistory(User $user, int $perPage = 20): LengthAwarePaginator
    {
        $wallet = $user->wallet;

        if (! $wallet) {
            return new \Illuminate\Pagination\LengthAwarePaginator([], 0, $perPage);
        }

        return $wallet->transactions()
            ->orderByDesc('created_at')
            ->paginate($perPage);
    }
}
