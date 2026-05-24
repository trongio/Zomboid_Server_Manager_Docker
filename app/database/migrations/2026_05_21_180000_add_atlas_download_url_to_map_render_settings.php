<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Колонка с URL для скачивания prebuilt atlas tarball. Если задана —
 * имеет приоритет над config('zomboid.map.atlas_download_url') / env.
 * Позволяет администратору поменять источник через UI без правки .env.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('map_render_settings', function (Blueprint $table) {
            $table->string('atlas_download_url', 500)->nullable()->after('atlas_page_count');
        });
    }

    public function down(): void
    {
        Schema::table('map_render_settings', function (Blueprint $table) {
            $table->dropColumn('atlas_download_url');
        });
    }
};
