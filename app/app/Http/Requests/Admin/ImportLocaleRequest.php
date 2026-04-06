<?php

namespace App\Http\Requests\Admin;

use App\Models\Language;
use Illuminate\Foundation\Http\FormRequest;

class ImportLocaleRequest extends FormRequest
{
    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'locale' => ['required', 'string', 'max:10', 'regex:'.Language::LOCALE_REGEX],
            'file' => ['required', 'file', 'max:1024', 'mimes:json,txt'],
        ];
    }
}
