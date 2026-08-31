<?php

namespace Tests;

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use RuntimeException;

abstract class TestCase extends BaseTestCase
{
    public function createApplication(): Application
    {
        $app = parent::createApplication();

        $this->assertSafeTestingDatabase($app);

        return $app;
    }

    protected function setUp(): void
    {
        parent::setUp();

        $this->withoutMiddleware([
            ThrottleRequests::class,
            ValidateCsrfToken::class,
        ]);

        if (filter_var(env('TEST_WITHOUT_VITE', false), FILTER_VALIDATE_BOOLEAN)) {
            $this->withoutVite();
        }
    }

    /**
     * Rendering an Inertia page resolves its entry point through the Vite manifest, so
     * every page test needs freshly built assets. `TEST_WITHOUT_VITE=1` stubs the
     * manifest out for runs that are not about the frontend — the host fast lane
     * (`make test-fast`) sets it. The containerised run leaves it off and keeps
     * asserting that each page's entry point is actually built.
     */
    protected function assertSafeTestingDatabase(Application $app): void
    {
        $connection = (string) $app['config']->get('database.default');
        $database = (string) $app['config']->get("database.connections.{$connection}.database", '');
        $normalizedDatabase = strtolower($database);

        $usesSqliteMemory = $connection === 'sqlite' && $database === ':memory:';
        $looksLikeTestDatabase = str_contains($normalizedDatabase, 'test');

        if ($usesSqliteMemory || $looksLikeTestDatabase) {
            return;
        }

        throw new RuntimeException(sprintf(
            'Unsafe testing database detected: connection "%s", database "%s". Configure tests to use :memory: or a *_test database before running php artisan test.',
            $connection,
            $database === '' ? '(empty)' : $database
        ));
    }
}
