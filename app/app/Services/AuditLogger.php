<?php

namespace App\Services;

use App\Models\AuditLog;

class AuditLogger
{
    /**
     * Log an audit event.
     *
     * @param  array<string, mixed>|null  $details
     */
    public function log(
        string $actor,
        string $action,
        ?string $target = null,
        ?array $details = null,
        ?string $ip = null,
    ): AuditLog {
        return AuditLog::create([
            'actor' => $actor,
            'action' => $action,
            'target' => $target,
            'details' => $details,
            'ip_address' => $ip,
        ]);
    }

    /**
     * Static convenience method.
     *
     * @param  array<string, mixed>|null  $details
     */
    public static function record(
        string $actor,
        string $action,
        ?string $target = null,
        ?array $details = null,
        ?string $ip = null,
    ): AuditLog {
        return app(static::class)->log($actor, $action, $target, $details, $ip);
    }
}
