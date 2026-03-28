<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class SetAccessLevelRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'level' => ['required', Rule::in(['admin', 'moderator', 'overseer', 'gm', 'observer', 'none'])],
        ];
    }
}
