<?php

namespace App\Services;

use App\Models\AuditLog;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class DiscordWebhookService
{
    /**
     * Maps audit actions to Discord embed configuration.
     *
     * @var array<string, array{color: int, emoji: string, title: string}>
     */
    private const ACTION_CONFIG = [
        // Server — green for start, red for stop, orange for scheduled, blue for restart
        'server.start' => ['color' => 0x2ECC71, 'emoji' => "\u{2705}", 'title' => 'Server Started'],
        'server.stop' => ['color' => 0xE74C3C, 'emoji' => "\u{1F6D1}", 'title' => 'Server Stopped'],
        'server.stop.scheduled' => ['color' => 0xE67E22, 'emoji' => "\u{23F3}", 'title' => 'Server Stop Scheduled'],
        'server.stop.executed' => ['color' => 0xE74C3C, 'emoji' => "\u{1F6D1}", 'title' => 'Server Stop Executed'],
        'server.restart' => ['color' => 0x3498DB, 'emoji' => "\u{1F504}", 'title' => 'Server Restarting'],
        'server.restart.scheduled' => ['color' => 0xE67E22, 'emoji' => "\u{23F3}", 'title' => 'Server Restart Scheduled'],
        'server.restart.executed' => ['color' => 0x3498DB, 'emoji' => "\u{1F504}", 'title' => 'Server Restarting'],
        'server.start.completed' => ['color' => 0x2ECC71, 'emoji' => "\u{2705}", 'title' => 'Server Ready'],
        'server.restart.completed' => ['color' => 0x2ECC71, 'emoji' => "\u{2705}", 'title' => 'Server Ready'],
        'server.save' => ['color' => 0x2ECC71, 'emoji' => "\u{1F4BE}", 'title' => 'World Saved'],
        'server.wipe' => ['color' => 0xE74C3C, 'emoji' => "\u{1F4A3}", 'title' => 'Server Wiped'],
        'server.wipe.scheduled' => ['color' => 0xE67E22, 'emoji' => "\u{23F3}", 'title' => 'Server Wipe Scheduled'],
        'server.wipe.executed' => ['color' => 0xE74C3C, 'emoji' => "\u{1F4A3}", 'title' => 'Server Wipe Started'],
        'server.wipe.completed' => ['color' => 0x2ECC71, 'emoji' => "\u{2705}", 'title' => 'Server Online (Post-Wipe)'],
        'server.autorestart.upcoming' => ['color' => 0x3498DB, 'emoji' => "\u{1F514}", 'title' => 'Upcoming Restart'],
        'server.autorestart.scheduled' => ['color' => 0xE67E22, 'emoji' => "\u{23F0}", 'title' => 'Auto-Restart Scheduled'],

        // Update
        'server.update' => ['color' => 0x3498DB, 'emoji' => "\u{2B06}", 'title' => 'Server Updating'],
        'server.update.scheduled' => ['color' => 0xE67E22, 'emoji' => "\u{23F3}", 'title' => 'Server Update Scheduled'],
        'server.update.executed' => ['color' => 0x3498DB, 'emoji' => "\u{2B06}", 'title' => 'Server Update Started'],
        'server.update.completed' => ['color' => 0x2ECC71, 'emoji' => "\u{2705}", 'title' => 'Server Online (Post-Update)'],
        'server.branch.changed' => ['color' => 0x9B59B6, 'emoji' => "\u{1F500}", 'title' => 'Steam Branch Changed'],

        // Backup
        'backup.create' => ['color' => 0x2ECC71, 'emoji' => "\u{1F4E6}", 'title' => 'Backup Started'],
        'backup.created' => ['color' => 0x2ECC71, 'emoji' => "\u{2705}", 'title' => 'Backup Completed'],
        'backup.rollback.initiated' => ['color' => 0x9B59B6, 'emoji' => "\u{23EA}", 'title' => 'Rollback Initiated'],
        'backup.rollback.scheduled' => ['color' => 0xE67E22, 'emoji' => "\u{23F3}", 'title' => 'Rollback Scheduled'],
        'backup.rollback.executed' => ['color' => 0x9B59B6, 'emoji' => "\u{23EA}", 'title' => 'Rollback Completed'],
        'backup.delete' => ['color' => 0xE74C3C, 'emoji' => "\u{1F5D1}", 'title' => 'Backup Deleted'],

        // Player
        'player.kick' => ['color' => 0xE67E22, 'emoji' => "\u{1F462}", 'title' => 'Player Kicked'],
        'player.ban' => ['color' => 0xE74C3C, 'emoji' => "\u{1F6AB}", 'title' => 'Player Banned'],

        // Respawn Delay
        'respawn_delay.update' => ['color' => 0x9B59B6, 'emoji' => "\u{23F1}", 'title' => 'Respawn Delay Updated'],
        'respawn_delay.reset' => ['color' => 0x3498DB, 'emoji' => "\u{1F504}", 'title' => 'Respawn Timer Reset'],

        // Safe Zones
        'safezone.config.update' => ['color' => 0x9B59B6, 'emoji' => "\u{1F6E1}", 'title' => 'Safe Zone Config Updated'],
        'safezone.zone.create' => ['color' => 0x2ECC71, 'emoji' => "\u{1F6E1}", 'title' => 'Safe Zone Created'],
        'safezone.zone.delete' => ['color' => 0xE74C3C, 'emoji' => "\u{1F6E1}", 'title' => 'Safe Zone Deleted'],
        'safezone.violation.detected' => ['color' => 0xE74C3C, 'emoji' => "\u{26A0}", 'title' => 'PvP Violation Detected'],
        'safezone.violation.dismissed' => ['color' => 0x95A5A6, 'emoji' => "\u{2705}", 'title' => 'PvP Violation Dismissed'],
        'safezone.violation.actioned' => ['color' => 0xE74C3C, 'emoji' => "\u{1F6AB}", 'title' => 'PvP Violation Actioned'],

        // Shop
        'shop.currency.awarded' => ['color' => 0xF1C40F, 'emoji' => "\u{1FA99}", 'title' => 'Currency Awarded'],
        'shop.item.create' => ['color' => 0x2ECC71, 'emoji' => "\u{1F6D2}", 'title' => 'Shop Item Created'],
        'shop.item.update' => ['color' => 0x3498DB, 'emoji' => "\u{1F6D2}", 'title' => 'Shop Item Updated'],
        'shop.item.delete' => ['color' => 0xE74C3C, 'emoji' => "\u{1F6D2}", 'title' => 'Shop Item Deleted'],
        'shop.bundle.create' => ['color' => 0x2ECC71, 'emoji' => "\u{1F4E6}", 'title' => 'Shop Bundle Created'],
        'shop.bundle.delete' => ['color' => 0xE74C3C, 'emoji' => "\u{1F4E6}", 'title' => 'Shop Bundle Deleted'],
        'shop.promotion.create' => ['color' => 0x2ECC71, 'emoji' => "\u{1F3F7}", 'title' => 'Promotion Created'],
        'shop.promotion.delete' => ['color' => 0xE74C3C, 'emoji' => "\u{1F3F7}", 'title' => 'Promotion Deleted'],
    ];

    /**
     * Send a notification for an audit log entry.
     */
    public function sendNotification(string $webhookUrl, AuditLog $auditLog): void
    {
        $config = self::ACTION_CONFIG[$auditLog->action] ?? null;

        if (! $config) {
            return;
        }

        $embed = [
            'title' => "{$config['emoji']} {$config['title']}",
            'color' => $config['color'],
            'fields' => $this->buildFields($auditLog),
            'footer' => [
                'text' => config('app.name', 'PZ Server'),
            ],
            'timestamp' => ($auditLog->created_at ?? now())->toIso8601String(),
        ];

        $this->send($webhookUrl, ['embeds' => [$embed]]);
    }

    /**
     * Send a test message to verify the webhook URL works.
     *
     * @return array{success: bool, error?: string}
     */
    public function sendTestMessage(string $webhookUrl): array
    {
        $embed = [
            'title' => "\u{1F916} Webhook Test",
            'description' => 'Discord webhook integration is working correctly!',
            'color' => 0x2ECC71,
            'footer' => [
                'text' => config('app.name', 'PZ Server'),
            ],
            'timestamp' => now()->toIso8601String(),
        ];

        return $this->send($webhookUrl, ['embeds' => [$embed]]);
    }

    /**
     * Build embed fields from audit log details.
     *
     * @return array<int, array{name: string, value: string, inline: bool}>
     */
    private function buildFields(AuditLog $auditLog): array
    {
        $fields = [];

        $fields[] = [
            'name' => 'Action By',
            'value' => $auditLog->actor ?? 'system',
            'inline' => true,
        ];

        if ($auditLog->target) {
            $fields[] = [
                'name' => 'Target',
                'value' => $auditLog->target,
                'inline' => true,
            ];
        }

        $details = $auditLog->details ?? [];

        if (isset($details['countdown'])) {
            $fields[] = [
                'name' => 'Countdown',
                'value' => "{$details['countdown']} seconds",
                'inline' => true,
            ];
        }

        if (isset($details['reason'])) {
            $fields[] = [
                'name' => 'Reason',
                'value' => $details['reason'],
                'inline' => false,
            ];
        }

        if (isset($details['message'])) {
            $fields[] = [
                'name' => 'Message',
                'value' => $details['message'],
                'inline' => false,
            ];
        }

        if (isset($details['size_bytes'])) {
            $fields[] = [
                'name' => 'Size',
                'value' => $this->humanFileSize((int) $details['size_bytes']),
                'inline' => true,
            ];
        }

        return $fields;
    }

    /**
     * Send a payload to the Discord webhook URL.
     *
     * @param  array<string, mixed>  $payload
     * @return array{success: bool, error?: string}
     */
    private function send(string $url, array $payload): array
    {
        try {
            $response = Http::timeout(10)
                ->retry(2, 1000)
                ->post($url, $payload);

            if ($response->successful() || $response->status() === 204) {
                return ['success' => true];
            }

            $error = "Discord returned HTTP {$response->status()}";
            Log::warning('Discord webhook failed', [
                'status' => $response->status(),
                'body' => $response->body(),
            ]);

            return ['success' => false, 'error' => $error];
        } catch (\Throwable $e) {
            Log::warning('Discord webhook error', [
                'error' => $e->getMessage(),
            ]);

            return ['success' => false, 'error' => $e->getMessage()];
        }
    }

    private function humanFileSize(int $bytes): string
    {
        if ($bytes === 0) {
            return '0 B';
        }

        $units = ['B', 'KB', 'MB', 'GB'];
        $i = (int) floor(log($bytes, 1024));

        return round($bytes / (1024 ** $i), 1).' '.$units[$i];
    }
}
