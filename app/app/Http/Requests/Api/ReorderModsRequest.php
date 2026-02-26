<?php

namespace App\Http\Requests\Api;

use Illuminate\Foundation\Http\FormRequest;

class ReorderModsRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, string>>
     */
    public function rules(): array
    {
        return [
            'mods' => ['required', 'array', 'min:1'],
            'mods.*.workshop_id' => ['required', 'string'],
            'mods.*.mod_id' => ['required', 'string'],
        ];
    }
}
