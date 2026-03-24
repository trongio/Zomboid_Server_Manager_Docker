<?php

namespace App\Services;

use App\Enums\DeliveryStatus;
use App\Exceptions\InsufficientBalanceException;
use App\Models\ShopBundle;
use App\Models\ShopItem;
use App\Models\ShopPromotion;
use App\Models\ShopPurchase;
use App\Models\User;
use App\Models\Wallet;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

class ShopPurchaseService
{
    public function __construct(
        private readonly WalletService $walletService,
        private readonly PromotionEngine $promotionEngine,
        private readonly ShopDeliveryService $deliveryService,
    ) {}

    /**
     * Purchase a shop item.
     *
     * Creates the purchase record without debiting the wallet. The wallet is debited
     * only after Lua confirms items were delivered (deliver-then-debit pattern).
     *
     * @throws InsufficientBalanceException
     * @throws InvalidArgumentException
     */
    public function purchaseItem(
        User $user,
        ShopItem $item,
        int $quantity = 1,
        ?ShopPromotion $promotion = null,
    ): ShopPurchase {
        if (! $item->is_active) {
            throw new InvalidArgumentException('This item is not available for purchase.');
        }

        if ($item->stock !== null && $item->stock < $quantity) {
            throw new InvalidArgumentException('Insufficient stock available.');
        }

        if ($item->max_per_player !== null) {
            $existing = ShopPurchase::query()
                ->where('user_id', $user->id)
                ->where('purchasable_type', ShopItem::class)
                ->where('purchasable_id', $item->id)
                ->sum('quantity_bought');

            if ($existing + $quantity > $item->max_per_player) {
                throw new InvalidArgumentException("Purchase limit reached. Maximum {$item->max_per_player} per player.");
            }
        }

        if ($promotion && ! $this->promotionEngine->validatePromotion($promotion, $user, $item)) {
            $promotion = null;
        }

        $discount = $this->promotionEngine->calculateDiscount($item, $quantity, $promotion);
        $totalPrice = max(0, ((float) $item->price * $quantity) - $discount);

        $purchase = DB::transaction(function () use ($user, $item, $quantity, $promotion, $discount, $totalPrice) {
            // Lock wallet row to prevent concurrent purchases from double-spending
            Wallet::query()->where('user_id', $user->id)->lockForUpdate()->first();

            $availableBalance = $this->walletService->getAvailableBalance($user);
            if ($availableBalance < $totalPrice) {
                throw new InsufficientBalanceException($availableBalance, $totalPrice);
            }

            $purchase = ShopPurchase::query()->create([
                'user_id' => $user->id,
                'wallet_transaction_id' => null,
                'purchasable_type' => ShopItem::class,
                'purchasable_id' => $item->id,
                'quantity_bought' => $quantity,
                'total_price' => $totalPrice,
                'discount_amount' => $discount,
                'promotion_id' => $promotion?->id,
                'delivery_status' => DeliveryStatus::Pending,
                'metadata' => [
                    'item_type' => $item->item_type,
                    'item_name' => $item->name,
                    'unit_price' => (float) $item->price,
                    'pz_quantity' => $item->quantity,
                ],
            ]);

            // Create delivery records for each unit
            $totalPzItems = $item->quantity * $quantity;
            $purchase->deliveries()->create([
                'username' => '',
                'item_type' => $item->item_type,
                'quantity' => $totalPzItems,
                'status' => DeliveryStatus::Pending,
            ]);

            if ($item->stock !== null) {
                $item->decrement('stock', $quantity);
            }

            if ($promotion) {
                $promotion->increment('usage_count');
            }

            return $purchase;
        });

        $purchase->load('deliveries');
        $this->deliveryService->queueDeliveries($purchase);

        return $purchase;
    }

    /**
     * Purchase a shop bundle.
     *
     * Creates the purchase record without debiting the wallet. The wallet is debited
     * only after Lua confirms items were delivered (deliver-then-debit pattern).
     *
     * @throws InsufficientBalanceException
     * @throws InvalidArgumentException
     */
    public function purchaseBundle(
        User $user,
        ShopBundle $bundle,
        ?ShopPromotion $promotion = null,
    ): ShopPurchase {
        if (! $bundle->is_active) {
            throw new InvalidArgumentException('This bundle is not available for purchase.');
        }

        $bundle->load('items');

        if ($bundle->items->isEmpty()) {
            throw new InvalidArgumentException('This bundle contains no items.');
        }

        if ($bundle->max_per_player !== null) {
            $existing = ShopPurchase::query()
                ->where('user_id', $user->id)
                ->where('purchasable_type', ShopBundle::class)
                ->where('purchasable_id', $bundle->id)
                ->count();

            if ($existing >= $bundle->max_per_player) {
                throw new InvalidArgumentException("Purchase limit reached. Maximum {$bundle->max_per_player} per player.");
            }
        }

        if ($promotion && ! $this->promotionEngine->validatePromotion($promotion, $user, $bundle)) {
            $promotion = null;
        }

        $discount = $this->promotionEngine->calculateDiscount($bundle, 1, $promotion);
        $totalPrice = max(0, (float) $bundle->price - $discount);

        $purchase = DB::transaction(function () use ($user, $bundle, $promotion, $discount, $totalPrice) {
            // Lock wallet row to prevent concurrent purchases from double-spending
            Wallet::query()->where('user_id', $user->id)->lockForUpdate()->first();

            $availableBalance = $this->walletService->getAvailableBalance($user);
            if ($availableBalance < $totalPrice) {
                throw new InsufficientBalanceException($availableBalance, $totalPrice);
            }

            $itemSnapshot = $bundle->items->map(fn ($item) => [
                'id' => $item->id,
                'name' => $item->name,
                'item_type' => $item->item_type,
                'quantity' => $item->pivot->quantity * $item->quantity,
            ])->toArray();

            $purchase = ShopPurchase::query()->create([
                'user_id' => $user->id,
                'wallet_transaction_id' => null,
                'purchasable_type' => ShopBundle::class,
                'purchasable_id' => $bundle->id,
                'quantity_bought' => 1,
                'total_price' => $totalPrice,
                'discount_amount' => $discount,
                'promotion_id' => $promotion?->id,
                'delivery_status' => DeliveryStatus::Pending,
                'metadata' => ['items' => $itemSnapshot],
            ]);

            foreach ($bundle->items as $item) {
                $purchase->deliveries()->create([
                    'username' => '',
                    'item_type' => $item->item_type,
                    'quantity' => $item->pivot->quantity * $item->quantity,
                    'status' => DeliveryStatus::Pending,
                ]);
            }

            if ($promotion) {
                $promotion->increment('usage_count');
            }

            return $purchase;
        });

        $purchase->load('deliveries');
        $this->deliveryService->queueDeliveries($purchase);

        return $purchase;
    }
}
