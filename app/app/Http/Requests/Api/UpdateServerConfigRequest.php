<?php

namespace App\Http\Requests\Api;

use App\Rules\SafeConfigValue;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

class UpdateServerConfigRequest extends FormRequest
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
            'settings.*' => ['required', 'string', new SafeConfigValue(allowBackslash: true)],
        ];
    }

    /**
     * Validate that setting keys don't contain injection characters.
     */
    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            foreach (array_keys($this->input('settings', [])) as $key) {
                if (preg_match('/[\n\r=]/', (string) $key)) {
                    $validator->errors()->add('settings', 'Setting keys must not contain newlines or equals signs.');
                }
            }
        });
    }
}
