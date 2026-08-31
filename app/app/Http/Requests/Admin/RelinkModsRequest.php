<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class RelinkModsRequest extends FormRequest
{
    /**
     * @return array<string, array<int, string>>
     */
    public function rules(): array
    {
        return [
            'links' => ['required', 'array', 'max:1000'],
            'links.*' => ['array', 'max:100'],
            'links.*.*' => ['string', 'max:255', 'regex:/^[^;=\r\n]+$/'],
        ];
    }

    /**
     * Workshop IDs arrive as object keys, which Laravel's dot-notation rules cannot
     * constrain, so they are checked here and anything non-numeric is dropped rather
     * than rejecting the whole repair over one bad key.
     */
    protected function prepareForValidation(): void
    {
        $links = $this->input('links');

        if (! is_array($links)) {
            return;
        }

        $this->merge([
            'links' => array_filter(
                $links,
                fn ($key) => is_string($key) || is_int($key) ? preg_match('/^\d{1,20}$/', (string) $key) === 1 : false,
                ARRAY_FILTER_USE_KEY,
            ),
        ]);
    }
}
