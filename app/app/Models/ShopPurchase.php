<?php

namespace App\Models;

use App\Enums\DeliveryStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\MorphTo;

class ShopPurchase extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'user_id',
        'wallet_transaction_id',
        'purchasable_type',
        'purchasable_id',
        'quantity_bought',
        'total_price',
        'discount_amount',
        'promotion_id',
        'delivery_status',
        'delivered_at',
        'metadata',
    ];

    protected function casts(): array
    {
        return [
            'total_price' => 'decimal:2',
            'discount_amount' => 'decimal:2',
            'delivery_status' => DeliveryStatus::class,
            'delivered_at' => 'datetime',
            'metadata' => 'array',
        ];
    }

    /**
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * @return BelongsTo<WalletTransaction, $this>
     */
    public function walletTransaction(): BelongsTo
    {
        return $this->belongsTo(WalletTransaction::class);
    }

    /**
     * @return MorphTo<Model, $this>
     */
    public function purchasable(): MorphTo
    {
        return $this->morphTo();
    }

    /**
     * @return BelongsTo<ShopPromotion, $this>
     */
    public function promotion(): BelongsTo
    {
        return $this->belongsTo(ShopPromotion::class, 'promotion_id');
    }

    /**
     * @return HasMany<ShopDelivery, $this>
     */
    public function deliveries(): HasMany
    {
        return $this->hasMany(ShopDelivery::class);
    }
}
