<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // Convert NULL group values to empty string, then make column non-nullable
        DB::table('translations')->whereNull('group')->update(['group' => '']);

        Schema::table('translations', function (Blueprint $table) {
            $table->string('group')->default('')->nullable(false)->change();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('translations', function (Blueprint $table) {
            $table->string('group')->nullable()->change();
        });
    }
};
