<?php

namespace App\Http\Requests\Admin;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

class RemoveModRequest extends FormRequest
{
    /**
     * @return array<string, array<int, string>>
     */
    public function rules(): array
    {
        return [
            'workshop_id' => ['nullable', 'string', 'regex:/^\d{1,20}$/'],
            'mod_id' => ['nullable', 'string', 'max:255', 'regex:/^[^;=\r\n]+$/'],
        ];
    }

    /**
     * A row is addressable by either identifier, but at least one has to be present.
     */
    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            if ($this->filled('workshop_id') || $this->filled('mod_id')) {
                return;
            }

            $validator->errors()->add('mod_id', 'Provide a Workshop ID or a mod ID to remove.');
        });
    }
}
