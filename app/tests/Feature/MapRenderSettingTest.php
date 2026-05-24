<?php

use App\Models\MapRenderSetting;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('returns a singleton instance with sensible defaults', function () {
    $a = MapRenderSetting::instance();
    $b = MapRenderSetting::instance();

    expect($a->id)->toBe($b->id);
    expect($a->engine_enabled)->toBeFalse();
    expect($a->schedule_preset)->toBe('off');
});

it('treats engine as auto-render disabled when preset is off', function () {
    $setting = MapRenderSetting::instance();
    $setting->engine_enabled = true;
    $setting->schedule_preset = 'off';

    expect($setting->isAutoRenderEnabled())->toBeFalse();
    expect($setting->effectiveCronExpression())->toBeNull();
});

it('resolves preset cron expressions', function () {
    $setting = MapRenderSetting::instance();
    $setting->engine_enabled = true;

    $setting->schedule_preset = 'hourly';
    expect($setting->effectiveCronExpression())->toBe('0 * * * *');

    $setting->schedule_preset = 'daily';
    expect($setting->effectiveCronExpression())->toBe('0 4 * * *');

    $setting->schedule_preset = 'weekly';
    expect($setting->effectiveCronExpression())->toBe('0 4 * * 0');
});

it('uses cron_expression for custom preset only', function () {
    $setting = MapRenderSetting::instance();
    $setting->engine_enabled = true;
    $setting->schedule_preset = 'custom';
    $setting->cron_expression = '*/15 * * * *';

    expect($setting->effectiveCronExpression())->toBe('*/15 * * * *');
});

it('reports due time correctly for hourly schedule', function () {
    $setting = MapRenderSetting::instance();
    $setting->engine_enabled = true;
    $setting->schedule_preset = 'hourly';

    $topOfHour = CarbonImmutable::create(2026, 5, 16, 12, 0, 0);
    $midHour = CarbonImmutable::create(2026, 5, 16, 12, 30, 0);

    expect($setting->isDueAt($topOfHour))->toBeTrue();
    expect($setting->isDueAt($midHour))->toBeFalse();
});

it('returns false for isDueAt when preset is off', function () {
    $setting = MapRenderSetting::instance();
    $setting->engine_enabled = true;
    $setting->schedule_preset = 'off';

    expect($setting->isDueAt(CarbonImmutable::now()))->toBeFalse();
});

it('resolves tile size and omit levels by quality preset', function () {
    $setting = MapRenderSetting::instance();

    $setting->quality_preset = 'quick';
    expect($setting->effectiveTileSize())->toBe(1024);
    expect($setting->effectiveOmitLevels())->toBe(5);

    $setting->quality_preset = 'balanced';
    expect($setting->effectiveTileSize())->toBe(512);
    expect($setting->effectiveOmitLevels())->toBe(4);

    $setting->quality_preset = 'high';
    expect($setting->effectiveTileSize())->toBe(256);
    expect($setting->effectiveOmitLevels())->toBe(3);

    $setting->quality_preset = 'custom';
    $setting->custom_tile_size = 2048;
    $setting->custom_omit_levels = 6;
    expect($setting->effectiveTileSize())->toBe(2048);
    expect($setting->effectiveOmitLevels())->toBe(6);
});
