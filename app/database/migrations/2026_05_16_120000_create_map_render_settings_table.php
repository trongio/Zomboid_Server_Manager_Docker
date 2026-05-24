<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('map_render_settings', function (Blueprint $table) {
            $table->id();
            $table->boolean('engine_enabled')->default(false);
            $table->string('schedule_preset', 32)->default('off');
            $table->string('cron_expression', 100)->nullable();
            $table->timestamp('last_run_at')->nullable();
            $table->string('last_run_status', 32)->nullable();
            $table->integer('last_run_duration_seconds')->nullable();
            $table->text('last_run_error')->nullable();
            $table->timestamp('base_rendered_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('map_render_settings');
    }
};
