<?php

namespace App\Console\Commands;

use App\Models\MapRenderSetting;
use App\Services\MapRenderService;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

class AutoRenderMapCheck extends Command
{
    /** @var string */
    protected $signature = 'zomboid:auto-render-map';

    /** @var string */
    protected $description = 'Dispatch a map render job when the configured cron schedule is due';

    public function handle(MapRenderService $renderer): int
    {
        $setting = MapRenderSetting::instance();

        if (! $setting->isAutoRenderEnabled()) {
            return self::SUCCESS;
        }

        if (! $renderer->isEngineInstalled()) {
            return self::SUCCESS;
        }

        if ($renderer->isRendering()) {
            return self::SUCCESS;
        }

        if (! $setting->isDueAt(CarbonImmutable::now())) {
            return self::SUCCESS;
        }

        if ($renderer->dispatchRender('system')) {
            $this->info('Scheduled map render dispatched');
        }

        return self::SUCCESS;
    }
}
