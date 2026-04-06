#Requires -Version 5.1
<#
.SYNOPSIS
    Zomboid Manager — First-Time Setup Wizard (Windows)
.DESCRIPTION
    PowerShell equivalent of scripts/setup.sh.
    Interactive wizard: configures env, creates DB volume, starts services,
    and provisions the admin account. Safe to re-run (prompts before overwrite).
.NOTES
    Requires Docker CLI + Compose with a Linux container backend.
    Run from the project root: .\scripts\setup.ps1
    Or via: .\make.ps1 init
#>

$ErrorActionPreference = "Continue"
Set-Location (Split-Path $PSScriptRoot -Parent)

# ── Helpers ──────────────────────────────────────────────────────────

function Write-Banner {
    Write-Host ""
    Write-Host "==============================================  " -ForegroundColor Cyan
    Write-Host "  Zomboid Manager - First-Time Setup            " -ForegroundColor Cyan
    Write-Host "==============================================  " -ForegroundColor Cyan
    Write-Host ""
}

function Write-Section {
    param([string]$Title)
    Write-Host ""
    Write-Host "-- $Title --" -ForegroundColor White
}

function Read-Prompt {
    param(
        [string]$Label,
        [string]$Default = "",
        [switch]$Secret
    )
    if ($Secret) {
        Write-Host "  $Label [hidden]: " -NoNewline -ForegroundColor Gray
        $secure = Read-Host -AsSecureString
        $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        $value = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    } elseif ($Default) {
        $value = Read-Host "  $Label [$Default]"
    } else {
        $value = Read-Host "  $Label"
    }
    if ([string]::IsNullOrEmpty($value)) { return $Default }
    return $value
}

function New-Secret {
    param([int]$Length = 24)
    $bytes = New-Object byte[] ($Length * 2)
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $raw = [Convert]::ToBase64String($bytes) -replace '[^A-Za-z0-9]', ''
    return $raw.Substring(0, [Math]::Min($Length, $raw.Length))
}

function New-AppKey {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return [Convert]::ToBase64String($bytes)
}

function Set-EnvValue {
    param([string]$Content, [string]$Key, [string]$Value)
    $escapedKey = [regex]::Escape($Key)
    # In -replace, $ in the replacement is a backreference — escape it
    $safeValue = $Value -replace '\$', '$$'
    return $Content -replace "(?m)^${escapedKey}=.*", "${Key}=${safeValue}"
}

function Write-FileUtf8NoBom {
    param([string]$Path, [string]$Content)
    $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
    $normalized = $Content -replace "`r`n", "`n"
    [System.IO.File]::WriteAllText($Path, $normalized, $utf8NoBom)
}

function Get-DetectedIPv4Addresses {
    $addresses = @()

    try {
        $addresses = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
            Where-Object {
                $_.IPAddress -ne "127.0.0.1" -and
                $_.IPAddress -notmatch "^172\." -and
                $_.IPAddress -notmatch "^169\.254\."
            } |
            Select-Object -ExpandProperty IPAddress
    } catch {
        $ipconfigOutput = ipconfig 2>$null
        if ($ipconfigOutput) {
            $addresses = $ipconfigOutput |
                Select-String -Pattern 'IPv4[^:]*:\s*([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+)' |
                ForEach-Object { $_.Matches[0].Groups[1].Value } |
                Where-Object {
                    $_ -ne "127.0.0.1" -and
                    $_ -notmatch "^172\." -and
                    $_ -notmatch "^169\.254\."
                }
        }
    }

    return @($addresses | Sort-Object -Unique)
}

function Test-AddressBelongsToServer {
    param(
        [string]$Address,
        [string]$PublicIp,
        [string[]]$LocalIps
    )

    if ($PublicIp -and $Address -eq $PublicIp) { return $true }
    return $LocalIps -contains $Address
}

function Assert-DockerEnvironment {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Host "ERROR: Docker CLI was not found in PATH." -ForegroundColor Red
        exit 1
    }

    docker compose version 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Docker Compose v2 is required." -ForegroundColor Red
        exit 1
    }

    $serverOs = (docker version --format "{{.Server.Os}}" 2>$null | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($serverOs)) {
        Write-Host "ERROR: Docker is not reachable. Start your Docker backend and try again." -ForegroundColor Red
        exit 1
    }

    if ($serverOs -ne "linux") {
        Write-Host "ERROR: This stack requires Linux containers. Current Docker server OS: $serverOs." -ForegroundColor Red
        Write-Host "       Windows container mode is not supported." -ForegroundColor Yellow
        exit 1
    }
}

function Invoke-CompatibleWebRequest {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Uri,

        [int]$TimeoutSec = 5,

        [string]$Method = "Get"
    )

    $params = @{
        Uri         = $Uri
        TimeoutSec  = $TimeoutSec
        ErrorAction = "Stop"
        Method      = $Method
    }

    if ($PSVersionTable.PSEdition -eq "Desktop") {
        $params.UseBasicParsing = $true
    }

    return Invoke-WebRequest @params
}

