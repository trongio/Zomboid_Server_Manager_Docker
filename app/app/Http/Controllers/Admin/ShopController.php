<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\StoreShopCategoryRequest;
use App\Http\Requests\Admin\StoreShopItemRequest;
use App\Http\Requests\Admin\UpdateShopCategoryRequest;
use App\Http\Requests\Admin\UpdateShopItemRequest;
use App\Models\ShopCategory;
use App\Models\ShopItem;
use App\Services\AuditLogger;
use App\Services\ItemCatalogReader;
use App\Services\ItemIconResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;

class ShopController extends Controller
{
    public function __construct(
        private readonly AuditLogger $auditLogger,
        private readonly ItemCatalogReader $catalogReader,
        private readonly ItemIconResolver $iconResolver,
    ) {}

    /**
     * Display shop management page with items and categories.
     */
    public function index(): Response
    {
        $categories = ShopCategory::query()
            ->orderBy('sort_order')
            ->withCount('items')
            ->get();

        $items = ShopItem::query()
            ->with('category')
            ->orderByDesc('created_at')
            ->get()
            ->map(fn (ShopItem $item) => [
                ...$item->toArray(),
                'icon' => $this->iconResolver->resolve($item->item_type),
            ]);

        $catalog = array_map(fn (array $entry) => [
            ...$entry,
            'icon' => $this->iconResolver->resolve($entry['full_type']),
        ], $this->catalogReader->getAll());

        return Inertia::render('admin/shop', [
            'categories' => $categories,
            'items' => $items,
            'catalog' => $catalog,
        ]);
    }

    /**
     * Create a new shop category.
     */
    public function storeCategory(StoreShopCategoryRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $validated['slug'] = Str::slug($validated['name']);

        $category = ShopCategory::query()->create($validated);

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'shop.category.create',
            target: $category->name,
            details: ['category_id' => $category->id],
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Category created', 'category' => $category], 201);
    }

    /**
     * Update a shop category.
     */
    public function updateCategory(UpdateShopCategoryRequest $request, ShopCategory $category): JsonResponse
    {
        $validated = $request->validated();
        $validated['slug'] = Str::slug($validated['name']);

        $category->update($validated);

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'shop.category.update',
            target: $category->name,
            details: ['category_id' => $category->id],
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Category updated', 'category' => $category]);
    }

    /**
     * Delete a shop category.
     */
    public function destroyCategory(ShopCategory $category): JsonResponse
    {
        $name = $category->name;
        $category->delete();

        $this->auditLogger->log(
            actor: request()->user()->name ?? 'admin',
            action: 'shop.category.delete',
            target: $name,
            ip: request()->ip(),
        );

        return response()->json(['message' => 'Category deleted']);
    }

    /**
     * Create a new shop item.
     */
    public function storeItem(StoreShopItemRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $validated['slug'] = Str::slug($validated['name']).'-'.Str::random(6);

        $item = ShopItem::query()->create($validated);

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'shop.item.create',
            target: $item->name,
            details: [
                'item_id' => $item->id,
                'item_type' => $item->item_type,
                'price' => (float) $item->price,
            ],
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Item created', 'item' => $item], 201);
    }

    /**
     * Update a shop item.
     */
    public function updateItem(UpdateShopItemRequest $request, ShopItem $item): JsonResponse
    {
        $validated = $request->validated();

        if ($validated['name'] !== $item->name) {
            $validated['slug'] = Str::slug($validated['name']).'-'.Str::random(6);
        }

        $item->update($validated);

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'shop.item.update',
            target: $item->name,
            details: ['item_id' => $item->id],
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Item updated', 'item' => $item]);
    }

    /**
     * Delete a shop item.
     */
    public function destroyItem(ShopItem $item): JsonResponse
    {
        $name = $item->name;
        $item->delete();

        $this->auditLogger->log(
            actor: request()->user()->name ?? 'admin',
            action: 'shop.item.delete',
            target: $name,
            ip: request()->ip(),
        );

        return response()->json(['message' => 'Item deleted']);
    }

    /**
     * Toggle an item's active status.
     */
    public function toggleItem(ShopItem $item): JsonResponse
    {
        $item->update(['is_active' => ! $item->is_active]);

        $this->auditLogger->log(
            actor: request()->user()->name ?? 'admin',
            action: $item->is_active ? 'shop.item.activate' : 'shop.item.deactivate',
            target: $item->name,
            ip: request()->ip(),
        );

        return response()->json(['message' => $item->is_active ? 'Item activated' : 'Item deactivated']);
    }
}
