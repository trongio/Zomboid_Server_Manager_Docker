<?php

use App\Models\AuditLog;
use App\Models\Backup;
use App\Models\User;
use App\Services\BackupManager;
use App\Services\ModManager;
use App\Services\RconClient;
use App\Services\SandboxLuaParser;
use App\Services\ServerIniParser;
use App\Services\WhitelistManager;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

function adminUser(): User
{
    return User::factory()->create();
}

function mockAdminRcon(array $commands = []): void
{
    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->byDefault();
    $rcon->shouldReceive('command')->andReturn('')->byDefault();

    foreach ($commands as $command => $response) {
        $rcon->shouldReceive('command')
            ->with($command)
            ->andReturn($response);
    }

    app()->instance(RconClient::class, $rcon);
}

function mockAdminRconOffline(): void
{
    $rcon = Mockery::mock(RconClient::class);
    $rcon->shouldReceive('connect')->andThrow(new RuntimeException('Connection refused'));

    app()->instance(RconClient::class, $rcon);
}

function mockAdminModManager(array $mods = []): void
{
    $modManager = Mockery::mock(ModManager::class);
    $modManager->shouldReceive('list')->andReturn($mods)->byDefault();
    $modManager->shouldReceive('add')->byDefault();
    $modManager->shouldReceive('remove')->andReturn(['workshop_id' => '123', 'mod_id' => 'Test'])->byDefault();
    $modManager->shouldReceive('reorder')->byDefault();

    app()->instance(ModManager::class, $modManager);
}

function mockAdminIniParser(array $config = []): void
{
    $parser = Mockery::mock(ServerIniParser::class);
    $parser->shouldReceive('read')->andReturn($config)->byDefault();
    $parser->shouldReceive('write')->byDefault();

    app()->instance(ServerIniParser::class, $parser);
}

function mockAdminLuaParser(array $config = []): void
{
    $parser = Mockery::mock(SandboxLuaParser::class);
    $parser->shouldReceive('read')->andReturn($config)->byDefault();
    $parser->shouldReceive('write')->byDefault();

    app()->instance(SandboxLuaParser::class, $parser);
}

function mockAdminWhitelist(array $entries = []): void
{
    $wl = Mockery::mock(WhitelistManager::class);
    $wl->shouldReceive('list')->andReturn($entries)->byDefault();
    $wl->shouldReceive('add')->andReturn(true)->byDefault();
    $wl->shouldReceive('remove')->andReturn(true)->byDefault();
    $wl->shouldReceive('syncWithPostgres')->andReturn(['added' => [], 'removed' => [], 'mismatches' => []])->byDefault();

    app()->instance(WhitelistManager::class, $wl);
}

function mockAdminBackupManager(): void
{
    $bm = Mockery::mock(BackupManager::class);
    $bm->shouldReceive('createBackup')->andReturn([
        'backup' => Backup::create([
            'filename' => 'test-backup.tar.gz',
            'path' => '/backups/test-backup.tar.gz',
            'size_bytes' => 1024,
            'type' => 'manual',
            'created_at' => now(),
        ]),
        'cleanup_count' => 0,
    ])->byDefault();
    $bm->shouldReceive('deleteBackup')->andReturn(true)->byDefault();

    app()->instance(BackupManager::class, $bm);
}

// --- Player Management ---

it('renders the player management page', function () {
    mockAdminRcon(['players' => "Players connected (2):\n-Alice\n-Bob\n"]);

    $response = $this->actingAs(adminUser())->get('/admin/players');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('admin/players')
        ->has('players', 2)
    );
});

it('handles offline server on player page', function () {
    mockAdminRconOffline();

    $response = $this->actingAs(adminUser())->get('/admin/players');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('admin/players')
        ->has('players', 0)
    );
});

it('can kick a player via admin', function () {
    mockAdminRcon();

    $response = $this->actingAs(adminUser())
        ->postJson('/admin/players/TestPlayer/kick', ['reason' => 'AFK']);

    $response->assertOk();
    $response->assertJson(['message' => 'Kicked TestPlayer']);
});

it('can ban a player via admin', function () {
    mockAdminRcon();

    $response = $this->actingAs(adminUser())
        ->postJson('/admin/players/TestPlayer/ban', ['reason' => 'Cheating']);

    $response->assertOk();
    $response->assertJson(['message' => 'Banned TestPlayer']);
});

it('can set access level via admin', function () {
    mockAdminRcon();

    $response = $this->actingAs(adminUser())
        ->postJson('/admin/players/TestPlayer/access', ['level' => 'admin']);

    $response->assertOk();
    $response->assertJson(['message' => 'Set TestPlayer access to admin']);
});

// --- Config Management ---

