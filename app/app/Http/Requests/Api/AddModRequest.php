<?php

namespace App\Http\Requests\Api;

use Illuminate\Foundation\Http\FormRequest;

class AddModRequest extends FormRequest
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
            'workshop_id' => ['required', 'string', 'max:20'],
            'mod_id' => ['required', 'string', 'max:255'],
            'map_folder' => ['sometimes', 'string', 'max:255'],
        ];
    }
}
