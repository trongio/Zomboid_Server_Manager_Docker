<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\GameEvent */
class GameEventResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'event_type' => $this->event_type,
            'player' => $this->player,
            'target' => $this->target,
            'details' => $this->details,
            'x' => $this->x,
            'y' => $this->y,
            'game_time' => $this->game_time?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
