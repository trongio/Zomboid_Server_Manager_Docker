#Requires -Version 5.1
<#
.SYNOPSIS
    Zomboid Manager — PowerShell equivalent of Makefile for Windows.
.DESCRIPTION
    Run: .\make.ps1 <command>
    Example: .\make.ps1 up
             .\make.ps1 exec "php artisan migrate"
             .\make.ps1 init
.NOTES
    Requires Docker Desktop for Windows (with Linux containers enabled).
#>

param(
    [Parameter(Position = 0)]
    [string]$Command = "help",

    [Parameter(Position = 1, ValueFromRemainingArguments)]
    [string[]]$CmdArgs
)

$ErrorActionPreference = "Continue"

# ── Architecture detection ──────────────────────────────────────────
$arch = if ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -eq [System.Runtime.InteropServices.Architecture]::Arm64) {
    "aarch64"
} else {
    "x86_64"
}

$ArchFile = if ($arch -eq "aarch64") { "docker-compose.arm64.yml" } else { "docker-compose.amd64.yml" }
$ComposeArgs = @("compose", "-f", "docker-compose.yml", "-f", $ArchFile)

# ── Port defaults (override via env vars) ───────────────────────────
$PZ_GAME_PORT   = if ($env:PZ_GAME_PORT)   { $env:PZ_GAME_PORT }   else { "16261" }
$PZ_DIRECT_PORT = if ($env:PZ_DIRECT_PORT) { $env:PZ_DIRECT_PORT } else { "16262" }
$APP_PORT       = if ($env:APP_PORT)       { $env:APP_PORT }       else { "8000" }

# ── Volume list for nuke ────────────────────────────────────────────
$Volumes = @(
    "pz-postgres", "pz-app-vendor", "pz-app-node-modules", "pz-app-build",
    "pz-server-files", "pz-data", "pz-redis", "pz-backups", "pz-lua-bridge",
    "pz-map-tiles", "pz-caddy-data", "pz-caddy-config"
)

# ── Helpers ─────────────────────────────────────────────────────────
function Invoke-Compose {
    param([string[]]$Arguments)
    $allArgs = $script:ComposeArgs + $Arguments
    Write-Host "  > docker $($allArgs -join ' ')" -ForegroundColor DarkGray
    & docker @allArgs
    if ($LASTEXITCODE -ne 0) { throw "Command failed with exit code $LASTEXITCODE" }
}

function Test-VolumeExists {
    param([string]$Name)
    docker volume inspect $Name 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
}

function Confirm-AdminPrivileges {
    $identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        Write-Host "Error: This command requires Administrator privileges. Run PowerShell as Administrator." -ForegroundColor Red
        return $false
    }
    return $true
}

function Ensure-DbVolume {
    if (-not (Test-VolumeExists "pz-postgres")) {
        Write-Host "Creating Postgres volume pz-postgres..." -ForegroundColor Yellow
        docker volume create pz-postgres | Out-Null
    }
}

# ── Commands ────────────────────────────────────────────────────────

function Do-Init {
    Write-Host ""
    Write-Host "Starting setup wizard..." -ForegroundColor Cyan
    & powershell -ExecutionPolicy Bypass -File "scripts\setup.ps1"
}

function Do-Up {
    Ensure-DbVolume
    Invoke-Compose @("up", "-d", "--build")
}

function Do-Down {
    Invoke-Compose @("down")
}

function Do-Build {
    Invoke-Compose @("build")
}

function Do-Restart {
    Invoke-Compose @("restart")
}

function Do-Stop {
    Invoke-Compose @("stop")
}

function Do-Logs {
    # Don't use Invoke-Compose — Ctrl+C exit code is non-zero and that's OK
    $allArgs = $script:ComposeArgs + @("logs", "-f")
    Write-Host "  > docker $($allArgs -join ' ')" -ForegroundColor DarkGray
    & docker @allArgs
}

function Do-Ps {
    Invoke-Compose @("ps")
}

function Do-Pull {
    Invoke-Compose @("pull")
}

function Do-Migrate {
    Do-DbBackup
    Invoke-Compose @("exec", "app", "php", "artisan", "migrate", "--force")
}

