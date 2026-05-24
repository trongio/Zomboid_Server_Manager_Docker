<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('map_render_settings', function (Blueprint $table) {
            $table->string('quality_preset', 32)->default('balanced')->after('engine_enabled');
            $table->unsignedSmallInteger('custom_tile_size')->nullable()->after('quality_preset');
            $table->unsignedTinyInteger('custom_omit_levels')->nullable()->after('custom_tile_size');
        });
    }

    public function down(): void
    {
        Schema::table('map_render_settings', function (Blueprint $table) {
            $table->dropColumn(['quality_preset', 'custom_tile_size', 'custom_omit_levels']);
        });
    }
};
