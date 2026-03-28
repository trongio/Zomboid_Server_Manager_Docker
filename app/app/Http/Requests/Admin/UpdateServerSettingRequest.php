<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class UpdateServerSettingRequest extends FormRequest
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
            'server_ip' => ['required', 'string', 'max:255'],
            'server_port' => ['required', 'integer', 'min:1024', 'max:65535'],
        ];
    }
}
