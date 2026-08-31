<?php

namespace App\Http\Requests\Admin;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

class ImportModsRequest extends FormRequest
{
    /**
     * Mod IDs and map folders are written verbatim into the semicolon-joined INI
     * lines, so the only characters that must be rejected are the ones that would
     * break the line structure: the `;` separator, `=`, and newlines. Everything
     * else is allowed — real PZ mod IDs contain spaces, brackets, `&`, and `/`
     * (e.g. `[B42] Tatrapan`, `FWOBenchPress&Treadmill`, `1299328280/ToadTraits`).
     */
    private const SAFE_TOKEN = 'regex:/^[^;=\r\n]+$/';

    /**
     * @return array<string, array<int, string>>
     */
    public function rules(): array
    {
        return [
            'workshop_ids' => ['sometimes', 'array', 'max:1000'],
            'workshop_ids.*' => ['string', 'regex:/^\d{1,20}$/'],
            'mod_ids' => ['sometimes', 'array', 'max:1000'],
            'mod_ids.*' => ['string', 'max:255', self::SAFE_TOKEN],
            'map' => ['sometimes', 'array', 'max:64'],
            'map.*' => ['string', 'max:255', self::SAFE_TOKEN],
            'links' => ['sometimes', 'array', 'max:1000'],
            'links.*' => ['array', 'max:100'],
            'links.*.*' => ['string', 'max:255', self::SAFE_TOKEN],
        ];
    }

    /**
     * Drop link entries whose key is not a Workshop ID.
     *
     * The keys of `links` are Workshop IDs, which dot-notation rules cannot reach, so
     * they are filtered here rather than failing an otherwise valid import.
     */
    protected function prepareForValidation(): void
    {
        $links = $this->input('links');

        if (! is_array($links)) {
            return;
        }

        $this->merge([
            'links' => array_filter(
                $links,
                fn ($key) => preg_match('/^\d{1,20}$/', (string) $key) === 1,
                ARRAY_FILTER_USE_KEY,
            ),
        ]);
    }

    /**
     * Reject a payload that carries nothing to import.
     */
    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $hasWorkshop = ! empty($this->input('workshop_ids'));
            $hasMods = ! empty($this->input('mod_ids'));

            if (! $hasWorkshop && ! $hasMods) {
                $validator->errors()->add('mod_ids', 'Provide at least one mod or Workshop ID to import.');
            }
        });
    }
}
