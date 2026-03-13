<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shop_deliveries', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('shop_purchase_id')->constrained('shop_purchases')->cascadeOnDelete();
            $table->string('username');
            $table->string('item_type');
            $table->integer('quantity');
            $table->string('delivery_queue_id')->nullable();
            $table->string('status');
            $table->integer('attempts')->default(0);
            $table->timestamp('last_attempt_at')->nullable();
            $table->timestamp('delivered_at')->nullable();
            $table->string('error_message')->nullable();
            $table->timestamps();

            $table->index('delivery_queue_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shop_deliveries');
    }
};