function Do-Test {
    # Create test DB if missing
    $check = docker exec -T pz-db psql -U zomboid -tc "SELECT 1 FROM pg_database WHERE datname='zomboid_test'" 2>$null
    if ($check -notmatch "1") {
        docker exec -T pz-db psql -U zomboid -c "CREATE DATABASE zomboid_test OWNER zomboid" 2>$null
    }
    Invoke-Compose @("exec", "-e", "APP_ENV=testing", "-e", "APP_CONFIG_CACHE=/tmp/laravel-test-config.php", "-e", "DB_CONNECTION=pgsql", "-e", "DB_DATABASE=zomboid_test", "app", "php", "artisan", "test", "--compact")
}

function Do-Exec {
    $cmd = $script:CmdArgs -join " "
    if (-not $cmd) {
        Write-Host "Usage: .\make.ps1 exec `"php artisan ...`"" -ForegroundColor Yellow
        return
    }
    # Split the command string into tokens for proper argument passing
    $tokens = $cmd -split '\s+'
    Invoke-Compose (@("exec", "app") + $tokens)
}

function Do-Arch {
    Write-Host "Detected: $arch -> $ArchFile"
}

function Do-Info {
    $publicIp = try { (Invoke-WebRequest -Uri "https://api.ipify.org" -TimeoutSec 5 -UseBasicParsing).Content.Trim() } catch { "" }

    Write-Host ""
    Write-Host ([char]0x2554 + ([string][char]0x2550 * 46) + [char]0x2557) -ForegroundColor Cyan
    Write-Host ([char]0x2551 + "          Zomboid Manager - Status            " + [char]0x2551) -ForegroundColor Cyan
    Write-Host ([char]0x255A + ([string][char]0x2550 * 46) + [char]0x255D) -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Local Admin:   http://localhost:$APP_PORT"

    if (Test-Path ".firewall.conf") {
        $conf = Get-Content ".firewall.conf" | Where-Object { $_ -match "=" -and $_ -notmatch "^\s*#" }
        $fwVars = @{}
        foreach ($line in $conf) {
            $parts = $line -split "=", 2
            $key = $parts[0].Trim()
            $val = $parts[1].Trim().Trim("'", '"')
            $fwVars[$key] = $val
        }
        $httpPort  = if ($fwVars["ADMIN_HTTP_PORT"])  { $fwVars["ADMIN_HTTP_PORT"] }  else { "80" }
        $httpsPort = if ($fwVars["ADMIN_HTTPS_PORT"]) { $fwVars["ADMIN_HTTPS_PORT"] } else { "443" }
        $host_ = $fwVars["ADMIN_PUBLIC_HOST"]
        if ($host_ -and $host_ -ne "localhost") {
            $url = if ($httpsPort -eq "443") { "https://$host_" } else { "https://${host_}:$httpsPort" }
            Write-Host "  Public Admin:  $url  (requires '.\make.ps1 admin-expose')"
        } else {
            Write-Host "  Public Admin:  not configured (run '.\make.ps1 init' to enable)"
        }
        Write-Host "  Caddy Ports:   $httpPort (HTTP) / $httpsPort (HTTPS)"
        Write-Host "  Firewall:      $($fwVars['FIREWALL_BACKEND'])"
    } else {
        Write-Host "  Public Admin:  not configured (run '.\make.ps1 init')"
        Write-Host "  Firewall:      not configured"
    }

    if ($publicIp) {
        Write-Host "  Public IP:     $publicIp"
    } else {
        Write-Host "  Public IP:     unavailable"
    }
    Write-Host "  Game Ports:    $PZ_GAME_PORT/udp, $PZ_DIRECT_PORT/udp (closed by default)"
    Write-Host ""
    Write-Host "  Run '.\make.ps1 expose' to allow remote players."
    Write-Host "  Run '.\make.ps1 admin-expose' to open public admin access."
    Write-Host ""
}

function Do-DbCheck {
    Ensure-DbVolume
}

function Do-DbInit {
    if (Test-VolumeExists "pz-postgres") {
        Write-Host "Volume pz-postgres already exists - keeping existing data."
    } else {
        Write-Host "Creating Postgres volume pz-postgres (empty database)."
        docker volume create pz-postgres | Out-Null
        Write-Host "Volume created. Run '.\make.ps1 up' to start services."
    }
}

function Do-DbReset {
    Write-Host "WARNING: This will PERMANENTLY delete Postgres data volume pz-postgres." -ForegroundColor Red
    $confirm = Read-Host "Type RESET_DB and press Enter to continue"
    if ($confirm -ne "RESET_DB") {
        Write-Host "Cancelled."
        return
    }
    Invoke-Compose @("down")
    docker volume rm pz-postgres 2>$null
    docker volume create pz-postgres | Out-Null
    Write-Host "Postgres volume recreated. Run '.\make.ps1 up' to start with an empty DB."
}

function Do-DbBackup {
    if (-not (Test-Path "db-backups")) { New-Item -ItemType Directory -Path "db-backups" | Out-Null }
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $backupFile = "db-backups\backup-$timestamp.sql"
    Write-Host "Backing up database..."
    $result = docker exec pz-db pg_dump -U zomboid -d zomboid --no-owner 2>$null
    if ($LASTEXITCODE -eq 0 -and $result) {
        [System.IO.File]::WriteAllText($backupFile, ($result -join "`n"), [System.Text.UTF8Encoding]::new($false))
        Write-Host "Backup saved to $backupFile"
    } else {
        Write-Host "No database to backup (first run?)" -ForegroundColor Yellow
    }
}

