<?php

use App\Models\AuditLog;
use App\Models\MapRenderSetting;
use App\Models\User;
use App\Services\MapRenderService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Bus;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->admin = User::factory()->admin()->create();
    cache()->flush();
});

describe('Map render schedule update', function () {
    it('saves a preset and clears the cron expression', function () {
        MapRenderSetting::instance();

        $this->actingAs($this->admin)
            ->putJson(route('admin.map.render.schedule.update'), [
                'schedule_preset' => 'weekly',
            ])
            ->assertOk()
            ->assertJson(['effective_cron' => '0 4 * * 0']);

        $setting = MapRenderSetting::instance();
        expect($setting->schedule_preset)->toBe('weekly');
        expect($setting->cron_expression)->toBeNull();
    });

    it('accepts a custom cron expression', function () {
        $this->actingAs($this->admin)
            ->putJson(route('admin.map.render.schedule.update'), [
                'schedule_preset' => 'custom',
                'cron_expression' => '*/15 * * * *',
            ])
            ->assertOk()
            ->assertJson(['effective_cron' => '*/15 * * * *']);

        expect(MapRenderSetting::instance()->cron_expression)->toBe('*/15 * * * *');
    });

    it('rejects custom preset without cron expression', function () {
        $this->actingAs($this->admin)
            ->putJson(route('admin.map.render.schedule.update'), [
                'schedule_preset' => 'custom',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('cron_expression');
    });

    it('rejects an invalid cron expression', function () {
        $this->actingAs($this->admin)
            ->putJson(route('admin.map.render.schedule.update'), [
                'schedule_preset' => 'custom',
                'cron_expression' => 'not-a-cron-expression',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('cron_expression');
    });

    it('rejects unknown presets', function () {
        $this->actingAs($this->admin)
            ->putJson(route('admin.map.render.schedule.update'), [
                'schedule_preset' => 'every_full_moon',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('schedule_preset');
    });
});

describe('Map render engine enable/disable', function () {
    it('refuses to enable when pzmap2dzi is not installed', function () {
        $stub = new class extends MapRenderService
        {
            public function isEngineInstalled(): bool
            {
                return false;
            }
        };
        app()->instance(MapRenderService::class, $stub);

        $this->actingAs($this->admin)
            ->postJson(route('admin.map.render.engine.enable'))
            ->assertStatus(503);

        expect(MapRenderSetting::instance()->engine_enabled)->toBeFalse();
    });

    it('enables the engine when pzmap2dzi is present', function () {
        $stub = new class extends MapRenderService
        {
            public function isEngineInstalled(): bool
            {
                return true;
            }
        };
        app()->instance(MapRenderService::class, $stub);

        $this->actingAs($this->admin)
            ->postJson(route('admin.map.render.engine.enable'))
            ->assertOk();

        expect(MapRenderSetting::instance()->engine_enabled)->toBeTrue();
        expect(AuditLog::where('action', 'map.render.engine_enabled')->exists())->toBeTrue();
    });

    it('disables the engine', function () {
        $setting = MapRenderSetting::instance();
        $setting->engine_enabled = true;
        $setting->save();

        $this->actingAs($this->admin)
            ->postJson(route('admin.map.render.engine.disable'))
            ->assertOk();

        expect(MapRenderSetting::instance()->engine_enabled)->toBeFalse();
    });
});

describe('Map render dispatch', function () {
    it('dispatches a job when engine is enabled and idle', function () {
        Bus::fake();

        $stub = new class extends MapRenderService
        {
            public function isEngineInstalled(): bool
            {
                return true;
            }
        };
        app()->instance(MapRenderService::class, $stub);

        $setting = MapRenderSetting::instance();
        $setting->engine_enabled = true;
        $setting->save();

        $this->actingAs($this->admin)
            ->postJson(route('admin.map.render.start'))
            ->assertOk();

        Bus::assertDispatched(\App\Jobs\RenderMapJob::class);
    });

    it('refuses to start when engine is disabled', function () {
        $this->actingAs($this->admin)
            ->postJson(route('admin.map.render.start'))
            ->assertStatus(422);
    });

    it('refuses to start when another render is already running', function () {
        $stub = new class extends MapRenderService
        {
            public function isEngineInstalled(): bool
            {
                return true;
            }
        };
        app()->instance(MapRenderService::class, $stub);

        $setting = MapRenderSetting::instance();
        $setting->engine_enabled = true;
        $setting->save();

        $stub->acquireLock();

        $this->actingAs($this->admin)
            ->postJson(route('admin.map.render.start'))
            ->assertStatus(409);
    });
});

describe('Texturepacks upload', function () {
    it('extracts pack files from a zip into the configured texturepacks directory', function () {
        $tmpZip = tempnam(sys_get_temp_dir(), 'tp_').'.zip';
        $tmpDest = sys_get_temp_dir().'/tp_dest_'.uniqid();

        config()->set('zomboid.map.texturepacks_path', $tmpDest);

        $zip = new ZipArchive;
        $zip->open($tmpZip, ZipArchive::CREATE);
        foreach (['Tiles2x.pack', 'Tiles2x.floor.pack', 'JumboTrees2x.pack', 'Overlays2x.pack'] as $f) {
            $zip->addFromString($f, str_repeat('A', 64));
        }
        $zip->close();

        $upload = new \Illuminate\Http\UploadedFile($tmpZip, 'texturepacks.zip', 'application/zip', null, true);

        $this->actingAs($this->admin)
            ->post(route('admin.map.render.texturepacks.upload'), ['archive' => $upload])
            ->assertOk();

        expect(is_file($tmpDest.'/Tiles2x.pack'))->toBeTrue();
        expect(is_file($tmpDest.'/Overlays2x.pack'))->toBeTrue();

        foreach ((array) glob($tmpDest.'/*.pack') as $f) {
            @unlink((string) $f);
        }
        @rmdir($tmpDest);
        @unlink($tmpZip);
    });

    it('reports missing required files but still extracts what was provided', function () {
        $tmpZip = tempnam(sys_get_temp_dir(), 'tp_').'.zip';
        $tmpDest = sys_get_temp_dir().'/tp_dest_'.uniqid();

        config()->set('zomboid.map.texturepacks_path', $tmpDest);

        $zip = new ZipArchive;
        $zip->open($tmpZip, ZipArchive::CREATE);
        $zip->addFromString('Tiles2x.pack', 'A');
        $zip->close();

        $upload = new \Illuminate\Http\UploadedFile($tmpZip, 'texturepacks.zip', 'application/zip', null, true);

        $this->actingAs($this->admin)
            ->post(route('admin.map.render.texturepacks.upload'), ['archive' => $upload])
            ->assertStatus(422)
            ->assertJsonStructure(['message', 'missing_required']);

        foreach ((array) glob($tmpDest.'/*.pack') as $f) {
            @unlink((string) $f);
        }
        @rmdir($tmpDest);
        @unlink($tmpZip);
    });

    it('rejects non-zip uploads', function () {
        $upload = \Illuminate\Http\UploadedFile::fake()->createWithContent('not-a-zip.txt', 'hello');

        $this->actingAs($this->admin)
            ->post(
                route('admin.map.render.texturepacks.upload'),
                ['archive' => $upload],
                ['Accept' => 'application/json', 'X-Requested-With' => 'XMLHttpRequest']
            )
            ->assertUnprocessable()
            ->assertJsonValidationErrors('archive');
    });

    it('removes texturepacks on delete', function () {
        $tmpDest = sys_get_temp_dir().'/tp_dest_'.uniqid();
        mkdir($tmpDest, 0755, true);
        config()->set('zomboid.map.texturepacks_path', $tmpDest);
        file_put_contents($tmpDest.'/Tiles2x.pack', 'A');

        $this->actingAs($this->admin)
            ->deleteJson(route('admin.map.render.texturepacks.delete'))
            ->assertOk();

        expect(is_file($tmpDest.'/Tiles2x.pack'))->toBeFalse();

        @rmdir($tmpDest);
    });
});

describe('Map render cancel', function () {
    it('flags a running render for cancellation', function () {
        (new MapRenderService)->acquireLock();

        $this->actingAs($this->admin)
            ->postJson(route('admin.map.render.cancel'))
            ->assertOk();

        expect((new MapRenderService)->isCancelRequested())->toBeTrue();
    });

    it('refuses to cancel when nothing is running', function () {
        $this->actingAs($this->admin)
            ->postJson(route('admin.map.render.cancel'))
            ->assertStatus(422);
    });
});

describe('Map render quality update', function () {
    it('saves a quality preset', function () {
        $this->actingAs($this->admin)
            ->putJson(route('admin.map.render.quality.update'), [
                'quality_preset' => 'quick',
            ])
            ->assertOk()
            ->assertJson(['effective_tile_size' => 1024, 'effective_omit_levels' => 5]);

        expect(MapRenderSetting::instance()->quality_preset)->toBe('quick');
    });

    it('rejects custom preset without overrides', function () {
        $this->actingAs($this->admin)
            ->putJson(route('admin.map.render.quality.update'), [
                'quality_preset' => 'custom',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['custom_tile_size', 'custom_omit_levels']);
    });

    it('accepts a valid custom preset', function () {
        $this->actingAs($this->admin)
            ->putJson(route('admin.map.render.quality.update'), [
                'quality_preset' => 'custom',
                'custom_tile_size' => 2048,
                'custom_omit_levels' => 6,
            ])
            ->assertOk();

        $setting = MapRenderSetting::instance();
        expect($setting->quality_preset)->toBe('custom');
        expect($setting->custom_tile_size)->toBe(2048);
        expect($setting->custom_omit_levels)->toBe(6);
    });

    it('rejects unknown presets', function () {
        $this->actingAs($this->admin)
            ->putJson(route('admin.map.render.quality.update'), [
                'quality_preset' => 'ultra-hd',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('quality_preset');
    });

    it('refuses to update during an active render', function () {
        $stub = new class extends MapRenderService
        {
            public function isRendering(): bool
            {
                return true;
            }
        };
        app()->instance(MapRenderService::class, $stub);

        $this->actingAs($this->admin)
            ->putJson(route('admin.map.render.quality.update'), [
                'quality_preset' => 'quick',
            ])
            ->assertStatus(409);
    });
});

describe('Map render pause/resume', function () {
    it('refuses to pause when no render is running', function () {
        $this->actingAs($this->admin)
            ->postJson(route('admin.map.render.pause'))
            ->assertStatus(422);
    });

    it('refuses to resume when nothing is paused', function () {
        $stub = new class extends MapRenderService
        {
            public function isPaused(): bool
            {
                return false;
            }
        };
        app()->instance(MapRenderService::class, $stub);

        $this->actingAs($this->admin)
            ->postJson(route('admin.map.render.resume'))
            ->assertStatus(422);
    });

    it('pauses an active render via the docker pause hook', function () {
        $stub = new class extends MapRenderService
        {
            public bool $paused = false;

            public function isPaused(): bool
            {
                return $this->paused;
            }

            public function pauseRender(): bool
            {
                $this->paused = true;

                return true;
            }
        };
        app()->instance(MapRenderService::class, $stub);
        $stub->acquireLock();

        $this->actingAs($this->admin)
            ->postJson(route('admin.map.render.pause'))
            ->assertOk();

        expect(\App\Models\AuditLog::where('action', 'map.render.paused')->exists())->toBeTrue();
    });

    it('resumes a paused render via the docker unpause hook', function () {
        $stub = new class extends MapRenderService
        {
            public bool $paused = true;

            public function isPaused(): bool
            {
                return $this->paused;
            }

            public function resumeRender(): bool
            {
                $this->paused = false;

                return true;
            }
        };
        app()->instance(MapRenderService::class, $stub);

        $this->actingAs($this->admin)
            ->postJson(route('admin.map.render.resume'))
            ->assertOk();

        expect(\App\Models\AuditLog::where('action', 'map.render.resumed')->exists())->toBeTrue();
    });
});
