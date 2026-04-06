<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        DB::table('translations')->whereNull('group')->update(['group' => '']);
        DB::statement("ALTER TABLE translations ALTER COLUMN \"group\" SET DEFAULT ''");
        DB::statement('ALTER TABLE translations ALTER COLUMN "group" SET NOT NULL');
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        DB::statement('ALTER TABLE translations ALTER COLUMN "group" DROP NOT NULL');
    }
};
