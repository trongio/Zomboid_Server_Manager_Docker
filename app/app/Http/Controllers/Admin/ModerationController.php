<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\ModerationFilterRequest;
use App\Http\Resources\GameEventResource;
use App\Models\GameEvent;
use App\Services\MapConfigBuilder;
use Inertia\Inertia;
use Inertia\Response;

class ModerationController extends Controller
{
    public function __construct(
        private readonly MapConfigBuilder $mapConfigBuilder,
    ) {}

    public function index(ModerationFilterRequest $request): Response
    {
        $mapConfig = $this->mapConfigBuilder->build();

        $filters = [
            'event_types' => $request->validated('event_types', 'pvp_kill,death'),
            'player' => $request->validated('player'),
            'from' => $request->validated('from'),
            'to' => $request->validated('to'),
        ];

        return Inertia::render('admin/moderation', [
            'mapConfig' => $mapConfig,
            'hasTiles' => $mapConfig['tileUrl'] !== null,
            'filters' => $filters,
            'events' => Inertia::defer(function () use ($filters) {
                $query = GameEvent::query();

                // Filter by event types
                if (! empty($filters['event_types'])) {
                    $types = array_filter(explode(',', $filters['event_types']));
                    if (! empty($types)) {
                        $query->whereIn('event_type', $types);
                    }
                }

                // Filter by player name (search both player and target)
                if (! empty($filters['player'])) {
                    $search = $filters['player'];
                    $query->where(function ($q) use ($search) {
                        $q->where('player', 'ilike', "%{$search}%")
                            ->orWhere('target', 'ilike', "%{$search}%");
                    });
                }

                // Filter by date range
                if (! empty($filters['from'])) {
                    $query->where('created_at', '>=', $filters['from']);
                }

                if (! empty($filters['to'])) {
                    $query->where('created_at', '<=', $filters['to'].' 23:59:59');
                }

                $paginated = $query->orderByDesc('created_at')->paginate(25);

                return GameEventResource::collection($paginated);
            }),
        ]);
    }
}
