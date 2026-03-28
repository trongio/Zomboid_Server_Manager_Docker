<?php

namespace App\Observers;

use App\Jobs\SendDiscordWebhookNotification;
use App\Models\AuditLog;
use App\Models\DiscordWebhookSetting;

class AuditLogObserver
{
    /**
     * Prevent audit log deletion to preserve the compliance trail.
     */
    public function deleting(AuditLog $auditLog): never
    {
        throw new \RuntimeException('Audit logs cannot be deleted.');
    }

    public function created(AuditLog $auditLog): void
    {
        $settings = DiscordWebhookSetting::instance();

        if (! $settings->shouldNotify($auditLog->action)) {
            return;
        }

        SendDiscordWebhookNotification::dispatch(
            $settings->webhook_url,
            $auditLog->id,
        );
    }
}
