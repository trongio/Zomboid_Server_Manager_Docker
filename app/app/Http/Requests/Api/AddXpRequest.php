<?php

namespace App\Http\Requests\Api;

use App\Rules\RconSafeIdentifier;
use Illuminate\Foundation\Http\FormRequest;

class AddXpRequest extends FormRequest
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
            'skill' => ['required', 'string', 'max:255', new RconSafeIdentifier('skill')],
            'amount' => ['required', 'integer', 'min:1'],
        ];
    }
}
