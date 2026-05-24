<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * M8 partial: track when the WebGL atlas was last built and which version is live.
 *
 * Doesn't drop the legacy batch-render fields (quality_preset, base_rendered_at,
 * last_run_*, schedule_*) because the batch renderer is still the canonical
 * fallback while the WebGL pipeline matures.  A second migration will remove
 * them once browser-side rendering is the only path used in production.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('map_render_settings', function (Blueprint $table) {
            $table->timestamp('atlas_built_at')->nullable()->after('base_rendered_at');
            $table->string('atlas_version', 64)->nullable()->after('atlas_built_at');
            $table->unsignedBigInteger('atlas_size_bytes')->default(0)->after('atlas_version');
            $table->unsignedInteger('atlas_sprite_count')->default(0)->after('atlas_size_bytes');
            $table->unsignedSmallInteger('atlas_page_count')->default(0)->after('atlas_sprite_count');
        });
    }

    public function down(): void
    {
        Schema::table('map_render_settings', function (Blueprint $table) {
            $table->dropColumn([
                'atlas_built_at',
                'atlas_version',
                'atlas_size_bytes',
                'atlas_sprite_count',
                'atlas_page_count',
            ]);
        });
    }
};
