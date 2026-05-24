<?php

namespace App\Http\Requests\Admin;

use Cron\CronExpression;
use Illuminate\Contracts\Validation\ValidationRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateMapRenderScheduleRequest extends FormRequest
{
    /**
     * @return array<string, array<int, mixed>>
     */
    public function rules(): array
    {
        return [
            'schedule_preset' => ['required', Rule::in(['off', 'hourly', 'daily', 'weekly', 'custom'])],
            'cron_expression' => ['nullable', 'required_if:schedule_preset,custom', 'string', 'max:100', $this->cronExpressionRule()],
        ];
    }

    private function cronExpressionRule(): ValidationRule
    {
        return new class implements ValidationRule
        {
            public function validate(string $attribute, mixed $value, \Closure $fail): void
            {
                if ($value === null || $value === '') {
                    return;
                }

                try {
                    new CronExpression((string) $value);
                } catch (\Throwable) {
                    $fail('The :attribute is not a valid cron expression.');
                }
            }
        };
    }
}
