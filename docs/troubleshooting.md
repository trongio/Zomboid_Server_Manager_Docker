# Troubleshooting

## "Permission denied" on Docker commands

Make sure your user is in the docker group:
```bash
sudo usermod -aG docker $USER
```
Then **log out and back in**.

## Containers keep restarting

```bash
make logs    # or .\make.ps1 logs on Windows
```

The game server takes a few minutes to download via SteamCMD on first launch. Be patient.

## Can't connect in-game

1. Check your public IP: `make info`
2. Make sure you ran: `make expose`
3. Check cloud firewall rules (see [Cloud Provider Notes](#cloud-provider-notes))
4. Verify the server is running: `make ps`
5. On Windows, ensure Windows Firewall rules are set (see [Windows guide](installation-windows.md))

## Admin panel not loading

1. Check local access: http://localhost:8000
2. For remote access, make sure you ran: `make admin-expose`
3. Check cloud firewall for ports 80/443
4. Check logs: `make logs`

## Want to start fresh

```bash
make nuke    # WARNING: deletes everything
make init
```

## Cloud Provider Notes

If running on a cloud VM (Oracle Cloud, AWS, GCP, etc.), you also need to open these ports in your cloud provider's **security group / firewall rules**:

| Port | Protocol | Purpose |
|------|----------|---------|
| 16261 | UDP | Game traffic |
| 16262 | UDP | Direct connection |
| 443 | TCP | Admin panel HTTPS (only if using `admin-expose`) |
| 80 | TCP | HTTP redirect (only if using `admin-expose`) |

The host firewall commands (`make expose` / `make admin-expose`) only affect the OS-level firewall. Cloud firewalls are separate.

## Minimum Hardware

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 2 cores | 4 cores |
| RAM | 4 GB | 8 GB |
| Disk | 20 GB free | 30 GB+ |
| OS | Ubuntu 22.04+, Debian 12+, Fedora 38+ | Any modern Linux with Docker |

The PZ game server alone needs 2-4 GB of RAM. On Windows, this stack requires a Linux container backend. Windows Server 2022/2025 is not supported in Windows-container mode.
