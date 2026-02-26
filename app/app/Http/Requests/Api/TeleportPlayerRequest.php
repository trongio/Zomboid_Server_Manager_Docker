<?php

namespace App\Http\Requests\Api;

use Illuminate\Foundation\Http\FormRequest;

class TeleportPlayerRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, string>>
     */
    public function rules(): array
    {
        return [
            'x' => ['required_without:target_player', 'numeric'],
            'y' => ['required_without:target_player', 'numeric'],
            'z' => ['sometimes', 'numeric'],
            'target_player' => ['required_without:x', 'string', 'max:255'],
        ];
    }
}
