<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\Api\ListAuditLogsRequest;
use App\Http\Resources\AuditLogResource;
use App\Models\AuditLog;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class AuditLogController
{
    public function index(ListAuditLogsRequest $request): AnonymousResourceCollection
    {
        $query = AuditLog::query()->latest('created_at');

        $query->when($request->validated('action'), fn ($q, $action) => $q->where('action', $action));

        $query->when($request->validated('actor'), fn ($q, $actor) => $q->where('actor', $actor));

        $query->when($request->validated('from'), fn ($q, $from) => $q->where('created_at', '>=', $from));

        $query->when($request->validated('to'), fn ($q, $to) => $q->where('created_at', '<=', $to));

        $perPage = $request->validated('per_page', 15);

        return AuditLogResource::collection($query->paginate($perPage));
    }
}
