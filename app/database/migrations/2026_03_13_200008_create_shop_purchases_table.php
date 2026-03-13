<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shop_purchases', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignUuid('wallet_transaction_id')->constrained('wallet_transactions')->restrictOnDelete();
            $table->string('purchasable_type');
            $table->uuid('purchasable_id');
            $table->integer('quantity_bought')->default(1);
            $table->decimal('total_price', 12, 2);
            $table->decimal('discount_amount', 12, 2)->default(0);
            $table->foreignUuid('promotion_id')->nullable()->constrained('shop_promotions')->nullOnDelete();
            $table->string('delivery_status');
            $table->timestamp('delivered_at')->nullable();
            $table->jsonb('metadata')->nullable();
            $table->timestamps();

            $table->index(['purchasable_type', 'purchasable_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shop_purchases');
    }
};
