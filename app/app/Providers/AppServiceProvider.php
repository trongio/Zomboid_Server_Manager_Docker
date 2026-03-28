<?php

namespace App\Providers;

use App\Models\AuditLog;
use App\Observers\AuditLogObserver;
use App\Services\AuditLogger;
use App\Services\DiscordWebhookService;
use App\Services\DockerManager;
use App\Services\GameVersionReader;
use App\Services\RconClient;
use Carbon\CarbonImmutable;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(RconClient::class, function ($app) {
            $config = $app['config']['zomboid.rcon'];

            return new RconClient(
                host: $config['host'],
                port: $config['port'],
                password: $config['password'],
                timeout: $config['timeout'],
            );
        });

        $this->app->singleton(AuditLogger::class);

        $this->app->singleton(DockerManager::class, function ($app) {
            $config = $app['config']['zomboid.docker'];

            return new DockerManager(
                proxyUrl: $config['proxy_url'],
                containerName: $config['container_name'],
            );
        });

        $this->app->singleton(DiscordWebhookService::class);

        $this->app->singleton(GameVersionReader::class);
    }

    public function boot(): void
    {
        // Global route patterns — enforce max length to match RconSanitizer limits
        Route::pattern('name', '[a-zA-Z0-9_]{1,50}');
        Route::pattern('username', '[a-zA-Z0-9_]{1,50}');

        $this->configureDefaults();
        $this->configureRateLimiting();
        $this->validateApiKeyLength();

        AuditLog::observe(AuditLogObserver::class);
    }

    protected function configureDefaults(): void
    {
        Date::use(CarbonImmutable::class);

        DB::prohibitDestructiveCommands(
            app()->isProduction(),
        );

        Password::defaults(fn (): ?Password => app()->isProduction()
            ? Password::min(12)
                ->mixedCase()
                ->letters()
                ->numbers()
                ->symbols()
                ->uncompromised()
            : null,
        );
    }

    protected function configureRateLimiting(): void
    {
        RateLimiter::for('api', function (Request $request) {
            $key = $request->header('X-API-Key');

            if ($key && hash_equals(config('zomboid.api_key', ''), $key)) {
                return Limit::perMinute(60)->by($key);
            }

            return Limit::perMinute(15)->by($request->ip());
        });

        RateLimiter::for('admin', function (Request $request) {
            return Limit::perMinute(60)->by($request->user()?->id ?: $request->ip());
        });

        RateLimiter::for('admin-sensitive', function (Request $request) {
            return Limit::perMinute(10)->by($request->user()?->id ?: $request->ip());
        });

        RateLimiter::for('admin-destructive', function (Request $request) {
            return Limit::perMinute(2)->by($request->user()?->id ?: $request->ip());
        });
    }

    protected function validateApiKeyLength(): void
    {
        if (! app()->isProduction()) {
            return;
        }

        app()->booted(function () {
            static $checked = false;
            if ($checked) {
                return;
            }
            $checked = true;

            $apiKey = (string) config('zomboid.api_key', '');
            if ($apiKey !== '' && strlen($apiKey) < 32) {
                Log::warning('API_KEY is shorter than 32 characters. This is insecure for production.');
            }
        });
    }
}
