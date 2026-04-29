<?php

use App\Models\AuditLog;
use App\Models\Backup;
use App\Models\User;
use App\Services\BackupManager;
use App\Services\ModManager;
use App\Services\OnlinePlayersReader;
use App\Services\PlayerPositionReader;
use App\Services\PlayersDbReader;
use App\Services\RconClient;
use App\Services\SandboxLuaParser;
use App\Services\ServerIniParser;
use App\Services\WhitelistManager;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

function adminUser(): User
{
    return User::factory()->admin()->create();
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

    $onlinePlayers = Mockery::mock(OnlinePlayersReader::class);
    $onlinePlayers->shouldReceive('getOnlineUsernames')->andReturn([]);

    app()->instance(OnlinePlayersReader::class, $onlinePlayers);
}

function mockAdminModManager(array $mods = []): void
{
    $modManager = Mockery::mock(ModManager::class);
    $modManager->shouldReceive('list')->andReturn($mods)->byDefault();
    $modManager->shouldReceive('listWithStatus')->andReturn([
        'mods' => array_map(fn ($m) => $m + ['status' => 'active'], $mods),
        'pending_restart' => false,
        'server_running' => true,
        'applied_snapshot_present' => true,
    ])->byDefault();
    $modManager->shouldReceive('add')->byDefault();
    $modManager->shouldReceive('remove')->andReturn(['workshop_id' => '123', 'mod_id' => 'Test'])->byDefault();
    $modManager->shouldReceive('reorder')->byDefault();

    app()->instance(ModManager::class, $modManager);

    $dockerManager = Mockery::mock(\App\Services\DockerManager::class);
    $dockerManager->shouldReceive('getContainerStatus')->andReturn([
        'exists' => true,
        'running' => true,
        'status' => 'running',
    ])->byDefault();

    app()->instance(\App\Services\DockerManager::class, $dockerManager);
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
        ->has('players', 3) // 1 admin user + 2 unregistered online (Alice, Bob)
    );
});

it('shows registered users even when server is offline', function () {
    mockAdminRconOffline();

    $admin = adminUser();

    $response = $this->actingAs($admin)->get('/admin/players');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('admin/players')
        ->has('players', 1)
        ->where('players.0.username', $admin->username)
    );
});

