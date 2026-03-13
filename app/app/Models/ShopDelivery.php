<?php

namespace App\Models;

use App\Enums\DeliveryStatus;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ShopDelivery extends Model
{
    use HasFactory, HasUuids;

    protected $fillable = [
        'shop_purchase_id',
        'username',
        'item_type',
        'quantity',
        'delivery_queue_id',
        'status',
        'attempts',
        'last_attempt_at',
        'delivered_at',
        'error_message',
    ];

    protected function casts(): array
    {
        return [
            'status' => DeliveryStatus::class,
            'last_attempt_at' => 'datetime',
            'delivered_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<ShopPurchase, $this>
     */
    public function purchase(): BelongsTo
    {
        return $this->belongsTo(ShopPurchase::class, 'shop_purchase_id');
    }
}
