<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\UpdateSiteSettingRequest;
use App\Models\SiteSetting;
use App\Services\AuditLogger;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Inertia\Inertia;
use Inertia\Response;

class SiteSettingController extends Controller
{
    public function __construct(
        private readonly AuditLogger $auditLogger,
    ) {}

    public function index(): Response
    {
        $settings = SiteSetting::instance();

        return Inertia::render('admin/site-settings', [
            'settings' => [
                'site_name' => $settings->site_name,
                'logo_url' => $settings->logoUrl(),
                'favicon_url' => $settings->faviconUrl(),
                'footer_text' => $settings->footer_text,
                'hero_badge' => $settings->hero_badge,
                'hero_title' => $settings->hero_title,
                'hero_subtitle' => $settings->hero_subtitle,
                'hero_description' => $settings->hero_description,
                'hero_button_text' => $settings->hero_button_text,
                'features' => $settings->features ?? [],
                'landing_sections' => $settings->landing_sections ?? SiteSetting::defaultLandingSections(),
                'theme_colors' => $settings->theme_colors,
                'default_locale' => $settings->default_locale,
            ],
            'available_icons' => self::availableIcons(),
            'available_sections' => [
                ['id' => 'hero', 'label' => 'Hero Section'],
                ['id' => 'stats', 'label' => 'Server Stats'],
                ['id' => 'top_players', 'label' => 'Top Players'],
                ['id' => 'features', 'label' => 'Feature Cards'],
            ],
        ]);
    }

    public function update(UpdateSiteSettingRequest $request): JsonResponse
    {
        $settings = SiteSetting::instance();
        $validated = $request->validated();
        $changes = [];

        // Handle logo upload
        if ($request->hasFile('logo')) {
            if ($settings->logo_path) {
                Storage::disk('public')->delete($settings->logo_path);
            }
            $ext = $request->file('logo')->extension();
            $settings->logo_path = $request->file('logo')->storeAs('site', 'logo.' . $ext, 'public');
            $changes[] = 'logo';
        }

        // Handle favicon upload
        if ($request->hasFile('favicon')) {
            if ($settings->favicon_path) {
                Storage::disk('public')->delete($settings->favicon_path);
            }
            $ext = $request->file('favicon')->extension();
            $settings->favicon_path = $request->file('favicon')->storeAs('site', 'favicon.' . $ext, 'public');
            $changes[] = 'favicon';
        }

        // Update text fields
        $textFields = [
            'site_name', 'footer_text', 'hero_badge', 'hero_title',
            'hero_subtitle', 'hero_description', 'hero_button_text', 'default_locale',
        ];

        foreach ($textFields as $field) {
            if (array_key_exists($field, $validated)) {
                $settings->{$field} = $validated[$field];
                $changes[] = $field;
            }
        }

        // Update JSON fields
        $jsonFields = ['features', 'landing_sections', 'theme_colors'];

        foreach ($jsonFields as $field) {
            if (array_key_exists($field, $validated)) {
                $settings->{$field} = $validated[$field];
                $changes[] = $field;
            }
        }

        // Explicit signal that features were submitted but empty
        if (! array_key_exists('features', $validated) && $request->has('features_cleared')) {
            $settings->features = [];
            $changes[] = 'features';
        }

        // Explicit signal that theme colors were cleared
        if (! array_key_exists('theme_colors', $validated) && $request->has('theme_colors_cleared')) {
            $settings->theme_colors = null;
            $changes[] = 'theme_colors';
        }

        $settings->save();
        SiteSetting::bustCache();

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'site_settings.update',
            details: ['changed_fields' => $changes],
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Site settings updated']);
    }

    public function removeLogo(Request $request): JsonResponse
    {
        $settings = SiteSetting::instance();

        if ($settings->logo_path) {
            Storage::disk('public')->delete($settings->logo_path);
            $settings->logo_path = null;
            $settings->save();
            SiteSetting::bustCache();

            $this->auditLogger->log(
                actor: $request->user()->name ?? 'admin',
                action: 'site_settings.remove_logo',
                details: [],
                ip: $request->ip(),
            );
        }

        return response()->json(['message' => 'Logo removed']);
    }

    public function removeFavicon(Request $request): JsonResponse
    {
        $settings = SiteSetting::instance();

        if ($settings->favicon_path) {
            Storage::disk('public')->delete($settings->favicon_path);
            $settings->favicon_path = null;
            $settings->save();
            SiteSetting::bustCache();

            $this->auditLogger->log(
                actor: $request->user()->name ?? 'admin',
                action: 'site_settings.remove_favicon',
                details: [],
                ip: $request->ip(),
            );
        }

        return response()->json(['message' => 'Favicon removed']);
    }

    /**
     * @return array<int, string>
     */
    public static function availableIcons(): array
    {
        return [
            'Archive', 'Bell', 'Clock', 'Crosshair', 'Gamepad2', 'Globe',
            'Heart', 'LayoutGrid', 'MapPin', 'Package', 'Shield', 'ShieldAlert',
            'Skull', 'Star', 'Sword', 'Terminal', 'Trophy', 'Users', 'Wallet',
            'Wrench', 'Zap',
        ];
    }
}
