<?php

namespace App\Http\Requests\Api;

use App\Rules\RconSafeMessage;
use Illuminate\Foundation\Http\FormRequest;

class RestartServerRequest extends FormRequest
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
            'message' => ['sometimes', 'string', 'max:500', new RconSafeMessage],
        ];
    }
}
