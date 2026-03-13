<?php

namespace App\Services;

use App\Enums\DeliveryStatus;
use App\Models\ShopDelivery;
use App\Models\ShopItem;
use App\Models\ShopPurchase;

class ShopDeliveryService
{
    public function __construct(
        private readonly DeliveryQueueManager $deliveryQueue,
    ) {}

    /**
     * Queue all deliveries for a purchase by writing to delivery_queue.json.
     */
    public function queueDeliveries(ShopPurchase $purchase): void
    {
        $user = $purchase->user;
        $whitelistEntry = $user->whitelistEntries()->where('active', true)->first();

        if (! $whitelistEntry) {
            $purchase->deliveries()->update([
                'status' => DeliveryStatus::Failed,
                'error_message' => 'No active whitelist entry found for user',
            ]);
            $purchase->update(['delivery_status' => DeliveryStatus::Failed]);

            return;
        }

        $pzUsername = $whitelistEntry->pz_username;

        foreach ($purchase->deliveries as $delivery) {
            if (! in_array($delivery->status, [DeliveryStatus::Pending, DeliveryStatus::Failed])) {
                continue;
            }

            $entry = $this->deliveryQueue->giveItem($pzUsername, $delivery->item_type, $delivery->quantity);

            $delivery->update([
                'username' => $pzUsername,
                'delivery_queue_id' => $entry['id'],
                'status' => DeliveryStatus::Queued,
                'attempts' => $delivery->attempts + 1,
                'last_attempt_at' => now(),
            ]);
        }

        $purchase->update(['delivery_status' => DeliveryStatus::Queued]);
    }

    /**
     * Process delivery results from Lua and update delivery records.
     *
     * @return int Number of results processed
     */
    public function processResults(): int
    {
        $results = $this->deliveryQueue->readResults();
        $processed = 0;

        foreach ($results['results'] ?? [] as $result) {
            $delivery = ShopDelivery::query()
                ->where('delivery_queue_id', $result['id'])
                ->first();

            if (! $delivery) {
                continue;
            }

            if ($result['status'] === 'delivered') {
                $delivery->update([
                    'status' => DeliveryStatus::Delivered,
                    'delivered_at' => now(),
                ]);
            } else {
                $delivery->update([
                    'status' => DeliveryStatus::Failed,
                    'error_message' => $result['message'] ?? 'Delivery failed',
                ]);
            }

            $processed++;
        }

        if ($processed > 0) {
            $this->updatePurchaseStatuses();
        }

        return $processed;
    }

    /**
     * Retry pending/failed deliveries that are stale (>5 min, <10 attempts).
     *
     * @return int Number of deliveries retried
     */
    public function retryPending(): int
    {
        $staleDeliveries = ShopDelivery::query()
            ->whereIn('status', [DeliveryStatus::Pending, DeliveryStatus::Failed])
            ->where('attempts', '<', 10)
            ->where(function ($q) {
                $q->whereNull('last_attempt_at')
                    ->orWhere('last_attempt_at', '<', now()->subMinutes(5));
            })
            ->with('purchase.user.whitelistEntries')
            ->get();

        $retried = 0;

        foreach ($staleDeliveries as $delivery) {
            $purchase = $delivery->purchase;
            $whitelistEntry = $purchase->user->whitelistEntries()->where('active', true)->first();

            if (! $whitelistEntry) {
                continue;
            }

            $entry = $this->deliveryQueue->giveItem(
                $whitelistEntry->pz_username,
                $delivery->item_type,
                $delivery->quantity,
            );

            $delivery->update([
                'username' => $whitelistEntry->pz_username,
                'delivery_queue_id' => $entry['id'],
                'status' => DeliveryStatus::Queued,
                'attempts' => $delivery->attempts + 1,
                'last_attempt_at' => now(),
                'error_message' => null,
            ]);

            $retried++;
        }

        return $retried;
    }

    /**
     * Update parent purchase delivery statuses based on child deliveries.
     */
    private function updatePurchaseStatuses(): void
    {
        $purchaseIds = ShopDelivery::query()
            ->whereIn('status', [DeliveryStatus::Delivered, DeliveryStatus::Failed])
            ->pluck('shop_purchase_id')
            ->unique();

        foreach ($purchaseIds as $purchaseId) {
            $purchase = ShopPurchase::query()->with('deliveries')->find($purchaseId);
            if (! $purchase) {
                continue;
            }

            $statuses = $purchase->deliveries->pluck('status');

            if ($statuses->every(fn ($s) => $s === DeliveryStatus::Delivered)) {
                $purchase->update([
                    'delivery_status' => DeliveryStatus::Delivered,
                    'delivered_at' => now(),
                ]);
            } elseif ($statuses->contains(DeliveryStatus::Delivered) && $statuses->contains(DeliveryStatus::Failed)) {
                $purchase->update(['delivery_status' => DeliveryStatus::PartiallyDelivered]);
            } elseif ($statuses->every(fn ($s) => $s === DeliveryStatus::Failed)) {
                $purchase->update(['delivery_status' => DeliveryStatus::Failed]);
            }
        }
    }
}
