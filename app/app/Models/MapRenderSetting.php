<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Cron\CronExpression;
use Illuminate\Database\Eloquent\Model;

class MapRenderSetting extends Model
{
    protected $fillable = [
        'engine_enabled',
        'quality_preset',
        'custom_tile_size',
        'custom_omit_levels',
        'schedule_preset',
        'cron_expression',
        'last_run_at',
        'last_run_status',
        'last_run_duration_seconds',
        'last_run_error',
        'base_rendered_at',
        'atlas_built_at',
        'atlas_version',
        'atlas_size_bytes',
        'atlas_sprite_count',
        'atlas_page_count',
        'atlas_lod_count',
        'atlas_has_ktx2',
        'atlas_compression_format',
        'cell_pages_built_at',
        'atlas_download_url',
    ];

    protected function casts(): array
    {
        return [
            'engine_enabled' => 'boolean',
            'last_run_at' => 'datetime',
            'base_rendered_at' => 'datetime',
            'last_run_duration_seconds' => 'integer',
            'custom_tile_size' => 'integer',
            'custom_omit_levels' => 'integer',
            'atlas_built_at' => 'datetime',
            'atlas_size_bytes' => 'integer',
            'atlas_sprite_count' => 'integer',
            'atlas_page_count' => 'integer',
            'atlas_lod_count' => 'integer',
            'atlas_has_ktx2' => 'boolean',
            'cell_pages_built_at' => 'datetime',
        ];
    }

    /**
     * Resolve tile_size based on quality preset (or custom override).
     */
    public function effectiveTileSize(): int
    {
        if ($this->quality_preset === 'custom' && $this->custom_tile_size !== null) {
            return (int) $this->custom_tile_size;
        }

        return match ($this->quality_preset) {
            'quick' => 1024,
            'high' => 256,
            default => 512,
        };
    }

    /**
     * Resolve omit_levels based on quality preset (or custom override).
     */
    public function effectiveOmitLevels(): int
    {
        if ($this->quality_preset === 'custom' && $this->custom_omit_levels !== null) {
            return (int) $this->custom_omit_levels;
        }

        return match ($this->quality_preset) {
            'quick' => 5,
            'high' => 3,
            default => 4,
        };
    }

    /**
     * Get the singleton settings row, creating one if none exists.
     */
    public static function instance(): self
    {
        return static::query()->firstOrCreate([], [
            'engine_enabled' => false,
            'schedule_preset' => 'off',
        ]);
    }

    /**
     * Whether automatic rendering is currently scheduled.
     */
    public function isAutoRenderEnabled(): bool
    {
        return $this->engine_enabled
            && $this->schedule_preset !== 'off'
            && $this->effectiveCronExpression() !== null;
    }

    /**
     * Resolve the cron expression to use for scheduling.
     */
    public function effectiveCronExpression(): ?string
    {
        return match ($this->schedule_preset) {
            'hourly' => '0 * * * *',
            'daily' => '0 4 * * *',
            'weekly' => '0 4 * * 0',
            'custom' => $this->cron_expression,
            default => null,
        };
    }

    /**
     * Whether the cron expression matches the given moment.
     */
    /**
     * Возвращает URL для скачивания атласов с приоритетом:
     * DB-настройка → env (config) → null.
     */
    public function effectiveAtlasDownloadUrl(): ?string
    {
        $dbUrl = $this->atlas_download_url ?? null;
        if (is_string($dbUrl) && trim($dbUrl) !== '') {
            return trim($dbUrl);
        }

        $configUrl = (string) config('zomboid.map.atlas_download_url', '');

        return $configUrl !== '' ? $configUrl : null;
    }

    public function isDueAt(CarbonImmutable $moment): bool
    {
        $expression = $this->effectiveCronExpression();

        if ($expression === null) {
            return false;
        }

        try {
            return (new CronExpression($expression))->isDue($moment->toDateTime());
        } catch (\Throwable) {
            return false;
        }
    }
}
