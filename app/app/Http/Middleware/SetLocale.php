<?php

namespace App\Http\Middleware;

use App\Models\SiteSetting;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\App;
use Symfony\Component\HttpFoundation\Response;

class SetLocale
{
    public function handle(Request $request, Closure $next): Response
    {
        $locale = $request->query('lang')
            ?? $request->cookie('locale')
            ?? session('locale')
            ?? SiteSetting::cached()->default_locale
            ?? 'en';

        // Sanitize to prevent directory traversal
        $locale = preg_replace('/[^a-zA-Z0-9_-]/', '', (string) $locale);

        App::setLocale($locale);
        session(['locale' => $locale]);

        $response = $next($request);

        // Persist locale choice in cookie (30 days)
        if ($request->query('lang')) {
            $response->headers->setCookie(cookie('locale', $locale, 43200));
        }

        return $response;
    }
}
