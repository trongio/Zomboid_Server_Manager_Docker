<?php

use App\Models\AuditLog;
use App\Services\AuditLogger;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

// ── AuditLogger Service ──────────────────────────────────────────────

it('creates an audit log record via service', function () {
    $logger = app(AuditLogger::class);

    $log = $logger->log(
        actor: 'api-key',
        action: 'server.start',
        target: 'pz-game-server',
        details: ['method' => 'POST', 'path' => '/api/server/start'],
        ip: '192.168.1.1',
    );

    expect($log)->toBeInstanceOf(AuditLog::class)
        ->and($log->actor)->toBe('api-key')
        ->and($log->action)->toBe('server.start')
        ->and($log->target)->toBe('pz-game-server')
        ->and($log->details)->toBe(['method' => 'POST', 'path' => '/api/server/start'])
        ->and($log->ip_address)->toBe('192.168.1.1')
        ->and($log->id)->not->toBeNull();

    $this->assertDatabaseHas('audit_logs', [
        'id' => $log->id,
        'action' => 'server.start',
    ]);
});

it('creates an audit log via static record method', function () {
    $log = AuditLogger::record(
        actor: 'api-key',
        action: 'server.stop',
        ip: '10.0.0.1',
    );

    expect($log->action)->toBe('server.stop')
        ->and($log->target)->toBeNull()
        ->and($log->details)->toBeNull();

    $this->assertDatabaseCount('audit_logs', 1);
});

it('stores details as json', function () {
    $details = [
        'method' => 'PATCH',
        'path' => '/api/config/server-ini',
        'body' => ['MaxPlayers' => '32'],
    ];

    $log = AuditLogger::record(
        actor: 'api-key',
        action: 'config.update',
        target: 'server.ini',
        details: $details,
    );

    $fresh = AuditLog::find($log->id);

    expect($fresh->details)->toBe($details);
});

// ── Audit Middleware ─────────────────────────────────────────────────

it('logs admin api calls via audit middleware', function () {
    config(['zomboid.api_key' => 'test-key-12345']);

    $this->getJson('/api/audit', ['X-API-Key' => 'test-key-12345'])
        ->assertOk();

    $this->assertDatabaseCount('audit_logs', 1);

    $log = AuditLog::first();

    expect($log->actor)->toBe('api-key')
        ->and($log->action)->toContain('api/audit')
        ->and($log->details)->toHaveKeys(['method', 'path', 'status'])
        ->and($log->details['method'])->toBe('GET')
        ->and($log->details['status'])->toBe(200)
        ->and($log->ip_address)->not->toBeNull();
});

it('does not audit unauthenticated requests', function () {
    config(['zomboid.api_key' => 'test-key-12345']);

    $this->getJson('/api/audit')
        ->assertUnauthorized();

    $this->assertDatabaseCount('audit_logs', 0);
});

it('does not audit non-admin routes', function () {
    $this->getJson('/api/health')
        ->assertOk();

    $this->assertDatabaseCount('audit_logs', 0);
});

// ── GET /api/audit Endpoint ──────────────────────────────────────────

it('returns paginated audit logs', function () {
    config(['zomboid.api_key' => 'test-key-12345']);

    AuditLog::factory()->count(20)->create();

    $response = $this->getJson('/api/audit?per_page=5', ['X-API-Key' => 'test-key-12345'])
        ->assertOk()
        ->assertJsonStructure([
            'data' => [
                '*' => ['id', 'actor', 'action', 'target', 'details', 'ip_address', 'created_at'],
            ],
            'links',
            'meta',
        ]);

    // Audit middleware logs after response is built, so only the 20 seeded entries are in the response
    expect($response->json('meta.total'))->toBe(20)
        ->and($response->json('data'))->toHaveCount(5);
});

it('filters audit logs by action', function () {
    config(['zomboid.api_key' => 'test-key-12345']);

    AuditLog::factory()->create(['action' => 'server.start']);
    AuditLog::factory()->create(['action' => 'server.stop']);
    AuditLog::factory()->create(['action' => 'server.start']);

    $response = $this->getJson('/api/audit?action=server.start', ['X-API-Key' => 'test-key-12345'])
        ->assertOk();

    expect($response->json('meta.total'))->toBe(2);
});

it('filters audit logs by actor', function () {
    config(['zomboid.api_key' => 'test-key-12345']);

    AuditLog::factory()->create(['actor' => 'admin-user']);
    AuditLog::factory()->create(['actor' => 'api-key']);

    $response = $this->getJson('/api/audit?actor=admin-user', ['X-API-Key' => 'test-key-12345'])
        ->assertOk();

    expect($response->json('meta.total'))->toBe(1)
        ->and($response->json('data.0.actor'))->toBe('admin-user');
});

it('filters audit logs by date range', function () {
    config(['zomboid.api_key' => 'test-key-12345']);

    AuditLog::factory()->create(['created_at' => '2026-01-01 00:00:00']);
    AuditLog::factory()->create(['created_at' => '2026-02-15 00:00:00']);
    AuditLog::factory()->create(['created_at' => '2026-03-01 00:00:00']);

    $response = $this->getJson('/api/audit?from=2026-02-01&to=2026-02-28', ['X-API-Key' => 'test-key-12345'])
        ->assertOk();

    expect($response->json('meta.total'))->toBe(1);
});

it('validates per_page limits', function () {
    config(['zomboid.api_key' => 'test-key-12345']);

    $this->getJson('/api/audit?per_page=200', ['X-API-Key' => 'test-key-12345'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('per_page');

    $this->getJson('/api/audit?per_page=0', ['X-API-Key' => 'test-key-12345'])
        ->assertUnprocessable()
        ->assertJsonValidationErrors('per_page');
});

it('requires api key for audit endpoint', function () {
    config(['zomboid.api_key' => 'test-key-12345']);

    $this->getJson('/api/audit')
        ->assertUnauthorized();

    $this->getJson('/api/audit', ['X-API-Key' => 'wrong-key'])
        ->assertUnauthorized();
});

it('returns audit logs in descending order by created_at', function () {
    config(['zomboid.api_key' => 'test-key-12345']);

    AuditLog::factory()->create(['action' => 'oldest', 'created_at' => '2026-01-01']);
    AuditLog::factory()->create(['action' => 'newest', 'created_at' => '2026-03-01']);
    AuditLog::factory()->create(['action' => 'middle', 'created_at' => '2026-02-01']);

    $response = $this->getJson('/api/audit', ['X-API-Key' => 'test-key-12345'])
        ->assertOk();

    $data = $response->json('data');

    // Audit middleware logs after response is built, so results are just the 3 seeded entries
    expect($data[0]['action'])->toBe('newest')
        ->and($data[1]['action'])->toBe('middle')
        ->and($data[2]['action'])->toBe('oldest');
});
