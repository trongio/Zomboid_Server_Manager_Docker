<?php

namespace App\Http\Requests\Api;

use App\Rules\RconSafeMessage;
use Illuminate\Foundation\Http\FormRequest;

class BroadcastRequest extends FormRequest
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
            'message' => ['required', 'string', 'max:500', new RconSafeMessage],
        ];
    }
}
