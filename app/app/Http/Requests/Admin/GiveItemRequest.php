<?php

namespace App\Http\Requests\Admin;

use App\Rules\RconSafeIdentifier;
use Illuminate\Foundation\Http\FormRequest;

class GiveItemRequest extends FormRequest
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
            'item_type' => ['required', 'string', 'max:255', new RconSafeIdentifier('item')],
            'count' => ['required', 'integer', 'min:1', 'max:100'],
        ];
    }
}
