<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class StopServerRequest extends FormRequest
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
            'countdown' => ['sometimes', 'integer', 'min:10', 'max:3600'],
            'message' => ['sometimes', 'nullable', 'string', 'max:500'],
        ];
    }
}
