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
use Illuminate\Support\Facades\RateLimiter;
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
        $this->configureDefaults();
        $this->configureRateLimiting();

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
    }
}
