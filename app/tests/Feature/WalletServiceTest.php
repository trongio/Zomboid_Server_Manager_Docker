<?php

use App\Enums\TransactionSource;
use App\Enums\TransactionType;
use App\Exceptions\InsufficientBalanceException;
use App\Models\User;
use App\Models\Wallet;
use App\Services\WalletService;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->walletService = app(WalletService::class);
});

it('creates a wallet for user if none exists', function () {
    $user = User::factory()->create();

    $wallet = $this->walletService->getOrCreateWallet($user);

    expect($wallet)->toBeInstanceOf(Wallet::class)
        ->and((float) $wallet->balance)->toBe(0.0);
});

it('returns existing wallet', function () {
    $user = User::factory()->create();
    $existing = Wallet::factory()->for($user)->withBalance(100)->create();

    $wallet = $this->walletService->getOrCreateWallet($user);

    expect($wallet->id)->toBe($existing->id)
        ->and((float) $wallet->balance)->toBe(100.0);
});

it('credits a wallet', function () {
    $wallet = Wallet::factory()->create(['balance' => 0, 'total_earned' => 0]);

    $tx = $this->walletService->credit(
        $wallet,
        50.0,
        TransactionSource::AdminAward,
        'Test credit',
    );

    expect($tx->type)->toBe(TransactionType::Credit)
        ->and((float) $tx->amount)->toBe(50.0)
        ->and((float) $tx->balance_after)->toBe(50.0)
        ->and((float) $wallet->fresh()->balance)->toBe(50.0)
        ->and((float) $wallet->fresh()->total_earned)->toBe(50.0);
});

it('debits a wallet', function () {
    $wallet = Wallet::factory()->create(['balance' => 100, 'total_earned' => 100, 'total_spent' => 0]);

    $tx = $this->walletService->debit(
        $wallet,
        30.0,
        TransactionSource::Purchase,
        'Test debit',
    );

    expect($tx->type)->toBe(TransactionType::Debit)
        ->and((float) $tx->amount)->toBe(30.0)
        ->and((float) $tx->balance_after)->toBe(70.0)
        ->and((float) $wallet->fresh()->balance)->toBe(70.0)
        ->and((float) $wallet->fresh()->total_spent)->toBe(30.0);
});

it('throws exception on insufficient balance', function () {
    $wallet = Wallet::factory()->create(['balance' => 10, 'total_earned' => 10, 'total_spent' => 0]);

    $this->walletService->debit(
        $wallet,
        50.0,
        TransactionSource::Purchase,
        'Over-spend',
    );
})->throws(InsufficientBalanceException::class);

it('returns zero balance for user without wallet', function () {
    $user = User::factory()->create();

    expect($this->walletService->getBalance($user))->toBe(0.0);
});

it('returns correct balance for user with wallet', function () {
    $user = User::factory()->create();
    Wallet::factory()->for($user)->create(['balance' => 250.50]);

    expect($this->walletService->getBalance($user))->toBe(250.50);
});
