<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class DiscordWebhookSetting extends Model
{
    use HasFactory;

    protected $fillable = [
        'webhook_url',
        'enabled',
        'enabled_events',
    ];

    protected function casts(): array
    {
        return [
            'webhook_url' => 'encrypted',
            'enabled' => 'boolean',
            'enabled_events' => 'array',
        ];
    }

    /**
     * Get the singleton settings instance, creating one if none exists.
     */
    public static function instance(): static
    {
        return static::query()->firstOrCreate([], [
            'enabled' => false,
            'enabled_events' => [],
        ]);
    }

    /**
     * Check if a notification should be sent for the given action.
     */
    public function shouldNotify(string $action): bool
    {
        return $this->enabled
            && $this->webhook_url
            && in_array($action, $this->enabled_events ?? [])
            && array_key_exists($action, static::availableEvents());
    }

    /**
     * Get all available events with labels and default enabled state.
     *
     * @return array<string, array{label: string, default: bool, group: string}>
     */
    public static function availableEvents(): array
    {
        return [
            // Server
            'server.start' => ['label' => 'Server Started', 'default' => true, 'group' => 'Server'],
            'server.stop' => ['label' => 'Server Stopped', 'default' => true, 'group' => 'Server'],
            'server.stop.scheduled' => ['label' => 'Server Stop Scheduled', 'default' => true, 'group' => 'Server'],
            'server.stop.executed' => ['label' => 'Server Stop Executed', 'default' => true, 'group' => 'Server'],
            'server.restart' => ['label' => 'Server Restarting', 'default' => true, 'group' => 'Server'],
            'server.restart.scheduled' => ['label' => 'Server Restart Scheduled', 'default' => true, 'group' => 'Server'],
            'server.restart.executed' => ['label' => 'Server Restarting (Scheduled)', 'default' => true, 'group' => 'Server'],
            'server.start.completed' => ['label' => 'Server Ready (After Start)', 'default' => true, 'group' => 'Server'],
            'server.restart.completed' => ['label' => 'Server Ready (After Restart)', 'default' => true, 'group' => 'Server'],
            'server.save' => ['label' => 'World Saved', 'default' => false, 'group' => 'Server'],
            'server.wipe' => ['label' => 'Server Wipe Started', 'default' => true, 'group' => 'Server'],
            'server.wipe.scheduled' => ['label' => 'Server Wipe Scheduled', 'default' => true, 'group' => 'Server'],
            'server.wipe.executed' => ['label' => 'Server Wipe Executed', 'default' => true, 'group' => 'Server'],
            'server.wipe.completed' => ['label' => 'Server Online (Post-Wipe)', 'default' => true, 'group' => 'Server'],

            // Backup
            'backup.create' => ['label' => 'Backup Started', 'default' => true, 'group' => 'Backup'],
            'backup.created' => ['label' => 'Backup Completed', 'default' => true, 'group' => 'Backup'],
            'backup.rollback' => ['label' => 'Rollback Executed', 'default' => true, 'group' => 'Backup'],
            'backup.rollback.scheduled' => ['label' => 'Rollback Scheduled', 'default' => true, 'group' => 'Backup'],
            'backup.rollback.executed' => ['label' => 'Rollback Completed', 'default' => true, 'group' => 'Backup'],
            'backup.delete' => ['label' => 'Backup Deleted', 'default' => false, 'group' => 'Backup'],

            // Player
            'player.kick' => ['label' => 'Player Kicked', 'default' => true, 'group' => 'Player'],
            'player.ban' => ['label' => 'Player Banned', 'default' => true, 'group' => 'Player'],
        ];
    }
}
