<?php

namespace App\Services;

use App\Enums\PromotionScope;
use App\Enums\PromotionType;
use App\Models\ShopBundle;
use App\Models\ShopItem;
use App\Models\ShopPromotion;
use App\Models\ShopPurchase;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Collection;

class PromotionEngine
{
    /**
     * Calculate the discount amount for a purchasable item with an optional promotion.
     */
    public function calculateDiscount(Model $purchasable, int $quantity, ?ShopPromotion $promotion): float
    {
        if (! $promotion || ! $promotion->isValid()) {
            return 0.0;
        }

        $unitPrice = (float) $purchasable->price;
        $subtotal = $unitPrice * $quantity;

        if ($promotion->min_purchase !== null && $subtotal < (float) $promotion->min_purchase) {
            return 0.0;
        }

        if (! $this->appliesToPurchasable($promotion, $purchasable)) {
            return 0.0;
        }

        $discount = match ($promotion->type) {
            PromotionType::Percentage => $subtotal * ((float) $promotion->value / 100),
            PromotionType::FixedAmount => (float) $promotion->value,
        };

        if ($promotion->max_discount !== null) {
            $discount = min($discount, (float) $promotion->max_discount);
        }

        return min($discount, $subtotal);
    }

    /**
     * Validate that a promotion can be used by a user for a given purchasable.
     */
    public function validatePromotion(ShopPromotion $promotion, User $user, Model $purchasable): bool
    {
        if (! $promotion->isValid()) {
            return false;
        }

        if (! $this->appliesToPurchasable($promotion, $purchasable)) {
            return false;
        }

        if ($promotion->per_user_limit !== null) {
            $userUsage = ShopPurchase::query()
                ->where('user_id', $user->id)
                ->where('promotion_id', $promotion->id)
                ->count();

            if ($userUsage >= $promotion->per_user_limit) {
                return false;
            }
        }

        return true;
    }

    /**
     * Get all currently active promotions.
     *
     * @return Collection<int, ShopPromotion>
     */
    public function getActivePromotions(): Collection
    {
        return ShopPromotion::query()
            ->where('is_active', true)
            ->where('starts_at', '<=', now())
            ->where(function ($q) {
                $q->whereNull('ends_at')->orWhere('ends_at', '>', now());
            })
            ->where(function ($q) {
                $q->whereNull('usage_limit')
                    ->orWhereColumn('usage_count', '<', 'usage_limit');
            })
            ->get();
    }

    /**
     * Check if a promotion applies to the given purchasable.
     */
    private function appliesToPurchasable(ShopPromotion $promotion, Model $purchasable): bool
    {
        return match ($promotion->applies_to) {
            PromotionScope::All => true,
            PromotionScope::Category => $purchasable instanceof ShopItem
                && $purchasable->category_id !== null
                && in_array($purchasable->category_id, $promotion->target_ids ?? []),
            PromotionScope::Item => $purchasable instanceof ShopItem
                && in_array($purchasable->id, $promotion->target_ids ?? []),
            PromotionScope::Bundle => $purchasable instanceof ShopBundle
                && in_array($purchasable->id, $promotion->target_ids ?? []),
        };
    }
}
