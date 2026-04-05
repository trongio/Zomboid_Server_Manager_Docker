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
        Schema::create('site_settings', function (Blueprint $table) {
            $table->id();
            $table->string('site_name')->default('Zomboid Manager');
            $table->string('logo_path')->nullable();
            $table->string('favicon_path')->nullable();
            $table->string('footer_text')->default('Powered by Zomboid Manager');
            $table->string('hero_badge')->default('Georgian Gaming Community');
            $table->string('hero_title')->default('Project Zomboid');
            $table->string('hero_subtitle')->default('Dedicated Server');
            $table->text('hero_description')->default('A fully managed PZ server with web-based administration. Mod management, automated backups, player controls, and RCON console — all from your browser.');
            $table->string('hero_button_text')->default('Join Server');
            $table->jsonb('features')->default('[]');
            $table->jsonb('landing_sections')->default('[]');
            $table->jsonb('theme_colors')->nullable();
            $table->string('default_locale')->default('en');
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('site_settings');
    }
};