$GENERATE_SELF_SIGNED = $false

# ── Architecture detection ──────────────────────────────────────────
$procArch = [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture
if ($procArch -eq [System.Runtime.InteropServices.Architecture]::Arm64) {
    $ARCH = "aarch64"
    $ARCH_LABEL = "aarch64 (ARM64)"
} else {
    $ARCH = "x86_64"
    $ARCH_LABEL = "x86_64 (AMD64)"
}
$ARCH_FILE = if ($ARCH -eq "aarch64") { "docker-compose.arm64.yml" } else { "docker-compose.amd64.yml" }
$ComposeArgs = @("compose", "-f", "docker-compose.yml", "-f", $ARCH_FILE)

Assert-DockerEnvironment

# ── Guard: existing .env ────────────────────────────────────────────
if ((Test-Path ".env") -or (Test-Path "app\.env")) {
    Write-Host ""
    Write-Host "Existing .env file(s) detected." -ForegroundColor Yellow
    $overwrite = Read-Host "  Overwrite and reconfigure? [y/N]"
    if ($overwrite.ToLower() -ne "y") {
        Write-Host "Cancelled."
        exit 0
    }
    Write-Host ""
}

# ══════════════════════════════════════════════════════════════════════
# Interactive prompts
# ══════════════════════════════════════════════════════════════════════
Write-Banner

# ── Environment ─────────────────────────────────────────────────────
Write-Section "Environment"
do {
    Write-Host "  1) Production  (recommended for real servers)"
    Write-Host "  2) Development (debug mode, Vite dev server)"
    $envChoice = Read-Host "  [1]"
    if ([string]::IsNullOrEmpty($envChoice)) { $envChoice = "1" }
} while ($envChoice -notin @("1", "2"))

if ($envChoice -eq "2") {
    $APP_ENV = "local"; $APP_DEBUG = "true"; $LOG_LEVEL = "debug"
    $SESSION_ENCRYPT = "false"
    $ROOT_TEMPLATE = ".env.example"; $APP_TEMPLATE = "app\.env.example"
} else {
    $APP_ENV = "production"; $APP_DEBUG = "false"; $LOG_LEVEL = "warning"
    $SESSION_ENCRYPT = "true"
    $ROOT_TEMPLATE = ".env.production.example"; $APP_TEMPLATE = "app\.env.production.example"
}

# ── Web Admin Account ──────────────────────────────────────────────
Write-Section "Web Admin Account"
$ADMIN_USERNAME = Read-Prompt "Username" "admin"

$DEFAULT_ADMIN_PASS = New-Secret 16
Write-Host "  Password [auto-generated]: " -NoNewline -ForegroundColor Gray
$secPass = Read-Host -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPass)
$ADMIN_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
if ([string]::IsNullOrEmpty($ADMIN_PASSWORD)) {
    $ADMIN_PASSWORD = $DEFAULT_ADMIN_PASS
    $ADMIN_PASS_GENERATED = $true
} else {
    $ADMIN_PASS_GENERATED = $false
}

$ADMIN_EMAIL = Read-Prompt "Email (optional, press Enter to skip)" ""

# ── Game Server ─────────────────────────────────────────────────────
Write-Section "Game Server"
$PZ_SERVER_NAME = Read-Prompt "Server name" "ZomboidServer"
$PZ_MAX_PLAYERS = Read-Prompt "Max players" "16"
$PZ_MAX_RAM = Read-Prompt "Max RAM" "4096m"

Write-Host "  Steam branch:"
do {
    Write-Host "    1) public   - Stable release (recommended)"
    Write-Host "    2) unstable - Latest unstable/experimental"
    Write-Host "    3) Custom   - Enter a branch name manually"
    $branchChoice = Read-Host "  [1]"
    if ([string]::IsNullOrEmpty($branchChoice)) { $branchChoice = "1" }
} while ($branchChoice -notin @("1", "2", "3"))

switch ($branchChoice) {
    "1" { $PZ_STEAM_BRANCH = "public" }
    "2" { $PZ_STEAM_BRANCH = "unstable" }
    "3" {
        $PZ_STEAM_BRANCH = Read-Prompt "Branch name" "public"
    }
}

$PZ_SERVER_PASSWORD = Read-Prompt "Server password (empty = open)" ""

# ── Web Panel (HTTPS via Caddy) ─────────────────────────────────────
Write-Section "Web Panel (HTTPS)"

Write-Host "  Detecting server public IP..." -ForegroundColor DarkGray
$SERVER_IP = try { (Invoke-CompatibleWebRequest -Uri "https://api.ipify.org" -TimeoutSec 5).Content.Trim() } catch { "" }
if ($SERVER_IP) {
    Write-Host "  Detected: $SERVER_IP" -ForegroundColor DarkGray
} else {
    Write-Host "  Could not detect public IP (no internet or behind NAT)." -ForegroundColor Yellow
}

$APP_PORT = "8000"
$CADDY_HTTP_PORT = "80"
$CADDY_HTTPS_PORT = "443"
$ADMIN_PUBLIC_ENABLED = $false

