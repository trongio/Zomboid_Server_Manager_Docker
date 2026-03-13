<?php

namespace App\Http\Controllers;

use App\Exceptions\InsufficientBalanceException;
use App\Http\Requests\PurchaseItemRequest;
use App\Models\ShopBundle;
use App\Models\ShopCategory;
use App\Models\ShopItem;
use App\Models\ShopPromotion;
use App\Services\ItemIconResolver;
use App\Services\PromotionEngine;
use App\Services\ShopPurchaseService;
use App\Services\WalletService;
use Illuminate\Http\JsonResponse;
use Inertia\Inertia;
use Inertia\Response;

class ShopController extends Controller
{
    public function __construct(
        private readonly ShopPurchaseService $purchaseService,
        private readonly WalletService $walletService,
        private readonly PromotionEngine $promotionEngine,
        private readonly ItemIconResolver $iconResolver,
    ) {}

    /**
     * Browse the shop — categories, featured items, all items.
     */
    public function index(): Response
    {
        $categories = ShopCategory::query()
            ->where('is_active', true)
            ->orderBy('sort_order')
            ->get();

        $items = ShopItem::query()
            ->where('is_active', true)
            ->with('category')
            ->orderByDesc('is_featured')
            ->orderBy('name')
            ->get()
            ->map(fn (ShopItem $item) => [
                ...$item->toArray(),
                'icon' => $this->iconResolver->resolve($item->item_type),
            ]);

        $bundles = ShopBundle::query()
            ->where('is_active', true)
            ->with('items')
            ->orderByDesc('is_featured')
            ->get()
            ->map(fn (ShopBundle $bundle) => [
                ...$bundle->toArray(),
                'items' => $bundle->items->map(fn ($item) => [
                    ...$item->toArray(),
                    'icon' => $this->iconResolver->resolve($item->item_type),
                ]),
            ]);

        $user = request()->user();
        $balance = $user ? $this->walletService->getBalance($user) : null;

        return Inertia::render('shop/index', [
            'categories' => $categories,
            'items' => $items,
            'bundles' => $bundles,
            'balance' => $balance,
        ]);
    }

    /**
     * Show a single shop item detail.
     */
    public function show(string $slug): Response
    {
        $item = ShopItem::query()
            ->where('slug', $slug)
            ->where('is_active', true)
            ->with('category')
            ->firstOrFail();

        $user = request()->user();
        $balance = $user ? $this->walletService->getBalance($user) : null;

        return Inertia::render('shop/item', [
            'item' => [
                ...$item->toArray(),
                'icon' => $this->iconResolver->resolve($item->item_type),
            ],
            'balance' => $balance,
        ]);
    }

    /**
     * Purchase a shop item.
     */
    public function purchaseItem(PurchaseItemRequest $request, string $slug): JsonResponse
    {
        $item = ShopItem::query()
            ->where('slug', $slug)
            ->where('is_active', true)
            ->firstOrFail();

        $validated = $request->validated();
        $quantity = $validated['quantity'] ?? 1;

        $promotion = null;
        if (! empty($validated['promotion_code'])) {
            $promotion = ShopPromotion::query()
                ->where('code', strtoupper($validated['promotion_code']))
                ->first();
        }

        try {
            $purchase = $this->purchaseService->purchaseItem(
                $request->user(),
                $item,
                $quantity,
                $promotion,
            );

            return response()->json([
                'message' => "Purchased {$quantity}x {$item->name}",
                'purchase_id' => $purchase->id,
                'balance' => $this->walletService->getBalance($request->user()),
            ]);
        } catch (InsufficientBalanceException $e) {
            return response()->json([
                'error' => 'Insufficient balance',
                'balance' => $e->balance,
                'required' => $e->required,
            ], 422);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }
    }

    /**
     * Show a bundle detail.
     */
    public function showBundle(string $slug): Response
    {
        $bundle = ShopBundle::query()
            ->where('slug', $slug)
            ->where('is_active', true)
            ->with('items')
            ->firstOrFail();

        $user = request()->user();
        $balance = $user ? $this->walletService->getBalance($user) : null;

        return Inertia::render('shop/item', [
            'bundle' => [
                ...$bundle->toArray(),
                'items' => $bundle->items->map(fn ($item) => [
                    ...$item->toArray(),
                    'icon' => $this->iconResolver->resolve($item->item_type),
                ]),
            ],
            'balance' => $balance,
        ]);
    }

    /**
     * Purchase a bundle.
     */
    public function purchaseBundle(PurchaseItemRequest $request, string $slug): JsonResponse
    {
        $bundle = ShopBundle::query()
            ->where('slug', $slug)
            ->where('is_active', true)
            ->firstOrFail();

        $validated = $request->validated();

        $promotion = null;
        if (! empty($validated['promotion_code'])) {
            $promotion = ShopPromotion::query()
                ->where('code', strtoupper($validated['promotion_code']))
                ->first();
        }

        try {
            $purchase = $this->purchaseService->purchaseBundle(
                $request->user(),
                $bundle,
                $promotion,
            );

            return response()->json([
                'message' => "Purchased bundle: {$bundle->name}",
                'purchase_id' => $purchase->id,
                'balance' => $this->walletService->getBalance($request->user()),
            ]);
        } catch (InsufficientBalanceException $e) {
            return response()->json([
                'error' => 'Insufficient balance',
                'balance' => $e->balance,
                'required' => $e->required,
            ], 422);
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }
    }

    /**
     * Show player's purchase history.
     */
    public function myPurchases(): Response
    {
        $purchases = request()->user()->shopPurchases()
            ->with(['deliveries', 'purchasable'])
            ->orderByDesc('created_at')
            ->paginate(20);

        return Inertia::render('shop/my-purchases', [
            'purchases' => $purchases,
            'balance' => $this->walletService->getBalance(request()->user()),
        ]);
    }

    /**
     * Show player's wallet and transaction history.
     */
    public function myWallet(): Response
    {
        $user = request()->user();
        $balance = $this->walletService->getBalance($user);
        $transactions = $this->walletService->getTransactionHistory($user, 30);

        return Inertia::render('shop/my-wallet', [
            'balance' => $balance,
            'transactions' => $transactions,
        ]);
    }
}
