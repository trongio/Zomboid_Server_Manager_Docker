<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class AuditController extends Controller
{
    public function index(Request $request): Response
    {
        $query = AuditLog::query()->latest('created_at');

        $query->when($request->query('action'), fn ($q, $action) => $q->where('action', $action));
        $query->when($request->query('actor'), fn ($q, $actor) => $q->where('actor', $actor));
        $query->when($request->query('from'), fn ($q, $from) => $q->where('created_at', '>=', $from));
        $query->when($request->query('to'), fn ($q, $to) => $q->where('created_at', '<=', $to));

        $logs = $query->paginate(20);

        $actions = AuditLog::query()
            ->select('action')
            ->distinct()
            ->orderBy('action')
            ->pluck('action')
            ->all();

        return Inertia::render('admin/audit', [
            'logs' => $logs,
            'filters' => [
                'action' => $request->query('action', ''),
                'actor' => $request->query('actor', ''),
                'from' => $request->query('from', ''),
                'to' => $request->query('to', ''),
            ],
            'available_actions' => $actions,
        ]);
    }
}
