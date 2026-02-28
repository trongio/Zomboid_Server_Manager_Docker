<?php

use App\Enums\BackupType;
use App\Enums\UserRole;
use App\Jobs\RollbackGameServer;
use App\Models\AuditLog;
use App\Models\Backup;
use App\Models\User;
use App\Services\BackupManager;
use App\Services\DockerManager;
use App\Services\RconClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
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
    $docker->shouldReceive('stopContainer')->andReturn(true)->byDefault();
    $docker->shouldReceive('startContainer')->andReturn(true)->byDefault();
    app()->instance(DockerManager::class, $docker);
});

// ── Create Backup with player notification ───────────────────────────

describe('Create backup player notification', function () {
    it('broadcasts RCON message when notify_players is true', function () {
        $rcon = Mockery::mock(RconClient::class);
        $rcon->shouldReceive('connect')->once();
        $rcon->shouldReceive('command')
            ->with('servermsg "Saving the world, hold tight!"')
            ->once();
        app()->instance(RconClient::class, $rcon);

        $backupManager = Mockery::mock(BackupManager::class);
        $backupManager->shouldReceive('createBackup')
            ->once()
            ->andReturn([
                'backup' => Backup::factory()->create(),
                'cleanup_count' => 0,
            ]);
        app()->instance(BackupManager::class, $backupManager);

        $this->actingAs($this->admin)
            ->postJson(route('admin.backups.store'), [
                'notify_players' => true,
                'message' => 'Saving the world, hold tight!',
            ])
            ->assertCreated();
    });

    it('uses default message when notify_players is true and no custom message', function () {
        $rcon = Mockery::mock(RconClient::class);
        $rcon->shouldReceive('connect')->once();
        $rcon->shouldReceive('command')
            ->with('servermsg "Backup in progress — expect a brief lag"')
            ->once();
        app()->instance(RconClient::class, $rcon);

        $backupManager = Mockery::mock(BackupManager::class);
        $backupManager->shouldReceive('createBackup')
            ->once()
            ->andReturn([
                'backup' => Backup::factory()->create(),
                'cleanup_count' => 0,
            ]);
        app()->instance(BackupManager::class, $backupManager);

        $this->actingAs($this->admin)
            ->postJson(route('admin.backups.store'), [
                'notify_players' => true,
            ])
            ->assertCreated();
    });

    it('does not broadcast when notify_players is false', function () {
        $rcon = Mockery::mock(RconClient::class);
        $rcon->shouldNotReceive('connect');
        app()->instance(RconClient::class, $rcon);

        $backupManager = Mockery::mock(BackupManager::class);
        $backupManager->shouldReceive('createBackup')
            ->once()
            ->andReturn([
                'backup' => Backup::factory()->create(),
                'cleanup_count' => 0,
            ]);
        app()->instance(BackupManager::class, $backupManager);

        $this->actingAs($this->admin)
            ->postJson(route('admin.backups.store'), [
                'notes' => 'Quick backup',
            ])
            ->assertCreated();
    });

    it('proceeds with backup when RCON is offline', function () {
        $rcon = Mockery::mock(RconClient::class);
        $rcon->shouldReceive('connect')->andThrow(new RuntimeException('Connection refused'));
        app()->instance(RconClient::class, $rcon);

        $backupManager = Mockery::mock(BackupManager::class);
        $backupManager->shouldReceive('createBackup')
            ->once()
            ->andReturn([
                'backup' => Backup::factory()->create(),
                'cleanup_count' => 0,
            ]);
        app()->instance(BackupManager::class, $backupManager);

        $this->actingAs($this->admin)
            ->postJson(route('admin.backups.store'), [
                'notify_players' => true,
            ])
            ->assertCreated();
    });
});

// ── Rollback with countdown ──────────────────────────────────────────

describe('Rollback with countdown', function () {
    it('performs immediate rollback when no countdown provided', function () {
        $backup = Backup::factory()->create();

        $backupManager = Mockery::mock(BackupManager::class);
        $backupManager->shouldReceive('rollback')
            ->once()
            ->andReturn([
                'pre_rollback_backup' => Backup::factory()->create(['type' => BackupType::PreRollback]),
                'restored_from' => $backup,
            ]);
        app()->instance(BackupManager::class, $backupManager);

        $this->actingAs($this->admin)
            ->postJson(route('admin.backups.rollback', $backup), [
                'confirm' => true,
            ])
            ->assertOk()
            ->assertJson(['message' => 'Rollback completed']);

        expect(AuditLog::where('action', 'backup.rollback')->exists())->toBeTrue();
    });

    it('schedules rollback with countdown and broadcasts RCON warning', function () {
        Queue::fake();
        $backup = Backup::factory()->create();

        $rcon = Mockery::mock(RconClient::class);
        $rcon->shouldReceive('connect')->once();
        $rcon->shouldReceive('command')
            ->with('servermsg "Rolling back in 60s — save your progress!"')
            ->once();
        app()->instance(RconClient::class, $rcon);

        $this->actingAs($this->admin)
            ->postJson(route('admin.backups.rollback', $backup), [
                'confirm' => true,
                'countdown' => 60,
                'message' => 'Rolling back in 60s — save your progress!',
            ])
            ->assertOk()
            ->assertJson([
                'message' => 'Rollback scheduled in 60 seconds',
                'countdown' => 60,
            ]);

        Queue::assertPushed(RollbackGameServer::class);
        expect(AuditLog::where('action', 'backup.rollback.scheduled')->exists())->toBeTrue();
    });

    it('uses default warning message when none provided', function () {
        Queue::fake();
        $backup = Backup::factory()->create();

        $rcon = Mockery::mock(RconClient::class);
        $rcon->shouldReceive('connect')->once();
        $rcon->shouldReceive('command')
            ->with('servermsg "Server rolling back in 30 seconds — you will be disconnected"')
            ->once();
        app()->instance(RconClient::class, $rcon);

        $this->actingAs($this->admin)
            ->postJson(route('admin.backups.rollback', $backup), [
                'confirm' => true,
                'countdown' => 30,
            ])
            ->assertOk();

        Queue::assertPushed(RollbackGameServer::class);
    });

    it('schedules rollback even when RCON is offline', function () {
        Queue::fake();
        $backup = Backup::factory()->create();

        $rcon = Mockery::mock(RconClient::class);
        $rcon->shouldReceive('connect')->andThrow(new RuntimeException('Connection refused'));
        app()->instance(RconClient::class, $rcon);

        $this->actingAs($this->admin)
            ->postJson(route('admin.backups.rollback', $backup), [
                'confirm' => true,
                'countdown' => 60,
            ])
            ->assertOk()
            ->assertJson(['message' => 'Rollback scheduled in 60 seconds']);

        Queue::assertPushed(RollbackGameServer::class);
    });

    it('rejects countdown below minimum', function () {
        $backup = Backup::factory()->create();

        $this->actingAs($this->admin)
            ->postJson(route('admin.backups.rollback', $backup), [
                'confirm' => true,
                'countdown' => 5,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('countdown');
    });

    it('rejects countdown above maximum', function () {
        $backup = Backup::factory()->create();

        $this->actingAs($this->admin)
            ->postJson(route('admin.backups.rollback', $backup), [
                'confirm' => true,
                'countdown' => 9999,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('countdown');
    });

    it('requires admin authentication', function () {
        $player = User::factory()->create(['role' => UserRole::Player]);
        $backup = Backup::factory()->create();

        $this->actingAs($player)
            ->postJson(route('admin.backups.rollback', $backup), [
                'confirm' => true,
            ])
            ->assertForbidden();
    });
});
