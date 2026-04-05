<?php

use App\Jobs\ImportWorldSave;
use App\Models\AuditLog;
use App\Models\User;
use App\Services\BackupManager;
use App\Services\DockerManager;
use App\Services\RconClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Queue;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->admin = User::factory()->admin()->create();

    $docker = Mockery::mock(DockerManager::class);
    $docker->shouldReceive('getContainerStatus')->andReturn([
        'exists' => true,
        'running' => true,
        'status' => 'running',
    ])->byDefault();
    $docker->shouldReceive('stopContainer')->byDefault();
    $docker->shouldReceive('startContainer')->byDefault();
    app()->instance(DockerManager::class, $docker);

    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->byDefault();
    $rcon->shouldReceive('command')->byDefault();
    app()->instance(RconClient::class, $rcon);
});

function mockBackupManagerForImport(): void
{
    $manager = Mockery::mock(BackupManager::class);
    $manager->shouldReceive('validateImportZip')->andReturn([
        'layout' => 'full',
        'detected_server_name' => 'ZomboidServer',
        'entry_count' => 42,
        'has_server_config' => true,
        'has_db' => true,
    ])->byDefault();
    $manager->shouldReceive('importWorld')->byDefault();

    app()->instance(BackupManager::class, $manager);
}

// ── Authentication ──────────────────────────────────────────────────

it('requires authentication for world import', function () {
    $this->postJson(route('admin.backups.import'), [
        'file' => UploadedFile::fake()->create('world.zip', 1024, 'application/zip'),
        'confirm' => true,
    ])->assertUnauthorized();
});

// ── Validation ──────────────────────────────────────────────────────

it('rejects non-zip files', function () {
    mockBackupManagerForImport();

    $this->actingAs($this->admin)
        ->postJson(route('admin.backups.import'), [
            'file' => UploadedFile::fake()->create('world.tar.gz', 1024, 'application/gzip'),
            'confirm' => true,
        ])->assertUnprocessable();
});

it('rejects missing confirm field', function () {
    mockBackupManagerForImport();

    $this->actingAs($this->admin)
        ->postJson(route('admin.backups.import'), [
            'file' => UploadedFile::fake()->create('world.zip', 1024, 'application/zip'),
        ])->assertUnprocessable();
});

it('rejects missing file', function () {
    mockBackupManagerForImport();

    $this->actingAs($this->admin)
        ->postJson(route('admin.backups.import'), [
            'confirm' => true,
        ])->assertUnprocessable();
});

// ── Happy Path ──────────────────────────────────────────────────────

it('dispatches ImportWorldSave job on valid upload', function () {
    Queue::fake();
    mockBackupManagerForImport();

    $response = $this->actingAs($this->admin)
        ->postJson(route('admin.backups.import'), [
            'file' => UploadedFile::fake()->create('world.zip', 1024, 'application/zip'),
            'confirm' => true,
        ]);

    $response->assertStatus(202);
    $response->assertJson(['layout' => 'full']);

    Queue::assertPushed(ImportWorldSave::class);
});

it('creates audit log on world import initiation', function () {
    Queue::fake();
    mockBackupManagerForImport();

    $this->actingAs($this->admin)
        ->postJson(route('admin.backups.import'), [
            'file' => UploadedFile::fake()->create('world.zip', 1024, 'application/zip'),
            'confirm' => true,
        ]);

    $log = AuditLog::query()->where('action', 'world.import.initiated')->first();

    expect($log)->not->toBeNull()
        ->and($log->actor)->toBe($this->admin->name)
        ->and($log->target)->toBe('world.zip');
});

it('returns 202 status code', function () {
    Queue::fake();
    mockBackupManagerForImport();

    $this->actingAs($this->admin)
        ->postJson(route('admin.backups.import'), [
            'file' => UploadedFile::fake()->create('world.zip', 1024, 'application/zip'),
            'confirm' => true,
        ])->assertStatus(202);
});

// ── Validation Failure ──────────────────────────────────────────────

it('returns 422 when zip validation fails', function () {
    $manager = Mockery::mock(BackupManager::class);
    $manager->shouldReceive('validateImportZip')
        ->andThrow(new RuntimeException('Zip does not contain recognizable PZ save data.'));
    app()->instance(BackupManager::class, $manager);

    $response = $this->actingAs($this->admin)
        ->postJson(route('admin.backups.import'), [
            'file' => UploadedFile::fake()->create('bad.zip', 100, 'application/zip'),
            'confirm' => true,
        ]);

    $response->assertStatus(422);
    $response->assertJson(['error' => 'Zip does not contain recognizable PZ save data.']);
});
