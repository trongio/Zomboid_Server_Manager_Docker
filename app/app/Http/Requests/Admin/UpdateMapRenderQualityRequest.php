<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateMapRenderQualityRequest extends FormRequest
{
    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'quality_preset' => ['required', Rule::in(['quick', 'balanced', 'high', 'custom'])],
            'custom_tile_size' => ['nullable', 'required_if:quality_preset,custom', 'integer', Rule::in([128, 256, 512, 1024, 2048])],
            'custom_omit_levels' => ['nullable', 'required_if:quality_preset,custom', 'integer', 'between:0,8'],
        ];
    }
}
