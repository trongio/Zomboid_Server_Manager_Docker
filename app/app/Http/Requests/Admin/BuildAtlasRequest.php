<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class BuildAtlasRequest extends FormRequest
{
    /**
     * @return array<string, array<int, string>>
     */
    public function rules(): array
    {
        return [
            'preset' => ['required', 'string', 'in:minimal,standard,all'],
        ];
    }

    public function preset(): string
    {
        /** @var string $value */
        $value = $this->validated()['preset'];

        return $value;
    }
}
