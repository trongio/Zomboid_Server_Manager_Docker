<?php

namespace App\Services;

use App\Enums\TransactionSource;
use App\Models\WalletTransaction;
use App\Models\WhitelistEntry;
use Illuminate\Support\Str;

class MoneyDepositManager
{
    /** Seconds before a pending request with no result is considered timed out. */
    private const PENDING_TIMEOUT_SECONDS = 120;

    private string $requestsPath;

    private string $resultsPath;

    public function __construct(?string $requestsPath = null, ?string $resultsPath = null)
    {
        $this->requestsPath = $requestsPath ?? config('zomboid.lua_bridge.deposit_requests');
        $this->resultsPath = $resultsPath ?? config('zomboid.lua_bridge.deposit_results');
    }

    /**
     * Create a deposit request for a player.
     *
     * @return array{id: string, username: string, status: string, created_at: string}
     */
    public function createRequest(string $username): array
    {
        $data = $this->readJsonFile($this->requestsPath, ['version' => 1, 'updated_at' => '', 'requests' => []]);

        $entry = [
            'id' => Str::uuid()->toString(),
            'username' => $username,
            'status' => 'pending',
            'created_at' => date('c'),
        ];

        $data['requests'][] = $entry;
        $data['updated_at'] = date('c');

        $this->writeJsonFileAtomic($this->requestsPath, $data);

        return $entry;
    }

    /**
     * Check if a player has a pending (unprocessed) deposit request.
     * Cross-references the results file and applies a timeout — if a result exists
     * for a request ID or the request is older than PENDING_TIMEOUT_SECONDS, it's no longer pending.
     */
    public function hasPendingRequest(string $username): bool
    {
        $requests = $this->readJsonFile($this->requestsPath, ['version' => 1, 'updated_at' => '', 'requests' => []]);
        $results = $this->readJsonFile($this->resultsPath, ['version' => 1, 'updated_at' => '', 'results' => []]);

        // Build set of processed request IDs from results
        $processedIds = [];
        foreach ($results['results'] as $result) {
            if (isset($result['id'])) {
                $processedIds[$result['id']] = true;
            }
        }

        $timeoutCutoff = time() - self::PENDING_TIMEOUT_SECONDS;

        foreach ($requests['requests'] as $request) {
            if ($request['username'] !== $username || $request['status'] !== 'pending') {
                continue;
            }

            // Already has a result from Lua
            if (isset($processedIds[$request['id']])) {
                continue;
            }

            // Timed out — Lua never responded (server probably offline)
            $createdAt = strtotime($request['created_at'] ?? '');
            if ($createdAt && $createdAt < $timeoutCutoff) {
                continue;
            }

            return true;
        }

        return false;
    }

    /**
     * Get the most recent deposit result for a user.
     * If a request has timed out without a Lua result, synthesizes a timeout error.
     *
     * @return array{id: string, username: string, status: string, money_count: int, stack_count: int, total_coins: int, message: string|null, processed_at: string}|null
     */
    public function getLastResult(string $username): ?array
    {
        $resultsData = $this->readJsonFile($this->resultsPath, ['version' => 1, 'updated_at' => '', 'results' => []]);

        // Only show results that match a recent request (created within the last 5 minutes).
        // This avoids timezone mismatch between Lua and PHP timestamps.
        $requestsData = $this->readJsonFile($this->requestsPath, ['version' => 1, 'updated_at' => '', 'requests' => []]);
        $recentRequestIds = [];
        $fiveMinutesAgo = time() - 300;
        foreach ($requestsData['requests'] as $request) {
            if ($request['username'] !== $username) {
                continue;
            }
            $createdAt = strtotime($request['created_at'] ?? '');
            if ($createdAt && $createdAt > $fiveMinutesAgo) {
                $recentRequestIds[$request['id']] = true;
            }
        }

        $last = null;
        foreach ($resultsData['results'] as $result) {
            if ($result['username'] === $username && isset($recentRequestIds[$result['id']])) {
                $last = $result;
            }
        }

        if ($last !== null) {
            return $last;
        }

        // No Lua result — check for a timed-out request and synthesize an error
        $requestsData = $this->readJsonFile($this->requestsPath, ['version' => 1, 'updated_at' => '', 'requests' => []]);
        $timeoutCutoff = time() - self::PENDING_TIMEOUT_SECONDS;

        $staleAge = time() - 600; // 10 minutes — same as cleanup window

        $timedOutRequest = null;
        foreach ($requestsData['requests'] as $request) {
            if ($request['username'] !== $username || $request['status'] !== 'pending') {
                continue;
            }

            $createdAt = strtotime($request['created_at'] ?? '');
            if ($createdAt && $createdAt < $timeoutCutoff && $createdAt > $staleAge) {
                $timedOutRequest = $request;
            }
        }

        if ($timedOutRequest !== null) {
            return [
                'id' => $timedOutRequest['id'],
                'username' => $username,
                'status' => 'failed',
                'money_count' => 0,
                'stack_count' => 0,
                'total_coins' => 0,
                'message' => 'Deposit timed out. Make sure you are online in-game and the server is running.',
                'processed_at' => date('c'),
            ];
        }

        return null;
    }

