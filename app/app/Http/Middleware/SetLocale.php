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
        $preferred = $request->query('lang')
            ?? $request->cookie('locale')
            ?? session('locale');

        $default = SiteSetting::cached()->default_locale ?? 'en';

        // Sanitize and validate the preferred locale
        $locale = $this->resolveLocale($preferred, $default);

        App::setLocale($locale);
        session(['locale' => $locale]);

        $response = $next($request);

        // Persist locale choice in cookie (30 days)
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

        // Sanitize: only allow alphanumeric, dash, underscore; max 10 chars
        $sanitized = preg_replace('/[^a-zA-Z0-9_-]/', '', $preferred);

        if ($sanitized === '' || strlen($sanitized) > 10) {
            return $default;
        }

        // English is always valid even without a Language row
        if ($sanitized === 'en') {
            return 'en';
        }

        // Validate against active languages in the database
        if (Language::query()->where('code', $sanitized)->where('is_active', true)->exists()) {
            return $sanitized;
        }

        return $default;
    }
}
