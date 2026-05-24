<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('map_render_settings', function (Blueprint $table): void {
            $table->unsignedSmallInteger('atlas_lod_count')->default(1)->after('atlas_page_count');
            $table->boolean('atlas_has_ktx2')->default(false)->after('atlas_lod_count');
            $table->string('atlas_compression_format', 16)->nullable()->after('atlas_has_ktx2');
            $table->timestamp('cell_pages_built_at')->nullable()->after('atlas_compression_format');
        });
    }

    public function down(): void
    {
        Schema::table('map_render_settings', function (Blueprint $table): void {
            $table->dropColumn([
                'atlas_lod_count',
                'atlas_has_ktx2',
                'atlas_compression_format',
                'cell_pages_built_at',
            ]);
        });
    }
};
