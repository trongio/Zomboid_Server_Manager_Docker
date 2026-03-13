<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\StoreShopPromotionRequest;
use App\Http\Requests\Admin\UpdateShopPromotionRequest;
use App\Models\ShopPromotion;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Inertia\Inertia;
use Inertia\Response;

class ShopPromotionController extends Controller
{
    public function __construct(
        private readonly AuditLogger $auditLogger,
    ) {}

    /**
     * Display promotion management page.
     */
    public function index(): Response
    {
        $promotions = ShopPromotion::query()
            ->orderByDesc('created_at')
            ->get();

        return Inertia::render('admin/shop-promotions', [
            'promotions' => $promotions,
        ]);
    }

    /**
     * Create a new promotion.
     */
    public function store(StoreShopPromotionRequest $request): JsonResponse
    {
        $validated = $request->validated();

        if (isset($validated['code'])) {
            $validated['code'] = strtoupper($validated['code']);
        }

        $promotion = ShopPromotion::query()->create($validated);

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'shop.promotion.create',
            target: $promotion->name,
            details: [
                'promotion_id' => $promotion->id,
                'type' => $promotion->type->value,
                'value' => (float) $promotion->value,
            ],
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Promotion created', 'promotion' => $promotion], 201);
    }

    /**
     * Update a promotion.
     */
    public function update(UpdateShopPromotionRequest $request, ShopPromotion $promotion): JsonResponse
    {
        $validated = $request->validated();

        if (isset($validated['code'])) {
            $validated['code'] = strtoupper($validated['code']);
        }

        $promotion->update($validated);

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'shop.promotion.update',
            target: $promotion->name,
            details: ['promotion_id' => $promotion->id],
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Promotion updated', 'promotion' => $promotion]);
    }

    /**
     * Delete a promotion.
     */
    public function destroy(ShopPromotion $promotion): JsonResponse
    {
        $name = $promotion->name;
        $promotion->delete();

        $this->auditLogger->log(
            actor: request()->user()->name ?? 'admin',
            action: 'shop.promotion.delete',
            target: $name,
            ip: request()->ip(),
        );

        return response()->json(['message' => 'Promotion deleted']);
    }

    /**
     * Toggle a promotion's active status.
     */
    public function toggle(ShopPromotion $promotion): JsonResponse
    {
        $promotion->update(['is_active' => ! $promotion->is_active]);

        $this->auditLogger->log(
            actor: request()->user()->name ?? 'admin',
            action: $promotion->is_active ? 'shop.promotion.activate' : 'shop.promotion.deactivate',
            target: $promotion->name,
            ip: request()->ip(),
        );

        return response()->json(['message' => $promotion->is_active ? 'Promotion activated' : 'Promotion deactivated']);
    }
}