Write-Host ""
$enablePublic = Read-Host "  Enable public admin access (via Caddy reverse proxy)? [y/N]"
if ([string]::IsNullOrEmpty($enablePublic)) { $enablePublic = "n" }

if ($enablePublic.ToLower() -ne "y") {
    # Local-only mode
    $SITE_HOST = "localhost"
    $APP_URL = "https://localhost"
    $CADDY_SITE = "localhost"
    $CADDY_TLS = "`ttls internal"
    Write-Host "  Panel will be available locally at https://localhost" -ForegroundColor Green
} else {
    $ADMIN_PUBLIC_ENABLED = $true

    # ── Hostname / Domain / IP ──────────────────────────────────────
    $accessDone = $false
    while (-not $accessDone) {
        Write-Host ""
        Write-Host "  How will you access the panel?"
        Write-Host "  1) Domain name  (e.g., zomboid.example.com - auto Let's Encrypt)"
        Write-Host "  2) IP address   (public or LAN - self-signed cert)"
        $accessChoice = Read-Host "  [2]"
        if ([string]::IsNullOrEmpty($accessChoice)) { $accessChoice = "2" }
        if ($accessChoice -notin @("1", "2")) {
            Write-Host "  Invalid choice. Enter 1 or 2." -ForegroundColor Red
            continue
        }

        switch ($accessChoice) {
            "1" {
                # Domain mode
                while ($true) {
                    $SITE_HOST = Read-Prompt "Domain name" ""
                    if ($SITE_HOST -and $SITE_HOST -match "^[a-zA-Z0-9]([a-zA-Z0-9._-]*[a-zA-Z0-9])?$") { break }
                    Write-Host "  Invalid domain name. Try again." -ForegroundColor Red
                }
                # DNS pre-check
                try {
                    $dnsResult = Resolve-DnsName -Name $SITE_HOST -Type A -ErrorAction Stop
                    $DOMAIN_IP = ($dnsResult | Where-Object { $_.QueryType -eq "A" } | Select-Object -First 1).IPAddress
                } catch {
                    $DOMAIN_IP = ""
                }
                if (-not $DOMAIN_IP) {
                    Write-Host "  $SITE_HOST does not resolve to any IP address." -ForegroundColor Red
                    Write-Host "  Let's Encrypt requires DNS to be configured first." -ForegroundColor Red
                    continue
                } elseif ($SERVER_IP -and $DOMAIN_IP -ne $SERVER_IP) {
                    Write-Host "  $SITE_HOST resolves to $DOMAIN_IP, but this server's public IP is $SERVER_IP." -ForegroundColor Red
                    Write-Host "  Let's Encrypt will fail unless the domain points to this server." -ForegroundColor Red
                    continue
                } else {
                    Write-Host "  $SITE_HOST resolves to $DOMAIN_IP" -ForegroundColor Green
                }
                $APP_URL = "https://$SITE_HOST"
                $CADDY_SITE = $SITE_HOST
                $CADDY_TLS = ""
                $accessDone = $true
            }
            "2" {
                # IP mode — collect addresses
                $IP_OPTIONS = @()
                $IP_LABELS = @()
                if ($SERVER_IP) {
                    $IP_OPTIONS += $SERVER_IP
                    $IP_LABELS += "$SERVER_IP  (public)"
                }
                $localIps = @(Get-DetectedIPv4Addresses | Where-Object { $_ -ne $SERVER_IP })
                foreach ($ip in $localIps) {
                    $IP_OPTIONS += $ip
                    $IP_LABELS += "$ip  (LAN)"
                }

                if ($IP_OPTIONS.Count -gt 0) {
                    Write-Host ""
                    Write-Host "  Detected addresses:"
                    for ($i = 0; $i -lt $IP_OPTIONS.Count; $i++) {
                        Write-Host "    $($i+1)) $($IP_LABELS[$i])"
                    }
                    Write-Host "    $($IP_OPTIONS.Count + 1)) Enter manually"
                    $ipPick = Read-Host "  [1]"
                    if ([string]::IsNullOrEmpty($ipPick)) { $ipPick = "1" }

                    if ($ipPick -match "^\d+$" -and [int]$ipPick -ge 1 -and [int]$ipPick -le $IP_OPTIONS.Count) {
                        $SITE_HOST = $IP_OPTIONS[[int]$ipPick - 1]
                    } else {
                        # Manual entry with server ownership validation
                        while ($true) {
                            $SITE_HOST = Read-Prompt "IP address" ""
                            if ($SITE_HOST -notmatch "^\d+\.\d+\.\d+\.\d+$") {
                                Write-Host "  Invalid IP address. Try again." -ForegroundColor Red
                                continue
                            }

                            if (Test-AddressBelongsToServer -Address $SITE_HOST -PublicIp $SERVER_IP -LocalIps $localIps) {
                                if ($SERVER_IP -and $SITE_HOST -eq $SERVER_IP) {
                                    Write-Host "  Matches server public IP" -ForegroundColor Green
                                } else {
                                    Write-Host "  Matches local network interface" -ForegroundColor Green
                                }
                                break
                            }

                            Write-Host "  $SITE_HOST is not assigned to this server." -ForegroundColor Yellow
                            if ($SERVER_IP) {
                                Write-Host "  Public IP: $SERVER_IP | Local IPs: $($localIps -join ', ')" -ForegroundColor Yellow
                            } elseif ($localIps.Count -gt 0) {
                                Write-Host "  Local IPs: $($localIps -join ', ')" -ForegroundColor Yellow
                            }

                            $forceIp = Read-Host "  Use anyway? [y/N]"
                            if ($forceIp.ToLower() -eq "y") { break }
                        }
                    }
                } else {
                    # No IPs detected — manual entry with server ownership validation
                    $localIps = @(Get-DetectedIPv4Addresses)
                    while ($true) {
                        $SITE_HOST = Read-Prompt "Server IP address" ""
                        if ($SITE_HOST -notmatch "^\d+\.\d+\.\d+\.\d+$") {
                            Write-Host "  Invalid IP address. Try again." -ForegroundColor Red
                            continue
                        }

                        if (Test-AddressBelongsToServer -Address $SITE_HOST -PublicIp $SERVER_IP -LocalIps $localIps) {
                            if ($SERVER_IP -and $SITE_HOST -eq $SERVER_IP) {
                                Write-Host "  Matches server public IP" -ForegroundColor Green
                            } else {
                                Write-Host "  Matches local network interface" -ForegroundColor Green
                            }
                            break
                        }

                        Write-Host "  $SITE_HOST is not assigned to this server." -ForegroundColor Yellow
                        if ($SERVER_IP) {
                            Write-Host "  Public IP: $SERVER_IP | Local IPs: $($localIps -join ', ')" -ForegroundColor Yellow
                        } elseif ($localIps.Count -gt 0) {
                            Write-Host "  Local IPs: $($localIps -join ', ')" -ForegroundColor Yellow
                        }

                        $forceIp = Read-Host "  Use anyway? [y/N]"
                        if ($forceIp.ToLower() -eq "y") { break }
                    }
                }

                Write-Host "  Using $SITE_HOST" -ForegroundColor Green
                $APP_URL = "https://$SITE_HOST"
                $CADDY_SITE = ":443"
                $CADDY_TLS = "`ttls /etc/caddy/certs/cert.pem /etc/caddy/certs/key.pem"
                $GENERATE_SELF_SIGNED = $true
                $accessDone = $true
            }
        }
    }

    # ── Caddy Ports ─────────────────────────────────────────────────
    Write-Host ""
    Write-Host "  Caddy listening ports" -ForegroundColor White
    Write-Host "  Caddy is the reverse proxy that handles HTTPS for the admin panel." -ForegroundColor DarkGray
    Write-Host "  Default is 80 (HTTP redirect) and 443 (HTTPS)." -ForegroundColor DarkGray

    $BLOCKED_PORTS = @(21, 22, 23, 25, 53, 110, 143, 445, 465, 587, 993, 995, 3306, 5432, 6379)

    # HTTPS port
    while ($true) {
        $portInput = Read-Host "  HTTPS port [443]"
        if ([string]::IsNullOrEmpty($portInput)) { $portInput = "443" }
        $CADDY_HTTPS_PORT = $portInput

        if ($CADDY_HTTPS_PORT -notmatch "^\d+$" -or [int]$CADDY_HTTPS_PORT -lt 1 -or [int]$CADDY_HTTPS_PORT -gt 65535) {
            Write-Host "  Invalid port number." -ForegroundColor Red; continue
        }
        if ([int]$CADDY_HTTPS_PORT -in $BLOCKED_PORTS) {
            Write-Host "  Port $CADDY_HTTPS_PORT is a well-known service port and cannot be used here." -ForegroundColor Red; continue
        }
        if ([int]$CADDY_HTTPS_PORT -lt 1024 -and [int]$CADDY_HTTPS_PORT -ne 443) {
            Write-Host "  Warning: Port $CADDY_HTTPS_PORT is a privileged port (< 1024)." -ForegroundColor Yellow
            $privOk = Read-Host "  Continue? [Y/n]"
            if ($privOk.ToLower() -eq "n") { continue }
        }
        break
    }

    # HTTP port
    while ($true) {
        $portInput = Read-Host "  HTTP port (for redirect to HTTPS) [80]"
        if ([string]::IsNullOrEmpty($portInput)) { $portInput = "80" }
        $CADDY_HTTP_PORT = $portInput

        if ($CADDY_HTTP_PORT -notmatch "^\d+$" -or [int]$CADDY_HTTP_PORT -lt 1 -or [int]$CADDY_HTTP_PORT -gt 65535) {
            Write-Host "  Invalid port number." -ForegroundColor Red; continue
        }
        if ([int]$CADDY_HTTP_PORT -in $BLOCKED_PORTS) {
            Write-Host "  Port $CADDY_HTTP_PORT is a well-known service port and cannot be used here." -ForegroundColor Red; continue
        }
        if ($CADDY_HTTP_PORT -eq $CADDY_HTTPS_PORT) {
            Write-Host "  HTTP and HTTPS ports must be different." -ForegroundColor Red; continue
        }
        if ([int]$CADDY_HTTP_PORT -lt 1024 -and [int]$CADDY_HTTP_PORT -ne 80) {
            Write-Host "  Warning: Port $CADDY_HTTP_PORT is a privileged port (< 1024)." -ForegroundColor Yellow
            $privOk = Read-Host "  Continue? [Y/n]"
            if ($privOk.ToLower() -eq "n") { continue }
        }
        break
    }

    # Router conflict warning
    if ([int]$CADDY_HTTP_PORT -eq 80 -or [int]$CADDY_HTTPS_PORT -eq 443) {
        Write-Host ""
        Write-Host "  Warning: Some routers use ports 80/443 for their WAN remote management UI." -ForegroundColor Yellow
        Write-Host "  If enabled, your router will intercept traffic before it reaches your server." -ForegroundColor Yellow
        Write-Host "  Fix: disable Remote Management / WAN Admin, move the router admin UI to another port," -ForegroundColor DarkGray
        Write-Host "       or choose custom Caddy ports here (for example 8080/8443)." -ForegroundColor DarkGray
    }

    Write-Host "  Caddy will listen on ports $CADDY_HTTP_PORT (HTTP) and $CADDY_HTTPS_PORT (HTTPS)" -ForegroundColor Green

    # Update APP_URL with non-standard HTTPS port
    if ([int]$CADDY_HTTPS_PORT -ne 443) {
        $APP_URL = "https://${SITE_HOST}:${CADDY_HTTPS_PORT}"
    }

    # Let's Encrypt warning
    if ($accessChoice -eq "1" -and ([int]$CADDY_HTTP_PORT -ne 80 -or [int]$CADDY_HTTPS_PORT -ne 443)) {
        Write-Host ""
        Write-Host "  Warning: Let's Encrypt HTTP challenge requires ports 80 and 443." -ForegroundColor Yellow
        Write-Host "  Non-standard ports may prevent automatic certificate issuance." -ForegroundColor Yellow
        Write-Host "  Consider using standard ports with a domain, or switch to IP mode." -ForegroundColor Yellow
    }
}

