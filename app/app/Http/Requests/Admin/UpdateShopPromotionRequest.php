<?php

namespace App\Http\Requests\Admin;

use App\Enums\PromotionScope;
use App\Enums\PromotionType;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateShopPromotionRequest extends FormRequest
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
            'name' => ['required', 'string', 'max:255'],
            'code' => ['nullable', 'string', 'max:50', Rule::unique('shop_promotions', 'code')->ignore($this->route('promotion'))],
            'type' => ['required', 'string', Rule::enum(PromotionType::class)],
            'value' => ['required', 'numeric', 'min:0.01', 'max:999999.99'],
            'min_purchase' => ['nullable', 'numeric', 'min:0'],
            'max_discount' => ['nullable', 'numeric', 'min:0'],
            'applies_to' => ['required', 'string', Rule::enum(PromotionScope::class)],
            'target_ids' => ['nullable', 'array'],
            'target_ids.*' => ['string', 'uuid'],
            'usage_limit' => ['nullable', 'integer', 'min:1'],
            'per_user_limit' => ['nullable', 'integer', 'min:1'],
            'starts_at' => ['required', 'date'],
            'ends_at' => ['nullable', 'date', 'after:starts_at'],
            'is_active' => ['nullable', 'boolean'],
        ];
    }
}
