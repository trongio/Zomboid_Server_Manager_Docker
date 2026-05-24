<?php

namespace App\Http\Requests\Admin;

use Illuminate\Foundation\Http\FormRequest;

class UpdateSaveNoisePrefixesRequest extends FormRequest
{
    /**
     * @return array<string, array<int, string>>
     */
    public function rules(): array
    {
        return [
            'prefixes' => ['present', 'array', 'max:50'],
            'prefixes.*' => ['string', 'max:50', 'regex:/^[a-zA-Z0-9_]+$/'],
        ];
    }

    /**
     * @return array<int, string>
     */
    public function prefixes(): array
    {
        /** @var array<int, string> $list */
        $list = (array) $this->validated()['prefixes'];

        return $list;
    }
}