# ── Firewall Detection (Windows Firewall) ───────────────────────────
if (-not $SITE_HOST) { $SITE_HOST = "localhost" }

# Write .firewall.conf for make.ps1 to read
$firewallConf = @"
FIREWALL_BACKEND=windows
FIREWALL_OS=windows
FIREWALL_ZONE=
CADDY_ENABLED=$( if ($ADMIN_PUBLIC_ENABLED) { "true" } else { "false" } )
ADMIN_PUBLIC_HOST=$SITE_HOST
ADMIN_HTTP_PORT=$CADDY_HTTP_PORT
ADMIN_HTTPS_PORT=$CADDY_HTTPS_PORT
"@
Write-FileUtf8NoBom ".firewall.conf" $firewallConf

# ══════════════════════════════════════════════════════════════════════
# Summary
# ══════════════════════════════════════════════════════════════════════
Write-Section "Summary"
Write-Host ""
Write-Host "  Environment:  $APP_ENV" -ForegroundColor Green
Write-Host "  Admin:        $ADMIN_USERNAME" -ForegroundColor Green
Write-Host "  Server:       $PZ_SERVER_NAME" -ForegroundColor Green
Write-Host "  Players:      $PZ_MAX_PLAYERS / RAM: $PZ_MAX_RAM" -ForegroundColor Green
Write-Host "  Branch:       $PZ_STEAM_BRANCH" -ForegroundColor Green
if ($ADMIN_PUBLIC_ENABLED) {
    Write-Host "  Panel:        $APP_URL (HTTPS via Caddy, ports $CADDY_HTTP_PORT/$CADDY_HTTPS_PORT)" -ForegroundColor Green
} else {
    Write-Host "  Panel:        http://localhost:$APP_PORT (local only)" -ForegroundColor Green
}
Write-Host "  Architecture: $ARCH_LABEL" -ForegroundColor Green
Write-Host "  Firewall:     Windows Firewall" -ForegroundColor Green
Write-Host ""
$proceed = Read-Host "  Proceed? [Y/n]"
if ($proceed.ToLower() -eq "n") {
    Write-Host "Cancelled."
    exit 0
}