it('handles offline server on player page', function () {
    mockAdminRconOffline();

    $response = $this->actingAs(adminUser())->get('/admin/players');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('admin/players')
        ->has('players', 1) // admin user still in unified list
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

it('renders config page with correct props', function () {
    mockAdminIniParser([
        'MaxPlayers' => '16',
        'ServerName' => 'TestServer',
        'Public' => 'true',
        'Password' => 'secret',
        'Mods' => 'Mod1;Mod2',
    ]);
    mockAdminLuaParser([
        'Zombies' => 4,
        'DayLength' => 2,
        'ZombieLore' => ['Speed' => 2, 'Strength' => 2],
    ]);

    $response = $this->actingAs(adminUser())->get('/admin/config');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('admin/config')
        ->where('server_config.MaxPlayers', '16')
        ->where('server_config.ServerName', 'TestServer')
        ->where('server_config.Public', 'true')
        ->where('server_config.Mods', 'Mod1;Mod2')
        ->where('sandbox_config.Zombies', 4)
        ->where('sandbox_config.DayLength', 2)
        ->where('sandbox_config.ZombieLore.Speed', 2)
    );
});

it('renders config page when files are unavailable', function () {
    // Parsers throw when files don't exist — controller catches and returns empty arrays
    $iniParser = Mockery::mock(ServerIniParser::class);
    $iniParser->shouldReceive('read')->andThrow(new RuntimeException('File not found'));
    app()->instance(ServerIniParser::class, $iniParser);

    $luaParser = Mockery::mock(SandboxLuaParser::class);
    $luaParser->shouldReceive('read')->andThrow(new RuntimeException('File not found'));
    app()->instance(SandboxLuaParser::class, $luaParser);

    $response = $this->actingAs(adminUser())->get('/admin/config');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('admin/config')
        ->where('server_config', [])
        ->where('sandbox_config', [])
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

it('can update sandbox config', function () {
    mockAdminIniParser();
    mockAdminLuaParser(['Zombies' => 4]);

    $response = $this->actingAs(adminUser())
        ->patchJson('/admin/config/sandbox', ['settings' => ['Zombies' => 1]]);

    $response->assertOk();
    $response->assertJson(['restart_required' => true]);
});

it('creates audit log for admin config updates', function () {
    mockAdminIniParser(['MaxPlayers' => '16']);
    mockAdminLuaParser();

    $admin = adminUser();

    $this->actingAs($admin)
        ->patchJson('/admin/config/server', ['settings' => ['MaxPlayers' => '32']]);

    $log = AuditLog::query()->where('action', 'config.server.update')->first();

    expect($log)->not->toBeNull()
        ->and($log->actor)->toBe($admin->name)
        ->and($log->target)->toBe('server.ini');
});

it('validates settings required for admin config update', function () {
    mockAdminIniParser();
    mockAdminLuaParser();

    $this->actingAs(adminUser())
        ->patchJson('/admin/config/server', [])
        ->assertUnprocessable();

    $this->actingAs(adminUser())
        ->patchJson('/admin/config/sandbox', [])
        ->assertUnprocessable();
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
        // 'backups' is an Inertia::defer() prop — not in initial render
    );
});

it('can create a backup via admin', function () {
    mockAdminBackupManager();

    $response = $this->actingAs(adminUser())
        ->postJson('/admin/backups', ['notes' => 'Test backup']);

    $response->assertStatus(202);
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
        ->has('players')
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
        // 'logs' is an Inertia::defer() prop — not in initial render
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

it('blocks players from admin pages', function () {
    $player = User::factory()->create(['role' => \App\Enums\UserRole::Player]);

    $this->actingAs($player)->get('/dashboard')->assertForbidden();
    $this->actingAs($player)->get('/admin/players')->assertForbidden();
    $this->actingAs($player)->get('/admin/config')->assertForbidden();
    $this->actingAs($player)->get('/admin/mods')->assertForbidden();
    $this->actingAs($player)->get('/admin/backups')->assertForbidden();
    $this->actingAs($player)->get('/admin/whitelist')->assertForbidden();
    $this->actingAs($player)->get('/admin/audit')->assertForbidden();
    $this->actingAs($player)->get('/admin/rcon')->assertForbidden();
    $this->actingAs($player)->get('/admin/logs')->assertForbidden();
});

it('allows moderators to access admin pages', function () {
    mockAdminRcon(['players' => "Players connected (0):\n"]);

    $moderator = User::factory()->create(['role' => \App\Enums\UserRole::Moderator]);

    $this->actingAs($moderator)->get('/admin/players')->assertOk();
});

// --- Player Map ---

function mockPlayersDbReader(array $players = []): void
{
    $reader = Mockery::mock(PlayersDbReader::class);
    $reader->shouldReceive('getAllPlayerPositions')->andReturn($players)->byDefault();
    $reader->shouldReceive('getPlayerPosition')->andReturn(null)->byDefault();

    app()->instance(PlayersDbReader::class, $reader);
}

function mockPlayerPositionReader(?array $data = null): void
{
    $reader = Mockery::mock(PlayerPositionReader::class);
    $reader->shouldReceive('getLivePositions')->andReturn($data)->byDefault();
    $reader->shouldReceive('getPlayerPosition')->andReturn(null)->byDefault();
    $reader->shouldReceive('isStale')->andReturn($data === null)->byDefault();

    app()->instance(PlayerPositionReader::class, $reader);
}

it('renders the player map page with merged data', function () {
    mockPlayersDbReader([
        ['username' => 'Alice', 'name' => 'Alice', 'x' => 10500.0, 'y' => 9800.0, 'z' => 0, 'is_dead' => false],
        ['username' => 'Bob', 'name' => 'Bob', 'x' => 10600.0, 'y' => 9900.0, 'z' => 0, 'is_dead' => false],
    ]);
    mockPlayerPositionReader([
        'timestamp' => '2026-01-15T14:30:00',
        'players' => [
            ['username' => 'Alice', 'x' => 10510.0, 'y' => 9810.0, 'z' => 0, 'is_dead' => false],
        ],
    ]);

    $response = $this->actingAs(adminUser())->get('/admin/players/map');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('admin/player-map')
        ->has('markers', 2)
        ->has('mapConfig')
        ->has('hasTiles')
        ->where('markers.0.username', 'Alice')
        ->where('markers.0.status', 'online')
        ->where('markers.0.x', 10510)
        ->where('markers.1.username', 'Bob')
        ->where('markers.1.status', 'offline')
    );
});

it('renders player map with empty data', function () {
    mockPlayersDbReader([]);
    mockPlayerPositionReader(null);

    $onlinePlayers = Mockery::mock(OnlinePlayersReader::class);
    $onlinePlayers->shouldReceive('getOnlineUsernames')->andReturn([]);
    $onlinePlayers->shouldReceive('getOnlinePlayers')->andReturn(['usernames' => [], 'source' => 'none']);
    app()->instance(OnlinePlayersReader::class, $onlinePlayers);

    $response = $this->actingAs(adminUser())->get('/admin/players/map');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('admin/player-map')
        ->has('markers', 0)
    );
});

it('shows dead players as dead status on the map', function () {
    mockPlayersDbReader([
        ['username' => 'DeadPlayer', 'name' => 'DeadPlayer', 'x' => 10500.0, 'y' => 9800.0, 'z' => 0, 'is_dead' => true],
    ]);
    mockPlayerPositionReader(null);

    $response = $this->actingAs(adminUser())->get('/admin/players/map');

    $response->assertOk();
    $response->assertInertia(fn ($page) => $page
        ->component('admin/player-map')
        ->where('markers.0.status', 'dead')
    );
});

it('uses live position for online players', function () {
    mockPlayersDbReader([
        ['username' => 'Alice', 'name' => 'Alice', 'x' => 100.0, 'y' => 200.0, 'z' => 0, 'is_dead' => false],
    ]);
    mockPlayerPositionReader([
        'timestamp' => '2026-01-15T14:30:00',
        'players' => [
            ['username' => 'Alice', 'x' => 300.0, 'y' => 400.0, 'z' => 1, 'is_dead' => false],
        ],
    ]);

    $response = $this->actingAs(adminUser())->get('/admin/players/map');

    $response->assertInertia(fn ($page) => $page
        ->where('markers.0.x', 300)
        ->where('markers.0.y', 400)
        ->where('markers.0.status', 'online')
    );
});

it('requires auth for player map page', function () {
    $this->get('/admin/players/map')->assertRedirect('/login');
});

it('blocks players from player map page', function () {
    $player = User::factory()->create(['role' => \App\Enums\UserRole::Player]);

    $this->actingAs($player)->get('/admin/players/map')->assertForbidden();
});
