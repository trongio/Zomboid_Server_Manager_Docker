<?php

use App\Http\Middleware\HandleAppearance;
use App\Http\Middleware\HandleInertiaRequests;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Middleware\AddLinkHeadersForPreloadedAssets;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Symfony\Component\HttpFoundation\Response;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
        then: function () {
            // Global route patterns — enforce max length to match RconSanitizer limits
            \Illuminate\Support\Facades\Route::pattern('name', '[a-zA-Z0-9_]{1,50}');
            \Illuminate\Support\Facades\Route::pattern('username', '[a-zA-Z0-9_]{1,50}');

            \Illuminate\Support\Facades\Route::middleware([])->group(function () {
                \Illuminate\Support\Facades\Route::get('ping', fn () => response('pong', 200, ['Cache-Control' => 'no-store']))->name('ping');
            });
        },
    )
    ->withMiddleware(function (Middleware $middleware): void {
        $middleware->trustProxies(at: '*');
        $middleware->encryptCookies(except: ['appearance', 'sidebar_state']);

        $middleware->web(append: [
            HandleAppearance::class,
            HandleInertiaRequests::class,
            AddLinkHeadersForPreloadedAssets::class,
        ]);

        $middleware->alias([
            'auth.apikey' => \App\Http\Middleware\ApiKeyAuth::class,
            'audit' => \App\Http\Middleware\AuditApiActions::class,
            'admin' => \App\Http\Middleware\EnsureUserIsAdmin::class,
        ]);

        $middleware->api(prepend: [
            \Illuminate\Routing\Middleware\ThrottleRequests::class.':api',
        ]);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->respond(function (Response $response, Throwable $exception, Request $request) {
            if (! app()->environment(['local', 'testing']) && in_array($response->getStatusCode(), [500, 503, 404, 403])) {
                return Inertia::render('error', ['status' => $response->getStatusCode()])
                    ->toResponse($request)
                    ->setStatusCode($response->getStatusCode());
            }

            if ($response->getStatusCode() === 419) {
                if ($request->expectsJson()) {
                    return response()->json(['error' => 'The page expired, please try again.'], 419);
                }

                return back()->with([
                    'error' => 'The page expired, please try again.',
                ]);
            }

            return $response;
        });
    })->create();
