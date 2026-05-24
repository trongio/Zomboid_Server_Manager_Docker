<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class UploadTexturepacksRequest extends FormRequest
{
    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'archive' => ['nullable', 'file', 'max:4194304'],
            'files' => ['nullable', 'array', 'max:20'],
            'files.*' => ['file', 'max:4194304'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'archive.file' => 'Upload must be a file.',
            'archive.max' => 'The archive may not be larger than 4 GB.',
            'files.*.max' => 'Each .pack file may not be larger than 4 GB.',
        ];
    }

    public function withValidator(\Illuminate\Validation\Validator $validator): void
    {
        $validator->after(function ($v) {
            if (! $this->hasFile('archive') && ! $this->hasFile('files')) {
                $v->errors()->add('files', 'Choose at least one .zip archive or .pack file(s) to upload.');
            }
        });
    }
}