    /**
     * Process deposit results: credit wallets and return IDs of successfully credited results.
     *
     * @return array<string> IDs of results that were credited
     */
    public function processResults(WalletService $walletService): array
    {
        $data = $this->readJsonFile($this->resultsPath, ['version' => 1, 'updated_at' => '', 'results' => []]);

        if (empty($data['results'])) {
            return [];
        }

        $creditedIds = [];

        foreach ($data['results'] as $result) {
            if (($result['status'] ?? '') !== 'success') {
                continue;
            }

            // Dedup: skip if already credited (but still mark for removal)
            if (WalletTransaction::query()->where('reference_id', $result['id'])->exists()) {
                $creditedIds[] = $result['id'];

                continue;
            }

            $totalCoins = $result['total_coins'] ?? 0;
            if ($totalCoins <= 0) {
                $creditedIds[] = $result['id'];

                continue;
            }

            // Look up user via WhitelistEntry
            $whitelistEntry = WhitelistEntry::query()
                ->where('pz_username', $result['username'])
                ->where('active', true)
                ->first();

            if (! $whitelistEntry || ! $whitelistEntry->user) {
                continue;
            }

            $wallet = $walletService->getOrCreateWallet($whitelistEntry->user);

            $walletService->credit(
                $wallet,
                (float) $totalCoins,
                TransactionSource::InGameDeposit,
                "In-game money deposit: {$result['money_count']}x Money + " . ($result['bundle_count'] ?? 0) . "x MoneyBundle",
                'deposit',
                $result['id'],
                [
                    'money_count' => $result['money_count'] ?? 0,
                    'bundle_count' => $result['bundle_count'] ?? 0,
                    'pz_username' => $result['username'],
                ],
            );

            $creditedIds[] = $result['id'];
        }

        return $creditedIds;
    }

    /**
     * Remove stale pending requests older than 10 minutes, and requests that already have a result.
     */
    public function cleanupStaleRequests(): void
    {
        $data = $this->readJsonFile($this->requestsPath, ['version' => 1, 'updated_at' => '', 'requests' => []]);
        $results = $this->readJsonFile($this->resultsPath, ['version' => 1, 'updated_at' => '', 'results' => []]);
        $cutoff = strtotime('-10 minutes');
        $changed = false;

        // Build set of processed request IDs from results
        $processedIds = [];
        foreach ($results['results'] as $result) {
            if (isset($result['id'])) {
                $processedIds[$result['id']] = true;
            }
        }

        $data['requests'] = array_values(array_filter($data['requests'], function ($request) use ($cutoff, $processedIds, &$changed) {
            // Remove requests that already have a result
            if (isset($processedIds[$request['id']])) {
                $changed = true;

                return false;
            }

            // Remove stale pending requests older than 10 minutes
            $createdAt = strtotime($request['created_at'] ?? '');
            if ($request['status'] === 'pending' && $createdAt && $createdAt < $cutoff) {
                $changed = true;

                return false;
            }

            return true;
        }));

        if ($changed) {
            $data['updated_at'] = date('c');
            $this->writeJsonFileAtomic($this->requestsPath, $data);
        }
    }

    /**
     * Remove only successfully credited results from the results file.
     * Failed results are kept so the UI can display them.
     *
     * @param  array<string>  $creditedIds  Result IDs that were successfully credited to wallets
     */
    public function removeProcessedResults(array $creditedIds): bool
    {
        if (empty($creditedIds)) {
            return true;
        }

        $data = $this->readJsonFile($this->resultsPath, ['version' => 1, 'updated_at' => '', 'results' => []]);
        $idSet = array_flip($creditedIds);

        $data['results'] = array_values(array_filter(
            $data['results'],
            fn ($result) => ! isset($idSet[$result['id']]),
        ));
        $data['updated_at'] = date('c');

        return $this->writeJsonFileAtomic($this->resultsPath, $data);
    }

    /**
     * Read and decode a JSON file, returning default on failure.
     */
    private function readJsonFile(string $path, array $default): array
    {
        if (! file_exists($path)) {
            return $default;
        }

        $content = file_get_contents($path);
        if ($content === false) {
            return $default;
        }

        $data = json_decode($content, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            return $default;
        }

        return $data;
    }

    /**
     * Write JSON data atomically using temp file + rename.
     */
    private function writeJsonFileAtomic(string $path, array $data): bool
    {
        $dir = dirname($path);
        if (! is_dir($dir)) {
            mkdir($dir, 0755, true);
        }

        $tmpPath = $path.'.tmp.'.getmypid().'.'.bin2hex(random_bytes(4));
        $json = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);

        if (file_put_contents($tmpPath, $json) === false) {
            return false;
        }

        return rename($tmpPath, $path);
    }
}
