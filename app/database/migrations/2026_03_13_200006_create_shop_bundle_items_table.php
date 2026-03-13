<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('shop_bundle_items', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignUuid('bundle_id')->constrained('shop_bundles')->cascadeOnDelete();
            $table->foreignUuid('shop_item_id')->constrained('shop_items')->cascadeOnDelete();
            $table->integer('quantity')->default(1);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('shop_bundle_items');
    }
};
