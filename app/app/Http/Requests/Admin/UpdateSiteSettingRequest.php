<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class UpdateSiteSettingRequest extends FormRequest
{
    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'site_name' => ['sometimes', 'string', 'max:100'],
            'logo' => ['sometimes', 'nullable', 'file', 'max:2048', 'mimes:png,jpg,jpeg,webp'],
            'favicon' => ['sometimes', 'nullable', 'file', 'max:512', 'mimes:ico,png'],
            'footer_text' => ['sometimes', 'string', 'max:200'],
            'hero_badge' => ['sometimes', 'string', 'max:100'],
            'hero_title' => ['sometimes', 'string', 'max:100'],
            'hero_subtitle' => ['sometimes', 'string', 'max:100'],
            'hero_description' => ['sometimes', 'string', 'max:1000'],
            'hero_button_text' => ['sometimes', 'string', 'max:50'],
            'features' => ['sometimes', 'array', 'max:8'],
            'features.*.icon' => ['required_with:features', 'string', 'max:50'],
            'features.*.title' => ['required_with:features', 'string', 'max:100'],
            'features.*.description' => ['required_with:features', 'string', 'max:300'],
            'landing_sections' => ['sometimes', 'array'],
            'landing_sections.*.id' => ['required_with:landing_sections', 'string', 'max:50'],
            'landing_sections.*.enabled' => ['required_with:landing_sections', 'boolean'],
            'landing_sections.*.order' => ['required_with:landing_sections', 'integer', 'min:0'],
            'theme_colors' => ['sometimes', 'nullable', 'array'],
            'theme_colors.primary' => ['sometimes', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'theme_colors.accent' => ['sometimes', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'theme_colors.destructive' => ['sometimes', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'theme_colors.sidebar_primary' => ['sometimes', 'string', 'regex:/^#[0-9a-fA-F]{6}$/'],
            'default_locale' => ['sometimes', 'string', 'max:10'],
        ];
    }
}