# ══════════════════════════════════════════════════════════════════════
# Generate secrets
# ══════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "Generating secrets..." -ForegroundColor White

$DB_PASS = New-Secret 24
$RCON_PASS = New-Secret 16
$PZ_ADMIN_PASS = New-Secret 16
$API_SECRET = New-Secret 48
$APP_SECRET = New-AppKey
$REDIS_PASS = New-Secret 20

# ══════════════════════════════════════════════════════════════════════
# Generate self-signed certificate (IP mode only)
# ══════════════════════════════════════════════════════════════════════
if (-not (Test-Path "caddy\certs")) { New-Item -ItemType Directory -Path "caddy\certs" -Force | Out-Null }

if ($GENERATE_SELF_SIGNED) {
    Remove-Item -Force -ErrorAction SilentlyContinue "caddy\certs\cert.pem", "caddy\certs\key.pem"

    Write-Host "Generating self-signed certificate for $SITE_HOST..."

    # Check if openssl is available (comes with Git for Windows, or install separately)
    $opensslCmd = Get-Command openssl -ErrorAction SilentlyContinue
    if (-not $opensslCmd) {
        # Try Git's bundled OpenSSL
        $gitCmd = Get-Command git -ErrorAction SilentlyContinue
        if ($gitCmd) {
            $gitDir = Split-Path (Split-Path $gitCmd.Source -Parent) -Parent
            $opensslAlt = Join-Path $gitDir "usr\bin\openssl.exe"
            if (Test-Path $opensslAlt) { $opensslCmd = $opensslAlt }
        }
    }

    if ($opensslCmd) {
        $opensslExe = if ($opensslCmd -is [string]) { $opensslCmd } else { $opensslCmd.Source }
        try {
            & $opensslExe req -x509 -newkey rsa:2048 `
                -keyout "caddy\certs\key.pem" -out "caddy\certs\cert.pem" `
                -days 3650 -nodes `
                -subj "/CN=$SITE_HOST" `
                -addext "subjectAltName=IP:$SITE_HOST" 2>&1 | Out-Null
            Write-Host "  Certificate generated." -ForegroundColor Green
        } catch {
            # Fallback without -addext (older OpenSSL)
            & $opensslExe req -x509 -newkey rsa:2048 `
                -keyout "caddy\certs\key.pem" -out "caddy\certs\cert.pem" `
                -days 3650 -nodes `
                -subj "/CN=$SITE_HOST" 2>&1 | Out-Null
            Write-Host "  Certificate generated (without SAN extension)." -ForegroundColor Yellow
        }
    } else {
        Write-Host "  ERROR: OpenSSL not found." -ForegroundColor Red
        Write-Host "  Install Git for Windows (includes OpenSSL):" -ForegroundColor Yellow
        Write-Host "    https://git-scm.com/downloads/win" -ForegroundColor DarkGray
        Write-Host "  Then re-run: .\make.ps1 init" -ForegroundColor DarkGray
        exit 1
    }
} else {
    Remove-Item -Force -ErrorAction SilentlyContinue "caddy\certs\cert.pem", "caddy\certs\key.pem"
}

# ══════════════════════════════════════════════════════════════════════
# Generate Caddyfile
# ══════════════════════════════════════════════════════════════════════
Write-Host "Creating caddy\Caddyfile..."
if ($GENERATE_SELF_SIGNED) {
    $caddyfile = @"
{
`t# Managed by setup.ps1 -- edit freely or re-run .\make.ps1 init
}

$CADDY_SITE {
$CADDY_TLS
`treverse_proxy app:8000
}

:80 {
`tredir https://{host}{uri} permanent
}
"@
} else {
    $caddyfile = @"
{
`t# Managed by setup.ps1 -- edit freely or re-run .\make.ps1 init
}

$CADDY_SITE {
$CADDY_TLS
`treverse_proxy app:8000
}

http://$CADDY_SITE {
`tredir https://${CADDY_SITE}{uri} permanent
}
"@
}
Write-FileUtf8NoBom "caddy\Caddyfile" $caddyfile

# Update .firewall.conf with the current CADDY_ENABLED state
if (Test-Path ".firewall.conf") {
    $fwContent = Get-Content ".firewall.conf" -Raw
    $fwValue = if ($ADMIN_PUBLIC_ENABLED) { "true" } else { "false" }
    $fwContent = $fwContent -replace "CADDY_ENABLED=.*", "CADDY_ENABLED=$fwValue"
    Write-FileUtf8NoBom ".firewall.conf" $fwContent
}

# ══════════════════════════════════════════════════════════════════════
# Generate .env files
# ══════════════════════════════════════════════════════════════════════
Write-Host "Creating .env from $ROOT_TEMPLATE..."

$rootEnv = Get-Content $ROOT_TEMPLATE -Raw
$rootEnv = Set-EnvValue $rootEnv "PZ_SERVER_NAME" $PZ_SERVER_NAME
$rootEnv = Set-EnvValue $rootEnv "PZ_ADMIN_PASSWORD" $PZ_ADMIN_PASS
$rootEnv = Set-EnvValue $rootEnv "PZ_SERVER_PASSWORD" $PZ_SERVER_PASSWORD
$rootEnv = Set-EnvValue $rootEnv "PZ_MAX_PLAYERS" $PZ_MAX_PLAYERS
$rootEnv = Set-EnvValue $rootEnv "PZ_MAX_RAM" $PZ_MAX_RAM
$rootEnv = Set-EnvValue $rootEnv "PZ_RCON_PASSWORD" $RCON_PASS
$rootEnv = Set-EnvValue $rootEnv "PZ_STEAM_BRANCH" $PZ_STEAM_BRANCH
$rootEnv = Set-EnvValue $rootEnv "APP_ENV" $APP_ENV
$rootEnv = Set-EnvValue $rootEnv "APP_KEY" "base64:$APP_SECRET"
$rootEnv = Set-EnvValue $rootEnv "APP_DEBUG" $APP_DEBUG
$rootEnv = Set-EnvValue $rootEnv "APP_URL" $APP_URL
$rootEnv = Set-EnvValue $rootEnv "APP_PORT" $APP_PORT
$rootEnv = Set-EnvValue $rootEnv "CADDY_HTTP_PORT" $CADDY_HTTP_PORT
$rootEnv = Set-EnvValue $rootEnv "CADDY_HTTPS_PORT" $CADDY_HTTPS_PORT
$rootEnv = Set-EnvValue $rootEnv "DB_PASSWORD" $DB_PASS
$rootEnv = Set-EnvValue $rootEnv "REDIS_PASSWORD" $REDIS_PASS
$rootEnv = Set-EnvValue $rootEnv "API_KEY" $API_SECRET
$rootEnv = Set-EnvValue $rootEnv "ADMIN_USERNAME" $ADMIN_USERNAME
$rootEnv = Set-EnvValue $rootEnv "ADMIN_EMAIL" $ADMIN_EMAIL
$rootEnv = Set-EnvValue $rootEnv "ADMIN_PASSWORD" $ADMIN_PASSWORD
Write-FileUtf8NoBom ".env" $rootEnv

Write-Host "Creating app\.env from $APP_TEMPLATE..."

$appEnv = Get-Content $APP_TEMPLATE -Raw
$appEnv = Set-EnvValue $appEnv "PZ_SERVER_NAME" $PZ_SERVER_NAME
$appEnv = Set-EnvValue $appEnv "PZ_RCON_PASSWORD" $RCON_PASS
$appEnv = Set-EnvValue $appEnv "APP_ENV" $APP_ENV
$appEnv = Set-EnvValue $appEnv "APP_KEY" "base64:$APP_SECRET"
$appEnv = Set-EnvValue $appEnv "APP_DEBUG" $APP_DEBUG
$appEnv = Set-EnvValue $appEnv "APP_URL" $APP_URL
$appEnv = Set-EnvValue $appEnv "DB_PASSWORD" $DB_PASS
$appEnv = Set-EnvValue $appEnv "REDIS_PASSWORD" $REDIS_PASS
$appEnv = Set-EnvValue $appEnv "API_KEY" $API_SECRET
$appEnv = Set-EnvValue $appEnv "PZ_ADMIN_PASSWORD" $PZ_ADMIN_PASS
$appEnv = Set-EnvValue $appEnv "ADMIN_USERNAME" $ADMIN_USERNAME
$appEnv = Set-EnvValue $appEnv "ADMIN_EMAIL" $ADMIN_EMAIL
$appEnv = Set-EnvValue $appEnv "ADMIN_PASSWORD" $ADMIN_PASSWORD
$appEnv = Set-EnvValue $appEnv "LOG_LEVEL" $LOG_LEVEL

if ($APP_ENV -eq "production") {
    $appEnv = Set-EnvValue $appEnv "SESSION_ENCRYPT" "true"
    $appEnv = Set-EnvValue $appEnv "SESSION_SECURE_COOKIE" "true"
}
$appEnv = Set-EnvValue $appEnv "LOG_STACK" "daily"
Write-FileUtf8NoBom "app\.env" $appEnv

# ══════════════════════════════════════════════════════════════════════
# Ensure database volume exists
# ══════════════════════════════════════════════════════════════════════
docker volume inspect pz-postgres 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating Postgres volume..."
    docker volume create pz-postgres | Out-Null
}

# ══════════════════════════════════════════════════════════════════════
# Stop existing services and clean stale state
# ══════════════════════════════════════════════════════════════════════
Write-Host ""
Write-Host "Starting services..." -ForegroundColor White
& docker @ComposeArgs down 2>$null

# Remove build/cache volumes (preserve data, DB, backups)
foreach ($vol in @("pz-caddy-data", "pz-caddy-config", "pz-app-vendor", "pz-app-node-modules", "pz-app-build")) {
    docker volume rm $vol 2>$null | Out-Null
}

# Clean leftover stale volumes
$stale = @(docker volume ls -q --filter name=pz-caddy --filter name=pz-app-vendor --filter name=pz-app-node --filter name=pz-app-build 2>$null)
if ($stale) {
    Write-Host "Cleaning leftover volumes..." -ForegroundColor Yellow
    $stale | ForEach-Object { docker volume rm $_ 2>$null | Out-Null }
}

# Start services
& docker @ComposeArgs up -d --build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to start services. Check Docker is running." -ForegroundColor Red
    exit 1
}

# ══════════════════════════════════════════════════════════════════════
# Sync passwords into existing volumes
# ══════════════════════════════════════════════════════════════════════
Write-Host "Syncing database password..."
docker exec pz-db psql -U zomboid -d zomboid -c "ALTER USER zomboid PASSWORD '$DB_PASS';" 2>$null | Out-Null

Write-Host "Syncing Redis password..."
if ($REDIS_PASS) {
    # Try without auth first, then with auth (needed on re-run when Redis already has a password)
    docker exec pz-redis redis-cli CONFIG SET requirepass "$REDIS_PASS" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        docker exec pz-redis redis-cli -a "$REDIS_PASS" CONFIG SET requirepass "$REDIS_PASS" 2>$null | Out-Null
    }
}

Write-Host "Clearing application cache..."
docker exec pz-app php artisan config:clear --no-interaction 2>$null | Out-Null
docker exec pz-app php artisan route:clear --no-interaction 2>$null | Out-Null
docker exec pz-app php artisan view:clear --no-interaction 2>$null | Out-Null

# Admin user
Write-Host "Syncing admin account..."
for ($attempt = 1; $attempt -le 3; $attempt++) {
    $result = docker exec pz-app php artisan zomboid:create-admin --no-interaction 2>&1
    if ($result -match "created|updated|exists") { break }
    Start-Sleep -Seconds 3
}

# ══════════════════════════════════════════════════════════════════════
# Health check
# ══════════════════════════════════════════════════════════════════════
Write-Host "Verifying app is running..."
$HEALTH_OK = $false
for ($attempt = 1; $attempt -le 5; $attempt++) {
    try {
        $response = Invoke-CompatibleWebRequest -Uri "http://localhost:$APP_PORT/" -TimeoutSec 5
        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
            $HEALTH_OK = $true
            break
        }
    } catch {}
    Start-Sleep -Seconds 3
}

# ══════════════════════════════════════════════════════════════════════
# Done
# ══════════════════════════════════════════════════════════════════════
Write-Host ""
if ($HEALTH_OK) {
    Write-Host "==============================================" -ForegroundColor Green
    Write-Host "  Setup complete!" -ForegroundColor Green
    Write-Host "==============================================" -ForegroundColor Green
} else {
    Write-Host "==============================================" -ForegroundColor Yellow
    Write-Host "  Setup complete - but app not responding!" -ForegroundColor Yellow
    Write-Host "==============================================" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  The app container may still be starting up." -ForegroundColor Yellow
    Write-Host "  Check: .\make.ps1 logs" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "  Local Admin:   http://localhost:$APP_PORT"
if ($ADMIN_PUBLIC_ENABLED) {
    Write-Host "  Public Admin:  $APP_URL  (requires '.\make.ps1 admin-expose')"
}
Write-Host "  Admin User:    $ADMIN_USERNAME"
if ($ADMIN_PASS_GENERATED) {
    Write-Host "  Admin Pass:    $ADMIN_PASSWORD" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  Save this password - it won't be shown again." -ForegroundColor Yellow
} else {
    Write-Host "  Admin Pass:    (as entered)"
}
Write-Host ""
Write-Host "  API Key:       $API_SECRET" -ForegroundColor DarkGray
Write-Host ""

# Game server status
$GS_RUNNING = $false
for ($gsAttempt = 1; $gsAttempt -le 3; $gsAttempt++) {
    Write-Host "  Checking game server (attempt $gsAttempt/3)..." -ForegroundColor DarkGray
    Start-Sleep -Seconds 10

    $gsLogs = docker logs pz-game-server 2>&1
    if ($gsLogs -match "FATAL: SteamCMD failed") {
        if ($gsAttempt -lt 3) {
            Write-Host "  Game server: SteamCMD failed - restarting container..." -ForegroundColor Yellow
            docker restart pz-game-server 2>$null | Out-Null
        } else {
            Write-Host "  Game server: SteamCMD failed after 3 container restarts." -ForegroundColor Red
            Write-Host "    Check logs: docker logs pz-game-server" -ForegroundColor DarkGray
        }
        continue
    }

    $gsState = docker inspect --format "{{.State.Status}}" pz-game-server 2>$null
    if ($gsState -eq "running") {
        $GS_RUNNING = $true
        break
    }
}

if ($GS_RUNNING) {
    Write-Host "  Game server: running (SteamCMD download may still be in progress)" -ForegroundColor Green
    Write-Host "    Monitor with: docker logs -f pz-game-server" -ForegroundColor DarkGray
} else {
    Write-Host "  Game server: not running" -ForegroundColor Yellow
    Write-Host "    Check logs: docker logs pz-game-server" -ForegroundColor DarkGray
}
Write-Host ""

# Item icons
docker exec pz-app test -f /lua-bridge/items_catalog.json 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Downloading item icons in background..." -ForegroundColor DarkGray
    docker exec -d pz-app php artisan zomboid:download-item-icons --no-interaction 2>$null
} else {
    Write-Host "Item icons: skipped (catalog not yet exported by game server)" -ForegroundColor DarkGray
    Write-Host "  Run later: .\make.ps1 exec `"php artisan zomboid:download-item-icons`"" -ForegroundColor DarkGray
}
