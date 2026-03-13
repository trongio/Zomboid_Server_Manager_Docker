<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\StoreShopBundleRequest;
use App\Http\Requests\Admin\UpdateShopBundleRequest;
use App\Models\ShopBundle;
use App\Services\AuditLogger;
use App\Services\ItemIconResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;

class ShopBundleController extends Controller
{
    public function __construct(
        private readonly AuditLogger $auditLogger,
        private readonly ItemIconResolver $iconResolver,
    ) {}

    /**
     * Display bundle management page.
     */
    public function index(): Response
    {
        $bundles = ShopBundle::query()
            ->with('items')
            ->orderByDesc('created_at')
            ->get()
            ->map(fn (ShopBundle $bundle) => [
                ...$bundle->toArray(),
                'items' => $bundle->items->map(fn ($item) => [
                    ...$item->toArray(),
                    'icon' => $this->iconResolver->resolve($item->item_type),
                ]),
            ]);

        $shopItems = \App\Models\ShopItem::query()
            ->where('is_active', true)
            ->orderBy('name')
            ->get()
            ->map(fn ($item) => [
                ...$item->toArray(),
                'icon' => $this->iconResolver->resolve($item->item_type),
            ]);

        return Inertia::render('admin/shop-bundles', [
            'bundles' => $bundles,
            'shopItems' => $shopItems,
        ]);
    }

    /**
     * Create a new bundle.
     */
    public function store(StoreShopBundleRequest $request): JsonResponse
    {
        $validated = $request->validated();

        $bundle = ShopBundle::query()->create([
            'name' => $validated['name'],
            'slug' => Str::slug($validated['name']).'-'.Str::random(6),
            'description' => $validated['description'] ?? null,
            'price' => $validated['price'],
            'is_featured' => $validated['is_featured'] ?? false,
            'max_per_player' => $validated['max_per_player'] ?? null,
        ]);

        foreach ($validated['items'] as $item) {
            $bundle->items()->attach($item['shop_item_id'], ['id' => Str::uuid(), 'quantity' => $item['quantity']]);
        }

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'shop.bundle.create',
            target: $bundle->name,
            details: ['bundle_id' => $bundle->id, 'item_count' => count($validated['items'])],
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Bundle created', 'bundle' => $bundle->load('items')], 201);
    }

    /**
     * Update a bundle.
     */
    public function update(UpdateShopBundleRequest $request, ShopBundle $bundle): JsonResponse
    {
        $validated = $request->validated();

        $bundle->update([
            'name' => $validated['name'],
            'description' => $validated['description'] ?? null,
            'price' => $validated['price'],
            'is_featured' => $validated['is_featured'] ?? false,
            'max_per_player' => $validated['max_per_player'] ?? null,
            'is_active' => $validated['is_active'] ?? $bundle->is_active,
        ]);

        // Sync bundle items
        $syncData = [];
        foreach ($validated['items'] as $item) {
            $syncData[$item['shop_item_id']] = ['id' => Str::uuid(), 'quantity' => $item['quantity']];
        }
        $bundle->items()->sync($syncData);

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'shop.bundle.update',
            target: $bundle->name,
            details: ['bundle_id' => $bundle->id],
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Bundle updated', 'bundle' => $bundle->load('items')]);
    }

    /**
     * Delete a bundle.
     */
    public function destroy(ShopBundle $bundle): JsonResponse
    {
        $name = $bundle->name;
        $bundle->delete();

        $this->auditLogger->log(
            actor: request()->user()->name ?? 'admin',
            action: 'shop.bundle.delete',
            target: $name,
            ip: request()->ip(),
        );

        return response()->json(['message' => 'Bundle deleted']);
    }
}
