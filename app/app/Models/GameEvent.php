<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class GameEvent extends Model
{
    use HasFactory;

    protected $fillable = [
        'event_type',
        'player',
        'target',
        'details',
        'x',
        'y',
        'game_time',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'details' => 'array',
            'game_time' => 'datetime',
        ];
    }
}
