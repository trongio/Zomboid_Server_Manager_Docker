<?php

namespace App\Http\Requests\Admin;

use App\Rules\SafeConfigValue;
use App\Services\ConfigCatalog;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateSandboxConfigRequest extends FormRequest
{
    public function __construct(
        private readonly ConfigCatalog $catalog,
    ) {
        parent::__construct();
    }

    /**
     * Front-end submits dot-notated flat keys (`SOTO.BraveHoursToEarnMin`).
     * Expand them into a nested array so the catalog-driven per-key rules
     * below (e.g. `settings.SOTO.BraveHoursToEarnMin`) actually match.
     * The controller still passes the original (flat) payload to
     * `SandboxLuaParser::write()`, which knows how to dot-expand on its own.
     */
    protected function prepareForValidation(): void
    {
        $settings = $this->input('settings');
        if (! is_array($settings)) {
            return;
        }

        $hasDottedKey = false;
        $expanded = [];
        foreach ($settings as $key => $value) {
            if (is_string($key) && str_contains($key, '.')) {
                $hasDottedKey = true;
                $segments = explode('.', $key);
                $cursor = &$expanded;
                foreach ($segments as $segment) {
                    if (! isset($cursor[$segment]) || ! is_array($cursor[$segment])) {
                        $cursor[$segment] = [];
                    }
                    $cursor = &$cursor[$segment];
                }
                $cursor = $value;
                unset($cursor);
            } else {
                $expanded[$key] = $value;
            }
        }

        if ($hasDottedKey) {
            $this->merge(['settings' => $expanded]);
        }
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        // Apply SafeConfigValue to scalar (non-namespace) values only — mod
        // namespaces show up as arrays at the top level and shouldn't be
        // rejected by a "must be string" rule.
        $safeScalar = function (string $attribute, mixed $value, \Closure $fail): void {
            if (is_array($value)) {
                return;
            }
            (new SafeConfigValue)->validate($attribute, $value, $fail);
        };

        $rules = [
            'settings' => ['required', 'array', 'min:1'],
            // Generic catch-all so unknown keys (catalog hasn't been synced
            // yet, or the mod's namespace isn't in the catalog) still pass
            // through with the same safety guard the controller used before.
            // Per-key catalog rules below override this with stricter
            // type / range / enum checks.
            'settings.*' => ['present', $safeScalar],
        ];

        $catalogSandbox = $this->catalog->sandbox();
        $modCatalogs = $this->catalog->mods();

        foreach ($catalogSandbox as $key => $meta) {
            $rules["settings.{$key}"] = $this->rulesForMeta($meta);
        }

        foreach ($modCatalogs as $modKey => $modBlock) {
            // Permit the nested mod namespace as an object so the per-option
            // rules below can apply. Front-end ships dotted keys
            // (`SOTO.BraveHoursToEarnMin`) and `prepareForValidation` expands
            // them into `settings.SOTO.BraveHoursToEarnMin`.
            $rules["settings.{$modKey}"] = ['sometimes', 'array'];
            foreach ($modBlock['options'] ?? [] as $key => $meta) {
                $rules["settings.{$modKey}.{$key}"] = $this->rulesForMeta($meta);
            }
        }

        return $rules;
    }

    /**
     * @param  array<string, mixed>  $meta
     * @return list<mixed>
     */
    private function rulesForMeta(array $meta): array
    {
        $rules = ['present'];
        $type = $meta['type'] ?? 'string';

        switch ($type) {
            case 'boolean':
                $rules[] = 'boolean';
                break;
            case 'number':
                $rules[] = 'numeric';
                if (isset($meta['min'])) {
                    $rules[] = 'min:'.$meta['min'];
                }
                if (isset($meta['max'])) {
                    $rules[] = 'max:'.$meta['max'];
                }
                break;
            case 'enum':
                if (isset($meta['options']) && is_array($meta['options'])) {
                    $values = array_column($meta['options'], 'value');
                    if ($values !== []) {
                        $rules[] = Rule::in($values);
                    }
                }
                break;
            case 'string':
            default:
                $rules[] = 'string';
                break;
        }

        $rules[] = new SafeConfigValue;

        return $rules;
    }
}