it('renders the config page', function () {
    mockAdminIniParser(['MaxPlayers' => '16', 'ServerName' => 'Test']);
    mockAdminLuaParser(['Speed' => 1, 'Zombies' => 3]);

    $response = $this->actingAs(adminUser())->get('/admin/config');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('admin/config')
        ->has('server_config')
        ->has('sandbox_config')
    );
});

it('can update server config', function () {
    mockAdminIniParser(['MaxPlayers' => '16']);
    mockAdminLuaParser();

    $response = $this->actingAs(adminUser())
        ->patchJson('/admin/config/server', ['settings' => ['MaxPlayers' => '32']]);

    $response->assertOk();
    $response->assertJson(['restart_required' => true]);
});

// --- Mod Management ---

it('renders the mod management page', function () {
    mockAdminModManager([
        ['workshop_id' => '123', 'mod_id' => 'TestMod', 'position' => 0],
    ]);

    $response = $this->actingAs(adminUser())->get('/admin/mods');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('admin/mods')
        ->has('mods', 1)
    );
});

it('can add a mod via admin', function () {
    mockAdminModManager();

    $response = $this->actingAs(adminUser())
        ->postJson('/admin/mods', ['workshop_id' => '456', 'mod_id' => 'NewMod']);

    $response->assertCreated();
    $response->assertJson(['restart_required' => true]);
});

it('can remove a mod via admin', function () {
    mockAdminModManager();

    $response = $this->actingAs(adminUser())
        ->deleteJson('/admin/mods/123');

    $response->assertOk();
    $response->assertJson(['restart_required' => true]);
});

// --- Backup Management ---

it('renders the backup page', function () {
    Backup::create([
        'filename' => 'backup.tar.gz',
        'path' => '/backups/backup.tar.gz',
        'size_bytes' => 2048,
        'type' => 'manual',
        'created_at' => now(),
    ]);

    $response = $this->actingAs(adminUser())->get('/admin/backups');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('admin/backups')
        ->has('backups')
    );
});

it('can create a backup via admin', function () {
    mockAdminBackupManager();

    $response = $this->actingAs(adminUser())
        ->postJson('/admin/backups', ['notes' => 'Test backup']);

    $response->assertCreated();
});

it('can delete a backup via admin', function () {
    mockAdminBackupManager();

    $backup = Backup::create([
        'filename' => 'delete-me.tar.gz',
        'path' => '/backups/delete-me.tar.gz',
        'size_bytes' => 512,
        'type' => 'manual',
        'created_at' => now(),
    ]);

    $response = $this->actingAs(adminUser())
        ->deleteJson("/admin/backups/{$backup->id}");

    $response->assertOk();
    $response->assertJson(['message' => 'Deleted delete-me.tar.gz']);
});

// --- Whitelist Management ---

it('renders the whitelist page', function () {
    mockAdminWhitelist([
        ['username' => 'player1', 'password_hash' => 'hash1'],
    ]);

    $response = $this->actingAs(adminUser())->get('/admin/whitelist');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('admin/whitelist')
        ->has('entries', 1)
    );
});

it('can add a user to whitelist', function () {
    mockAdminWhitelist();

    $response = $this->actingAs(adminUser())
        ->postJson('/admin/whitelist', ['username' => 'newuser', 'password' => 'pass123']);

    $response->assertCreated();
    $response->assertJson(['username' => 'newuser']);
});

it('can remove a user from whitelist', function () {
    mockAdminWhitelist();

    $response = $this->actingAs(adminUser())
        ->deleteJson('/admin/whitelist/testuser');

    $response->assertOk();
    $response->assertJson(['username' => 'testuser']);
});

// --- Audit Log ---

it('renders the audit log page', function () {
    AuditLog::create([
        'actor' => 'admin',
        'action' => 'player.kick',
        'target' => 'TestPlayer',
        'created_at' => now(),
    ]);

    $response = $this->actingAs(adminUser())->get('/admin/audit');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('admin/audit')
        ->has('logs')
        ->has('filters')
        ->has('available_actions')
    );
});

it('filters audit log by action', function () {
    AuditLog::create(['actor' => 'admin', 'action' => 'player.kick', 'target' => 'A', 'created_at' => now()]);
    AuditLog::create(['actor' => 'admin', 'action' => 'server.restart', 'target' => 'B', 'created_at' => now()]);

    $response = $this->actingAs(adminUser())->get('/admin/audit?action=player.kick');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('admin/audit')
        ->where('filters.action', 'player.kick')
    );
});

// --- Auth guard ---

it('requires auth for all admin pages', function () {
    $this->get('/admin/players')->assertRedirect('/login');
    $this->get('/admin/config')->assertRedirect('/login');
    $this->get('/admin/mods')->assertRedirect('/login');
    $this->get('/admin/backups')->assertRedirect('/login');
    $this->get('/admin/whitelist')->assertRedirect('/login');
    $this->get('/admin/audit')->assertRedirect('/login');
});
