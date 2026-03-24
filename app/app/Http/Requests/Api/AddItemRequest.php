<?php

namespace App\Http\Requests\Api;

use App\Rules\RconSafeIdentifier;
use Illuminate\Foundation\Http\FormRequest;

class AddItemRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'item_id' => ['required', 'string', 'max:255', new RconSafeIdentifier('item')],
            'count' => ['sometimes', 'integer', 'min:1', 'max:999'],
        ];
    }
}
