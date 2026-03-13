<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\MorphMany;

class ShopBundle extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'name',
        'slug',
        'description',
        'price',
        'is_active',
        'is_featured',
        'max_per_player',
        'metadata',
    ];

    protected function casts(): array
    {
        return [
            'price' => 'decimal:2',
            'is_active' => 'boolean',
            'is_featured' => 'boolean',
            'metadata' => 'array',
        ];
    }

    /**
     * @return BelongsToMany<ShopItem, $this>
     */
    public function items(): BelongsToMany
    {
        return $this->belongsToMany(ShopItem::class, 'shop_bundle_items', 'bundle_id', 'shop_item_id')
            ->withPivot('quantity');
    }

    /**
     * @return MorphMany<ShopPurchase, $this>
     */
    public function purchases(): MorphMany
    {
        return $this->morphMany(ShopPurchase::class, 'purchasable');
    }
}
