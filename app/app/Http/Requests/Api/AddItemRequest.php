<?php

namespace App\Http\Requests\Api;

use Illuminate\Foundation\Http\FormRequest;

class AddItemRequest extends FormRequest
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
            'item_id' => ['required', 'string', 'max:255'],
            'count' => ['sometimes', 'integer', 'min:1', 'max:999'],
        ];
    }
}
