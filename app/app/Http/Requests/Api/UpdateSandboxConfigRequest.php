<?php

namespace App\Http\Requests\Api;

use App\Rules\SafeConfigValue;
use Illuminate\Foundation\Http\FormRequest;

class UpdateSandboxConfigRequest extends FormRequest
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
            'settings' => ['required', 'array', 'min:1'],
            'settings.*' => ['required', new SafeConfigValue],
        ];
    }
}
