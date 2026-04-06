<?php

namespace App\Http\Middleware;

use App\Models\Language;
use App\Models\SiteSetting;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\App;
use Symfony\Component\HttpFoundation\Response;

class SetLocale
{
    public function handle(Request $request, Closure $next): Response
    {
        $siteSettings = SiteSetting::cached();

        // Share with other middleware (HandleInertiaRequests) to avoid duplicate lookups
        $request->attributes->set('site_settings', $siteSettings);

        $preferred = $request->query('lang')
            ?? $request->cookie('locale')
            ?? session('locale');

        $default = $siteSettings->default_locale ?? 'en';

        $locale = $this->resolveLocale($preferred, $this->validateDefault($default));

        App::setLocale($locale);
        session(['locale' => $locale]);

        $response = $next($request);

        if ($request->query('lang')) {
            $response->headers->setCookie(cookie('locale', $locale, 43200));
        }

        return $response;
    }

    private function resolveLocale(?string $preferred, string $default): string
    {
        if ($preferred === null || $preferred === '') {
            return $default;
        }

        $sanitized = preg_replace('/[^a-zA-Z0-9_-]/', '', $preferred);

        if ($sanitized === '' || strlen($sanitized) > 10) {
            return $default;
        }

        if ($sanitized === 'en') {
            return 'en';
        }

        if (Language::query()->where('code', $sanitized)->where('is_active', true)->exists()) {
            return $sanitized;
        }

        return $default;
    }

    /**
     * Validate the configured default locale. Falls back to 'en' if invalid/inactive.
     */
    private function validateDefault(string $default): string
    {
        if ($default === 'en') {
            return 'en';
        }

        if (strlen($default) > 10 || ! preg_match(Language::LOCALE_REGEX, $default)) {
            return 'en';
        }

        if (Language::query()->where('code', $default)->where('is_active', true)->exists()) {
            return $default;
        }

        return 'en';
    }
}