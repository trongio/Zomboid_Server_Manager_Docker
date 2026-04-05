<?php

namespace Database\Factories;

use App\Models\Language;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Language>
 */
class LanguageFactory extends Factory
{
    protected $model = Language::class;

    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'code' => 'en',
            'name' => 'English',
            'native_name' => 'English',
            'is_default' => true,
            'is_active' => true,
        ];
    }

    public function georgian(): static
    {
        return $this->state([
            'code' => 'ka',
            'name' => 'Georgian',
            'native_name' => 'ქართული',
            'is_default' => false,
        ]);
    }

    public function inactive(): static
    {
        return $this->state(['is_active' => false]);
    }
}
