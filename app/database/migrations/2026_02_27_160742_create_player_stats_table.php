<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('player_stats', function (Blueprint $table) {
            $table->string('username')->primary();
            $table->unsignedInteger('zombie_kills')->default(0);
            $table->float('hours_survived')->default(0);
            $table->string('profession')->nullable();
            $table->json('skills')->nullable();
            $table->boolean('is_dead')->default(false);
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('player_stats');
    }
};
