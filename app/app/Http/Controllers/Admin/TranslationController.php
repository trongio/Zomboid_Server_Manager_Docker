<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\DeleteTranslationRequest;
use App\Http\Requests\Admin\ImportLocaleRequest;
use App\Http\Requests\Admin\StoreLanguageRequest;
use App\Http\Requests\Admin\UpdateLanguageRequest;
use App\Http\Requests\Admin\UpdateTranslationRequest;
use App\Models\Language;
use App\Models\SiteSetting;
use App\Models\Translation;
use App\Services\AuditLogger;
use App\Services\TranslationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

class TranslationController extends Controller
{

    public function __construct(
        private readonly AuditLogger $auditLogger,
    ) {}

    public function index(Request $request): Response
    {
        $search = $request->query('search', '');
        $allKeys = TranslationService::allKeys();

        // Get all DB overrides grouped by locale
        $overrides = Translation::query()
            ->where('group', '')
            ->get()
            ->groupBy('locale')
            ->map(fn ($items) => $items->pluck('value', 'key')->all())
            ->all();

        // Filter keys by search
        $filteredKeys = $allKeys;
        if ($search) {
            $filteredKeys = array_values(array_filter($allKeys, fn ($key) => str_contains($key, $search)));
        }

        // Load defaults for display — English base plus each locale's JSON file defaults
        $defaults = TranslationService::getForLocale('en');

        $activeLanguages = Language::query()->orderByDesc('is_default')->orderBy('name')->get();

        // Build per-locale JSON defaults so the editor shows the correct base value per language
        $localeDefaults = [];
        foreach ($activeLanguages as $lang) {
            if ($lang->code !== 'en') {
                $localeDefaults[$lang->code] = TranslationService::getJsonDefaults($lang->code);
            }
        }

        return Inertia::render('admin/translations', [
            'languages' => $activeLanguages,
            'keys' => $filteredKeys,
            'defaults' => $defaults,
            'locale_defaults' => $localeDefaults,
            'overrides' => $overrides,
            'search' => $search,
        ]);
    }

    public function updateTranslation(UpdateTranslationRequest $request): JsonResponse
    {
        $validated = $request->validated();

        Translation::query()->updateOrCreate(
            [
                'locale' => $validated['locale'],
                'group' => '',
                'key' => $validated['key'],
            ],
            ['value' => $validated['value']],
        );

        TranslationService::bustCache($validated['locale']);

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'translation.update',
            details: [
                'locale' => $validated['locale'],
                'key' => $validated['key'],
            ],
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Translation updated']);
    }

    public function deleteTranslation(DeleteTranslationRequest $request): JsonResponse
    {
        $validated = $request->validated();

        Translation::query()
            ->where('locale', $validated['locale'])
            ->where('group', '')
            ->where('key', $validated['key'])
            ->delete();

        TranslationService::bustCache($validated['locale']);

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'translation.delete',
            details: [
                'locale' => $validated['locale'],
                'key' => $validated['key'],
            ],
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Translation override removed']);
    }

    public function storeLanguage(StoreLanguageRequest $request): JsonResponse
    {
        $validated = $request->validated();

        Language::query()->create($validated);
        Cache::forget('active_languages');

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'language.create',
            details: ['code' => $validated['code'], 'name' => $validated['name']],
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Language added']);
    }

    public function updateLanguage(UpdateLanguageRequest $request, Language $language): JsonResponse
    {
        $validated = $request->validated();

        // Prevent deactivating the default language
        if ($language->is_default && array_key_exists('is_active', $validated) && ! $validated['is_active']) {
            return response()->json(['message' => 'Cannot deactivate the default language'], 422);
        }

        // If setting as default, ensure language is active, unset other defaults, and sync SiteSetting
        if (($validated['is_default'] ?? false) && ! $language->is_default) {
            if (! $language->is_active && ! ($validated['is_active'] ?? false)) {
                return response()->json(['message' => 'Cannot set an inactive language as default'], 422);
            }

            Language::query()->where('is_default', true)->update(['is_default' => false]);

            $siteSettings = SiteSetting::instance();
            $siteSettings->default_locale = $language->code;
            $siteSettings->save();
            SiteSetting::bustCache();
        }

        $language->update($validated);
        Cache::forget('active_languages');

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'language.update',
            details: ['code' => $language->code, 'changes' => array_keys($validated)],
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Language updated']);
    }

    public function destroyLanguage(Request $request, Language $language): JsonResponse
    {
        if ($language->is_default) {
            return response()->json(['message' => 'Cannot delete the default language'], 422);
        }

        // Delete all translations for this locale
        Translation::query()->where('locale', $language->code)->delete();
        TranslationService::bustCache($language->code);

        $code = $language->code;
        $language->delete();
        Cache::forget('active_languages');

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'language.delete',
            details: ['code' => $code],
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Language deleted']);
    }

    /**
     * Export all translations for a locale as a downloadable JSON file.
     * Always starts from English base so the file serves as a complete template.
     */
    public function exportLocale(string $locale): StreamedResponse
    {
        if (strlen($locale) > 10 || ! preg_match(Language::LOCALE_REGEX, $locale)) {
            abort(404);
        }

        if ($locale !== 'en' && ! Language::query()->where('code', $locale)->exists()) {
            abort(404);
        }

        $translations = TranslationService::getForLocale($locale);

        ksort($translations);

        return response()->streamDownload(function () use ($translations) {
            echo json_encode($translations, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
        }, "translations-{$locale}.json", [
            'Content-Type' => 'application/json',
        ]);
    }

    /**
     * Import translations from an uploaded JSON file for a locale.
     */
    public function importLocale(ImportLocaleRequest $request): JsonResponse
    {
        $validated = $request->validated();
        $locale = $validated['locale'];

        // Ensure locale is a configured language (or English)
        if ($locale !== 'en' && ! Language::query()->where('code', $locale)->exists()) {
            return response()->json(['message' => "Language '{$locale}' is not configured"], 422);
        }
        $contents = file_get_contents($request->file('file')->getRealPath());
        $data = json_decode($contents, true);

        if (json_last_error() !== JSON_ERROR_NONE) {
            return response()->json(['message' => 'Invalid JSON: ' . json_last_error_msg()], 422);
        }

        if (! is_array($data)) {
            return response()->json(['message' => 'Invalid JSON file — expected an object'], 422);
        }

        $count = 0;
        $skipped = 0;

        foreach ($data as $key => $value) {
            if (! is_string($key) || ! is_string($value)) {
                $skipped++;

                continue;
            }

            // Enforce DB column limits
            if (strlen($key) > 255 || strlen($value) > 5000) {
                $skipped++;

                continue;
            }

            Translation::query()->updateOrCreate(
                ['locale' => $locale, 'group' => '', 'key' => $key],
                ['value' => $value],
            );
            $count++;
        }

        TranslationService::bustCache($locale);

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'translation.import',
            details: ['locale' => $locale, 'keys_imported' => $count, 'keys_skipped' => $skipped],
            ip: $request->ip(),
        );

        $message = "{$count} translations imported for '{$locale}'";
        if ($skipped > 0) {
            $message .= " ({$skipped} skipped due to invalid format or length)";
        }

        return response()->json([
            'message' => $message,
            'count' => $count,
            'skipped' => $skipped,
        ]);
    }
}
