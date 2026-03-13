<?php

namespace App\Console\Commands;

use App\Services\ShopDeliveryService;
use Illuminate\Console\Command;

class ProcessShopDeliveries extends Command
{
    protected $signature = 'zomboid:process-shop-deliveries';

    protected $description = 'Process delivery results from Lua and retry pending shop deliveries';

    public function handle(ShopDeliveryService $deliveryService): int
    {
        $processed = $deliveryService->processResults();
        $retried = $deliveryService->retryPending();

        if ($processed > 0 || $retried > 0) {
            $this->info("Processed {$processed} results, retried {$retried} deliveries.");
        }

        return self::SUCCESS;
    }
}
