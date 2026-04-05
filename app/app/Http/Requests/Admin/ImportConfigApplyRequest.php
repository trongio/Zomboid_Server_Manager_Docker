<?php

namespace App\Http\Requests\Admin;

use App\Rules\SafeConfigValue;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;

class ImportConfigApplyRequest extends FormRequest
{
    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        $allowBackslash = $this->input('type') === 'server';

        return [
            'type' => ['required', 'string', 'in:server,sandbox'],
            'settings' => ['required', 'array', 'min:1'],
            'settings.*' => ['required', 'string', new SafeConfigValue(allowBackslash: $allowBackslash)],
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