function Do-DbRestore {
    if (-not (Test-Path "db-backups") -or -not (Get-ChildItem "db-backups\*.sql" -ErrorAction SilentlyContinue)) {
        Write-Host "No backups found in db-backups\"
        return
    }
    $latest = Get-ChildItem "db-backups\*.sql" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    Write-Host "Restoring from $($latest.Name)..."
    # Use docker cp to avoid PowerShell pipe encoding issues
    docker cp $latest.FullName "pz-db:/tmp/restore.sql"
    docker exec pz-db psql -U zomboid -d zomboid -f /tmp/restore.sql
    docker exec pz-db rm /tmp/restore.sql
    Write-Host "Restored."
}

function Do-Nuke {
    Write-Host "WARNING: This will destroy ALL data (database, game saves, backups, config)." -ForegroundColor Red
    $confirm = Read-Host "Type NUKE_ALL and press Enter to continue"
    if ($confirm -ne "NUKE_ALL") {
        Write-Host "Cancelled."
        return
    }
    Invoke-Compose @("down", "-v", "--remove-orphans")
    foreach ($vol in $Volumes) {
        docker volume rm $vol 2>$null | Out-Null
    }
    # Remove leftover pz-* volumes
    $remaining = @(docker volume ls -q --filter "name=pz-" 2>$null)
    if ($remaining) {
        Write-Host "Removing leftover volumes: $remaining"
        $remaining | ForEach-Object { docker volume rm $_ 2>$null | Out-Null }
    }
    Remove-Item -Force -ErrorAction SilentlyContinue .env, app\.env, .firewall.conf
    Remove-Item -Force -ErrorAction SilentlyContinue caddy\Caddyfile, caddy\certs\cert.pem, caddy\certs\key.pem
    Write-Host "Nuke complete. All volumes and config removed." -ForegroundColor Green
}

# ── Firewall (Windows Firewall via netsh) ───────────────────────────

function Do-Expose {
    if (-not (Confirm-AdminPrivileges)) { return }
    Write-Host "Opening game ports in Windows Firewall..." -ForegroundColor Cyan
    # Remove existing rules first (idempotent)
    netsh advfirewall firewall delete rule name="PZ Game UDP $PZ_GAME_PORT" 2>$null | Out-Null
    netsh advfirewall firewall delete rule name="PZ Game UDP $PZ_DIRECT_PORT" 2>$null | Out-Null
    # Add rules
    netsh advfirewall firewall add rule name="PZ Game UDP $PZ_GAME_PORT" dir=in action=allow protocol=UDP localport=$PZ_GAME_PORT | Out-Null
    netsh advfirewall firewall add rule name="PZ Game UDP $PZ_DIRECT_PORT" dir=in action=allow protocol=UDP localport=$PZ_DIRECT_PORT | Out-Null
    Write-Host "  Opened UDP $PZ_GAME_PORT and $PZ_DIRECT_PORT" -ForegroundColor Green
    Write-Host ""
    Do-Info
}

function Do-Hide {
    if (-not (Confirm-AdminPrivileges)) { return }
    Write-Host "Closing game ports in Windows Firewall..." -ForegroundColor Cyan
    netsh advfirewall firewall delete rule name="PZ Game UDP $PZ_GAME_PORT" 2>$null | Out-Null
    netsh advfirewall firewall delete rule name="PZ Game UDP $PZ_DIRECT_PORT" 2>$null | Out-Null
    Write-Host "  Closed UDP $PZ_GAME_PORT and $PZ_DIRECT_PORT" -ForegroundColor Green
}

