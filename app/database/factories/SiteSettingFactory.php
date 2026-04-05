<?php

namespace Database\Factories;

use App\Models\SiteSetting;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<SiteSetting>
 */
class SiteSettingFactory extends Factory
{
    protected $model = SiteSetting::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'site_name' => 'Zomboid Manager',
            'footer_text' => 'Powered by Zomboid Manager',
            'hero_badge' => 'Georgian Gaming Community',
            'hero_title' => 'Project Zomboid',
            'hero_subtitle' => 'Dedicated Server',
            'hero_description' => 'A fully managed PZ server with web-based administration.',
            'hero_button_text' => 'Join Server',
            'features' => SiteSetting::defaultFeatures(),
            'landing_sections' => SiteSetting::defaultLandingSections(),
            'default_locale' => 'en',
        ];
    }
}
