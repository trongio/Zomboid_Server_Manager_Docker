<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Http\Requests\Admin\UpdateSaveNoisePrefixesRequest;
use App\Jobs\RebuildSaveCacheJob;
use App\Services\SaveCacheBuilder;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Bus;

/**
 * Управление list'ом extra-noise prefixes для save-cache rebuilder.
 * UI checkboxes под spoiler в debug HUD: пользователь выбирает какие f_*
 * категории фильтровать. Save sprite name с этим prefix отбрасывается.
 */
class PzSaveFilterController extends Controller
{
    public function show(SaveCacheBuilder $builder): JsonResponse
    {
        return response()->json([
            'prefixes' => $builder->getExtraNoisePrefixes(),
        ]);
    }

    public function update(
        UpdateSaveNoisePrefixesRequest $request,
        SaveCacheBuilder $builder,
    ): JsonResponse {
        $builder->setExtraNoisePrefixes($request->prefixes());

        // Триггерим force-full rebuild чтобы изменения вступили в силу немедленно.
        Bus::dispatch(new RebuildSaveCacheJob(forceFull: true));

        return response()->json([
            'prefixes' => $builder->getExtraNoisePrefixes(),
            'rebuild_dispatched' => true,
        ]);
    }
}