function Do-AdminExpose {
    if (-not (Confirm-AdminPrivileges)) { return }
    if (-not (Test-Path ".firewall.conf")) {
        Write-Host "Error: run '.\make.ps1 init' first." -ForegroundColor Red
        return
    }
    $conf = Get-Content ".firewall.conf" | Where-Object { $_ -match "=" -and $_ -notmatch "^\s*#" }
    $fwVars = @{}
    foreach ($line in $conf) {
        $parts = $line -split "=", 2
        $fwVars[$parts[0].Trim()] = $parts[1].Trim().Trim("'", '"')
    }
    $httpPort  = if ($fwVars["ADMIN_HTTP_PORT"])  { $fwVars["ADMIN_HTTP_PORT"] }  else { "80" }
    $httpsPort = if ($fwVars["ADMIN_HTTPS_PORT"]) { $fwVars["ADMIN_HTTPS_PORT"] } else { "443" }

    Write-Host "Opening admin ports in Windows Firewall..." -ForegroundColor Cyan
    netsh advfirewall firewall delete rule name="PZ Admin HTTP $httpPort" 2>$null | Out-Null
    netsh advfirewall firewall delete rule name="PZ Admin HTTPS $httpsPort" 2>$null | Out-Null
    netsh advfirewall firewall add rule name="PZ Admin HTTP $httpPort" dir=in action=allow protocol=TCP localport=$httpPort | Out-Null
    netsh advfirewall firewall add rule name="PZ Admin HTTPS $httpsPort" dir=in action=allow protocol=TCP localport=$httpsPort | Out-Null
    Write-Host "  Admin panel exposed on ports $httpPort (HTTP) / $httpsPort (HTTPS)" -ForegroundColor Green
    Write-Host "  Local:  http://localhost:$APP_PORT"
}

function Do-AdminHide {
    if (-not (Confirm-AdminPrivileges)) { return }
    if (-not (Test-Path ".firewall.conf")) {
        Write-Host "Error: run '.\make.ps1 init' first." -ForegroundColor Red
        return
    }
    $conf = Get-Content ".firewall.conf" | Where-Object { $_ -match "=" -and $_ -notmatch "^\s*#" }
    $fwVars = @{}
    foreach ($line in $conf) {
        $parts = $line -split "=", 2
        $fwVars[$parts[0].Trim()] = $parts[1].Trim().Trim("'", '"')
    }
    $httpPort  = if ($fwVars["ADMIN_HTTP_PORT"])  { $fwVars["ADMIN_HTTP_PORT"] }  else { "80" }
    $httpsPort = if ($fwVars["ADMIN_HTTPS_PORT"]) { $fwVars["ADMIN_HTTPS_PORT"] } else { "443" }

    netsh advfirewall firewall delete rule name="PZ Admin HTTP $httpPort" 2>$null | Out-Null
    netsh advfirewall firewall delete rule name="PZ Admin HTTPS $httpsPort" 2>$null | Out-Null
    Write-Host "Admin panel restricted to local access." -ForegroundColor Green
    Write-Host "  Local:  http://localhost:$APP_PORT"
}

function Do-UpdateVersion {
    Write-Host "Current version:"
    if (Test-Path "game-version.conf") {
        $content = Get-Content "game-version.conf"
        foreach ($line in $content) {
            if ($line -match "^PZ_VERSION=(.+)") { Write-Host "  $($Matches[1])" }
            if ($line -match "^PZ_VERSION_FULL=(.+)") { Write-Host "  $($Matches[1])" }
        }
    } else {
        Write-Host "  (not set)"
    }
    Write-Host ""
    Write-Host "Paste the full version string from the game"
    Write-Host '(e.g. 42.16.1 679520210a22497d1cb91ca6105ed544637604c6 2026-04-02 14:57:34 (ZB))'
    Write-Host ""
    $full = Read-Host ">"
    if (-not $full) { Write-Host "Cancelled."; return }
    if ($full -match "^(\d+\.\d+(\.\d+)*)") {
        $ver = $Matches[1]
    } else {
        Write-Host "Error: could not parse version number." -ForegroundColor Red
        return
    }
    $content = Get-Content "game-version.conf"
    $content = $content -replace "^PZ_VERSION=.*", "PZ_VERSION=$ver"
    $content = $content -replace "^PZ_VERSION_FULL=.*", "PZ_VERSION_FULL=$full"
    $content | Set-Content "game-version.conf"
    Write-Host ""
    Write-Host "Updated game-version.conf:"
    Write-Host "  PZ_VERSION=$ver"
    Write-Host "  PZ_VERSION_FULL=$full"
}

