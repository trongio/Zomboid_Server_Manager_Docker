<?php

namespace App\Http\Requests\Api;

use App\Rules\RconSafeMessage;
use Illuminate\Foundation\Http\FormRequest;

class KickPlayerRequest extends FormRequest
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
            'reason' => ['sometimes', 'string', 'max:255', new RconSafeMessage],
        ];
    }
}
