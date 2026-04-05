<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Language;
use App\Models\Translation;
use App\Services\AuditLogger;
use App\Services\TranslationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

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
            ->whereNull('group')
            ->get()
            ->groupBy('locale')
            ->map(fn ($items) => $items->pluck('value', 'key')->all())
            ->all();

        // Filter keys by search
        $filteredKeys = $allKeys;
        if ($search) {
            $filteredKeys = array_values(array_filter($allKeys, fn ($key) => str_contains($key, $search)));
        }

        // Load defaults for display
        $defaults = TranslationService::getForLocale('en');

        return Inertia::render('admin/translations', [
            'languages' => Language::query()->orderByDesc('is_default')->orderBy('name')->get(),
            'keys' => $filteredKeys,
            'defaults' => $defaults,
            'overrides' => $overrides,
            'search' => $search,
        ]);
    }

    public function updateTranslation(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'locale' => ['required', 'string', 'max:10'],
            'key' => ['required', 'string', 'max:255'],
            'value' => ['required', 'string', 'max:5000'],
        ]);

        Translation::query()->updateOrCreate(
            [
                'locale' => $validated['locale'],
                'group' => null,
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

    public function deleteTranslation(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'locale' => ['required', 'string', 'max:10'],
            'key' => ['required', 'string', 'max:255'],
        ]);

        Translation::query()
            ->where('locale', $validated['locale'])
            ->whereNull('group')
            ->where('key', $validated['key'])
            ->delete();

        TranslationService::bustCache($validated['locale']);

        return response()->json(['message' => 'Translation override removed']);
    }

    public function storeLanguage(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'code' => ['required', 'string', 'max:10', 'unique:languages,code'],
            'name' => ['required', 'string', 'max:100'],
            'native_name' => ['required', 'string', 'max:100'],
        ]);

        Language::query()->create($validated);

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'language.create',
            details: ['code' => $validated['code'], 'name' => $validated['name']],
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Language added']);
    }

    public function updateLanguage(Request $request, Language $language): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['sometimes', 'string', 'max:100'],
            'native_name' => ['sometimes', 'string', 'max:100'],
            'is_active' => ['sometimes', 'boolean'],
            'is_default' => ['sometimes', 'boolean'],
        ]);

        // If setting as default, unset other defaults
        if (($validated['is_default'] ?? false) && ! $language->is_default) {
            Language::query()->where('is_default', true)->update(['is_default' => false]);
        }

        $language->update($validated);

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

        $this->auditLogger->log(
            actor: $request->user()->name ?? 'admin',
            action: 'language.delete',
            details: ['code' => $code],
            ip: $request->ip(),
        );

        return response()->json(['message' => 'Language deleted']);
    }
}