function Do-Help {
    Write-Host ""
    Write-Host "Zomboid Manager - Windows PowerShell Commands" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  Setup:" -ForegroundColor White
    Write-Host "    .\make.ps1 init             Interactive first-run setup wizard"
    Write-Host "    .\make.ps1 setup            Alias for init"
    Write-Host ""
    Write-Host "  Services:" -ForegroundColor White
    Write-Host "    .\make.ps1 up               Start services"
    Write-Host "    .\make.ps1 down             Stop services"
    Write-Host "    .\make.ps1 build            Build Docker images"
    Write-Host "    .\make.ps1 restart          Restart services"
    Write-Host "    .\make.ps1 stop             Stop without removing containers"
    Write-Host "    .\make.ps1 logs             Follow service logs"
    Write-Host "    .\make.ps1 ps               List running containers"
    Write-Host "    .\make.ps1 pull             Pull latest images"
    Write-Host ""
    Write-Host "  Firewall (Windows Firewall — requires Administrator):" -ForegroundColor White
    Write-Host "    .\make.ps1 expose           Open game ports (UDP)"
    Write-Host "    .\make.ps1 hide             Close game ports (UDP)"
    Write-Host "    .\make.ps1 admin-expose     Open admin HTTPS ports"
    Write-Host "    .\make.ps1 admin-hide       Close admin HTTPS ports"
    Write-Host ""
    Write-Host "  Database:" -ForegroundColor White
    Write-Host "    .\make.ps1 db-check         Check/create DB volume"
    Write-Host "    .\make.ps1 db-init          Create empty DB volume"
    Write-Host "    .\make.ps1 db-reset         Reset DB volume (DANGER)"
    Write-Host "    .\make.ps1 db-backup        Backup database"
    Write-Host "    .\make.ps1 db-restore       Restore latest backup"
    Write-Host ""
    Write-Host "  App:" -ForegroundColor White
    Write-Host '    .\make.ps1 migrate          Run database migrations'
    Write-Host '    .\make.ps1 test             Run tests'
    Write-Host '    .\make.ps1 exec "CMD"       Run command in app container'
    Write-Host ""
    Write-Host "  Other:" -ForegroundColor White
    Write-Host "    .\make.ps1 info             Show URLs, IP, firewall status"
    Write-Host "    .\make.ps1 arch             Show detected CPU architecture"
    Write-Host "    .\make.ps1 update-version   Update game-version.conf"
    Write-Host "    .\make.ps1 nuke             Destroy ALL data (DANGER)"
    Write-Host ""
}

# ── Dispatch ────────────────────────────────────────────────────────
switch ($Command) {
    "init"           { Do-Init }
    "setup"          { Do-Init }
    "up"             { Do-Up }
    "down"           { Do-Down }
    "build"          { Do-Build }
    "restart"        { Do-Restart }
    "stop"           { Do-Stop }
    "logs"           { Do-Logs }
    "ps"             { Do-Ps }
    "pull"           { Do-Pull }
    "migrate"        { Do-Migrate }
    "test"           { Do-Test }
    "exec"           { Do-Exec }
    "arch"           { Do-Arch }
    "info"           { Do-Info }
    "db-check"       { Do-DbCheck }
    "db-init"        { Do-DbInit }
    "db-reset"       { Do-DbReset }
    "db-backup"      { Do-DbBackup }
    "db-restore"     { Do-DbRestore }
    "nuke"           { Do-Nuke }
    "expose"         { Do-Expose }
    "hide"           { Do-Hide }
    "admin-expose"   { Do-AdminExpose }
    "admin-hide"     { Do-AdminHide }
    "update-version" { Do-UpdateVersion }
    "help"           { Do-Help }
    default {
        Write-Host "Unknown command: $Command" -ForegroundColor Red
        Write-Host "Run '.\make.ps1 help' for available commands."
    }
}
