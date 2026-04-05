<?php

namespace App\Http\Middleware;

use App\Models\Language;
use App\Models\SiteSetting;
use App\Services\TranslationService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\App;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    /**
     * The root template that's loaded on the first page visit.
     *
     * @see https://inertiajs.com/server-side-setup#root-template
     *
     * @var string
     */
    protected $rootView = 'app';

    /**
     * Determines the current asset version.
     *
     * @see https://inertiajs.com/asset-versioning
     */
    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    /**
     * Define the props that are shared by default.
     *
     * @see https://inertiajs.com/shared-data
     *
     * @return array<string, mixed>
     */
    public function share(Request $request): array
    {
        $siteSettings = SiteSetting::cached();

        view()->share('siteFavicon', $siteSettings->faviconUrl());

        return [
            ...parent::share($request),
            'name' => config('app.name'),
            'auth' => [
                'user' => $request->user(),
            ],
            'sidebarOpen' => ! $request->hasCookie('sidebar_state') || $request->cookie('sidebar_state') === 'true',
            'flash' => [
                'success' => $request->session()->get('success'),
                'error' => $request->session()->get('error'),
            ],
            'site' => fn () => [
                'name' => $siteSettings->site_name,
                'logo_url' => $siteSettings->logoUrl(),
                'favicon_url' => $siteSettings->faviconUrl(),
                'footer_text' => $siteSettings->footer_text,
                'theme_colors' => $siteSettings->theme_colors,
                'default_locale' => $siteSettings->default_locale,
            ],
            'locale' => fn () => App::getLocale(),
            'translations' => fn () => TranslationService::getForLocale(App::getLocale()),
            'available_locales' => fn () => Language::query()
                ->where('is_active', true)
                ->get(['code', 'name', 'native_name'])
                ->toArray(),
        ];
    }
}
