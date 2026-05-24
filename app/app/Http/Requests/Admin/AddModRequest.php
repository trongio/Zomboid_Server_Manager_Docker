<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class AddModRequest extends FormRequest
{
    /**
     * Promote legacy singular `mod_id` payloads to the new `mod_ids: []` shape
     * so the validation rules below can stay strict without breaking older
     * admin-UI builds shipped before the modpack refactor.
     */
    protected function prepareForValidation(): void
    {
        if (! $this->has('mod_ids') && $this->filled('mod_id')) {
            $this->merge(['mod_ids' => [$this->input('mod_id')]]);
        }
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'workshop_id' => ['required', 'string', 'max:20'],
            'mod_ids' => ['required', 'array', 'min:1'],
            'mod_ids.*' => ['required', 'string', 'max:255'],
            'map_folder' => ['sometimes', 'nullable', 'string', 'max:255'],
        ];
    }
}
