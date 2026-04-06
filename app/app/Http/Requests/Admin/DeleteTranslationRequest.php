<?php

namespace App\Http\Requests\Admin;

use App\Models\Language;
use Illuminate\Foundation\Http\FormRequest;

class DeleteTranslationRequest extends FormRequest
{
    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'locale' => ['required', 'string', 'max:10', 'regex:'.Language::LOCALE_REGEX],
            'key' => ['required', 'string', 'max:255'],
        ];
    }
}
