<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;

/**
 * @property int $id
 * @property string $site_name
 * @property string|null $logo_path
 * @property string|null $favicon_path
 * @property string $footer_text
 * @property string $hero_badge
 * @property string $hero_title
 * @property string $hero_subtitle
 * @property string $hero_description
 * @property string $hero_button_text
 * @property array<int, array<string, string>>|null $features
 * @property array<int, array<string, mixed>>|null $landing_sections
 * @property array<string, string>|null $theme_colors
 * @property string $default_locale
 * @property \Illuminate\Support\Carbon $created_at
 * @property \Illuminate\Support\Carbon $updated_at
 */
class SiteSetting extends Model
{
    use HasFactory;

    protected $fillable = [
        'site_name',
        'logo_path',
        'favicon_path',
        'footer_text',
        'hero_badge',
        'hero_title',
        'hero_subtitle',
        'hero_description',
        'hero_button_text',
        'features',
        'landing_sections',
        'theme_colors',
        'default_locale',
    ];

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'features' => 'array',
            'landing_sections' => 'array',
            'theme_colors' => 'array',
        ];
    }

    /**
     * Get the singleton settings instance, creating one if none exists.
     */
    public static function instance(): static
    {
        return static::query()->firstOrCreate([], [
            'site_name' => 'Zomboid Manager',
            'footer_text' => 'Powered by Zomboid Manager',
            'hero_badge' => 'Georgian Gaming Community',
            'hero_title' => 'Project Zomboid',
            'hero_subtitle' => 'Dedicated Server',
            'hero_description' => 'A fully managed PZ server with web-based administration. Mod management, automated backups, player controls, and RCON console — all from your browser.',
            'hero_button_text' => 'Join Server',
            'features' => self::defaultFeatures(),
            'landing_sections' => self::defaultLandingSections(),
            'default_locale' => 'en',
        ]);
    }

    /**
     * Get cached singleton instance (1 hour TTL).
     */
    public static function cached(): static
    {
        return Cache::remember('site_settings', 3600, fn () => static::instance());
    }

    /**
     * Clear the cached singleton.
     */
    public static function bustCache(): void
    {
        Cache::forget('site_settings');
    }

    public function logoUrl(): ?string
    {
        return $this->logo_path ? Storage::disk('public')->url($this->logo_path) : null;
    }

    public function faviconUrl(): ?string
    {
        return $this->favicon_path ? Storage::disk('public')->url($this->favicon_path) : null;
    }

    /**
     * @return array<int, array<string, string>>
     */
    public static function defaultFeatures(): array
    {
        return [
            ['icon' => 'Terminal', 'title' => 'RCON Control', 'description' => 'Full server management via RCON — start, stop, restart, broadcast, and execute commands remotely.'],
            ['icon' => 'Users', 'title' => 'Player Management', 'description' => 'Kick, ban, set access levels, teleport players, give items, and manage XP — all from the dashboard.'],
            ['icon' => 'Wrench', 'title' => 'Config Editor', 'description' => 'Edit server.ini and SandboxVars.lua through a web interface. No SSH required.'],
            ['icon' => 'Package', 'title' => 'Mod Manager', 'description' => 'Add, remove, and reorder Steam Workshop mods. Keeps WorkshopItems and Mods in sync.'],
            ['icon' => 'Archive', 'title' => 'Backup & Rollback', 'description' => 'Automated scheduled backups with retention policies. One-click rollback to any previous state.'],
            ['icon' => 'Shield', 'title' => 'Whitelist Control', 'description' => 'Manage server access with whitelist CRUD. Add and remove players with sync to PZ database.'],
        ];
    }

    /**
     * @return array<int, array<string, mixed>>
     */
    public static function defaultLandingSections(): array
    {
        return [
            ['id' => 'hero', 'enabled' => true, 'order' => 0],
            ['id' => 'stats', 'enabled' => true, 'order' => 1],
            ['id' => 'top_players', 'enabled' => true, 'order' => 2],
            ['id' => 'features', 'enabled' => true, 'order' => 3],
        ];
    }
}
