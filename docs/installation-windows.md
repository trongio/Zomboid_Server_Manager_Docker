# Windows Server Installation (2022 / 2025)

> **Alpha:** Windows support is in alpha. The PowerShell scripts (`make.ps1`, `scripts/setup.ps1`) mirror the Linux Makefile but have not been extensively tested in production. Please report any issues you encounter.

Two options for running on Windows. Pick whichever suits you.

---

## Option A — Native PowerShell (recommended)

PowerShell scripts (`make.ps1`, `scripts/setup.ps1`) are included as drop-in replacements for the Linux Makefile. All you need is Docker Desktop.

### Requirements

| # | Dependency | Link |
|---|-----------|------|
| 1 | **Docker Desktop for Windows** | [Install](https://docs.docker.com/desktop/setup/install/windows-install/) |
| 2 | **Git for Windows** (includes OpenSSL) | [Install](https://git-scm.com/downloads/win) |

> **Important:** In Docker Desktop Settings > General, make sure **"Use the WSL 2 based engine"** is enabled (this is the default). Docker Desktop runs Linux containers via its own WSL integration — you do NOT need to install WSL separately.

### Steps

**1. Clone the repo**

Open PowerShell:
```powershell
git clone https://github.com/YOUR_ORG/zomboid-manager.git
cd zomboid-manager
```

**2. Run the setup wizard**

```powershell
.\make.ps1 init
```

Same interactive wizard as Linux — configures everything, generates secrets, creates certs, and starts all Docker containers.

**3. Open game ports**

```powershell
.\make.ps1 expose
```

This creates Windows Firewall rules automatically.

**4. Access the admin panel**

- **Local:** http://localhost:8000
- **Public:** `.\make.ps1 admin-expose`

### PowerShell command reference

| Command | Description |
|---------|-------------|
| `.\make.ps1 up` | Start all services |
| `.\make.ps1 down` | Stop all services |
| `.\make.ps1 restart` | Restart all services |
| `.\make.ps1 logs` | Follow live logs |
| `.\make.ps1 ps` | Show running containers |
| `.\make.ps1 info` | Show URLs, IP, and firewall status |
| `.\make.ps1 test` | Run the test suite |
| `.\make.ps1 exec "CMD"` | Run command in app container |
| `.\make.ps1 expose` | Open game ports (UDP) |
| `.\make.ps1 hide` | Close game ports (UDP) |
| `.\make.ps1 admin-expose` | Open admin HTTPS ports |
| `.\make.ps1 admin-hide` | Close admin HTTPS ports |
| `.\make.ps1 db-backup` | Backup database |
| `.\make.ps1 db-restore` | Restore latest backup |
| `.\make.ps1 nuke` | Destroy ALL data (danger) |
| `.\make.ps1 help` | Show all commands |

---

## Option B — WSL2 (use Linux commands on Windows)

If you prefer the Linux Makefile and bash scripts directly, install WSL2 and run everything inside Ubuntu.

### Steps

**1. Enable WSL2**

Open PowerShell as Administrator:
```powershell
wsl --install -d Ubuntu-24.04
```

Reboot when prompted, then open "Ubuntu" from Start Menu to finish setup (pick a username and password).

**2. Install Docker Engine inside WSL** (not Docker Desktop)

Inside the Ubuntu WSL terminal:
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

Close and reopen the Ubuntu terminal.

**3. Start Docker daemon**

```bash
sudo service docker start
```

To make Docker start automatically, add this to `~/.bashrc`:
```bash
[ -z "$(pgrep dockerd)" ] && sudo service docker start >/dev/null 2>&1
```

**4. Clone and run (same as Linux)**

```bash
git clone https://github.com/YOUR_ORG/zomboid-manager.git
cd zomboid-manager
make init
```

**5. Open ports in Windows Firewall**

Back in PowerShell (as Admin):
```powershell
netsh advfirewall firewall add rule name="PZ Game UDP" dir=in action=allow protocol=UDP localport=16261-16262
netsh advfirewall firewall add rule name="PZ Admin HTTPS" dir=in action=allow protocol=TCP localport=443
```

> **Note:** `make expose` / `make admin-expose` manage the Linux firewall inside WSL. You ALSO need the Windows Firewall rules above for external access.

**6. WSL port forwarding (if needed)**

WSL2 uses a virtual network. If external clients can't reach the server, forward ports from Windows to WSL:

```powershell
netsh interface portproxy add v4tov4 listenport=16261 listenaddress=0.0.0.0 connectport=16261 connectaddress=$(wsl hostname -I)
```

Repeat for ports 16262, 80, and 443.

> **Tip:** Everything after step 2 happens inside the WSL Ubuntu terminal. Treat it like a regular Linux machine.
