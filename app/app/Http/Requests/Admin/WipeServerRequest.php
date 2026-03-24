<?php

namespace App\Http\Requests\Admin;

use App\Rules\RconSafeMessage;
use Illuminate\Foundation\Http\FormRequest;

class WipeServerRequest extends FormRequest
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
            'countdown' => ['sometimes', 'integer', 'min:10', 'max:3600'],
            'message' => ['sometimes', 'nullable', 'string', 'max:500', new RconSafeMessage],
        ];
    }
}
