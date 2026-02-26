<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('username')->after('id')->default('');
        });

        // Copy existing name values into username for any existing users
        DB::table('users')->update([
            'username' => DB::raw('name'),
        ]);

        // Now add the unique index
        Schema::table('users', function (Blueprint $table) {
            $table->string('username')->unique()->change();
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['username']);
            $table->dropColumn('username');
        });
    }
};
