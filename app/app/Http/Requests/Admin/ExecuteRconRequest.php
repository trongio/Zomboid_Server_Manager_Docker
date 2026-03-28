<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class ExecuteRconRequest extends FormRequest
{
    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'command' => ['required', 'string', 'max:500', 'regex:/^[^\n\r]*$/'],
        ];
    }
}
