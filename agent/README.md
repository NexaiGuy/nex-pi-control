# Nex Pi Control agent

The server side of [Nex Pi Control](../README.md). It runs on your Raspberry Pi and consists of two services:

- **hal-agent** (`127.0.0.1:8120`): monitoring, 30 days of statistics and a fixed set of actions. Runs as the system user `halagent`, without sudo, inside a strict systemd sandbox.
- **hal-shell** (`127.0.0.1:8121`): terminal and file manager. Runs as your own user, is off by default and stops by itself after 15 minutes without activity.

Built and tested on a Raspberry Pi 5 with Raspberry Pi OS (64-bit). A Pi 4 or another Debian based system with systemd should work too, but has not been tested yet. GPIO needs a Raspberry Pi.

## Install

One line on your Pi, with the connection method of your choice:

```bash
# Tailscale (recommended): encrypted, works from anywhere, nothing exposed to the internet
curl -fsSL https://raw.githubusercontent.com/NexaiGuy/nex-pi-control/main/install.sh | sudo bash -s -- --tailscale

# Home network only: simplest, unencrypted inside your LAN
curl -fsSL https://raw.githubusercontent.com/NexaiGuy/nex-pi-control/main/install.sh | sudo bash -s -- --lan

# Cloudflare Tunnel + Access: you configure the tunnel yourself, see docs/connect-cloudflare.md
curl -fsSL https://raw.githubusercontent.com/NexaiGuy/nex-pi-control/main/install.sh | sudo bash
```

Prefer to read the code first? Do it by hand:

```bash
git clone --depth 1 https://github.com/NexaiGuy/nex-pi-control.git
cd nex-pi-control/agent && sudo bash setup.sh --tailscale
```

`setup.sh` is idempotent. It:

- never touches UFW, fail2ban, SSH or cloudflared, it only prints what you could add;
- runs a quick SMART check first and stops when a disk shows signs of failure, until you confirm you have a backup;
- generates the tokens and never prints them, they only appear inside the QR code.

At the end it prints the `hal-qr` command. Run it and scan the QR code with the app.

Connection guides: [Tailscale](../docs/connect-tailscale.md), [home network](../docs/connect-lan.md), [Cloudflare](../docs/connect-cloudflare.md).

## Daily use

| What | Command |
|---|---|
| Status | `systemctl status hal-agent` |
| Live logs | `journalctl -u hal-agent -f` |
| Restart | `sudo systemctl restart hal-agent` |
| Measure SMART now | `sudo systemctl start hal-smart-collect` |
| Stop the admin shell | `sudo systemctl stop hal-shell` |
| QR code for the app | `sudo /opt/hal-agent/bin/hal-qr --api <url> [--shell <url>]` |
| Rotate tokens | `sudo /opt/hal-agent/bin/hal-rotate-tokens` |
| After editing allowed-actions.yml or commands.yml | `sudo /opt/hal-agent/bin/hal-apply-config` |
| Check for system updates now | `sudo systemctl start hal-apt-check` |
| Last system update run | `journalctl -u hal-apt-upgrade -n 100 --no-pager` |
| Last agent update run | `journalctl -u hal-agent-update -n 100 --no-pager` |

## Configuration in /etc/hal-agent

| File | Contents |
|---|---|
| `agent.env` | agent token, optional Cloudflare Access team domain and AUD, `HAL_ALLOW_LAN` |
| `shell.env` | shell token, optional AUD for the shell, idle timeout |
| `allowed-actions.yml` | which services may be restarted, reboot and power off, container restarts (`containers`, `container_deny`), system updates (`updates`) and agent updates (`agent_update`). All on by default |
| `commands.yml` | your own commands (the app only ever sends the id) |
| `gpio.yml` | switchable pins and their names |
| `sensors.yml` | DS18B20, DHT (kernel driver), BMP280 |
| `wol.yml` | Wake-on-LAN devices |
| `shell-roots.yml` | folders for the file manager (read only or read write) |
| `sites.yml` | hostnames to check (filled from your cloudflared config on first install, if present) |
| `ports.md` | port registry shown in the app |

The agent reloads `sensors.yml`, `sites.yml`, `gpio.yml` and `wol.yml` automatically. For `allowed-actions.yml` and `commands.yml` run `hal-apply-config`, because those also regenerate the polkit rule.

## Security model

- **Every request is authenticated.** A bearer token (compared in constant time) on every call. Behind Cloudflare, also the Access JWT. In the app, a fingerprint lock on top.
- **Tunnel without Access is refused.** As long as `CF_ACCESS_AUD` is empty, any request that arrives through a Cloudflare tunnel gets a 503. That protects you from publishing the agent by accident.
- **Loopback by default.** The agent only listens on `127.0.0.1`. `--lan` sets `HAL_ALLOW_LAN=1`, which binds to the LAN address and accepts private addresses only.
- **No sudo.** Restarts, your commands, reboot and power off go through polkit. `/etc/polkit-1/rules.d/50-hal-agent.rules` allows exactly the units from your allowlist for `halagent` and explicitly denies everything else.
- **SMART** runs as root in a separate read-only timer. The agent only reads the JSON it writes.
- **Containers** are restarted by a fixed root unit, `hal-container@<name>.service`, which only runs `docker restart` on one existing container. Never stop or remove. The Docker proxy itself stays GET only.
- **System updates:** `hal-apt-check.timer` (every 6 hours) only lists what is available. Installing runs `hal-apt-upgrade.service`: `apt-get upgrade` that keeps your config files and never removes packages. Refused while a disk shows signs of failure.
- **Agent updates:** `hal-agent-update.service` downloads the newest tagged release of this repository from GitHub, installs it with `deploy.sh` (backup first) and checks that the agent comes back healthy with the new version. If not, it rolls back automatically. The agent only asks GitHub when you open the Updates screen (cached for 6 hours). Set `HAL_UPDATE_CHECK=0` in `agent.env` to turn this off, or `HAL_UPDATE_REPO=owner/repo` to use your own fork.
- **Alerts:** every 30 seconds the agent compares the state with the previous one and keeps a log of new and resolved problems (disk, services, containers, sites, security updates) for 30 days. The app fetches it, there is no push server.
- **Docker** is reached through `docker-socket-proxy`, which only allows GET. The agent filters with an allowlist, so `Env`, mounts and labels with secrets never leave the Pi.
- **Processes:** passwords and tokens in command lines are masked.
- **Terminal:** every typed line goes to the audit log (journald, identifier `hal-shell-audit`). Password prompts are logged as `[hidden input]`. Sudo in the terminal asks for your own password.
- **Rate limits:** 120 reads, 5 actions and 30 GPIO actions per minute.

Found a security issue? See [SECURITY.md](../SECURITY.md).

## Update

From the app: More, Updates, Update to x.y.z (agent 1.2.0 and newer). Or run the install line again, or from a clone:

```bash
git pull && sudo bash agent/deploy.sh
```

`deploy.sh` backs up to `/opt/hal-agent-backups/premigrate-<time>/` first, replaces only the files that changed, restarts `hal-agent` only when the code changed and never touches your configuration or tokens.

## Roll back

```bash
sudo bash /opt/hal-agent/rollback.sh                                          # lists the backups
sudo bash /opt/hal-agent/rollback.sh /opt/hal-agent-backups/premigrate-20260927-140000
```

## Lost your phone?

1. Behind Cloudflare: revoke the service token in Zero Trust, Access, Service Auth.
2. Run `sudo /opt/hal-agent/bin/hal-rotate-tokens`. The old tokens stop working immediately.
3. On your new phone, scan a fresh QR code from `hal-qr`.

## Develop without a Pi (mock mode)

```bash
cd agent && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements-dev.txt
HAL_AGENT_MOCK=1 python -m hal_agent                                  # token: mock-token-for-local-development-only-000000
HAL_AGENT_MOCK=1 HAL_AGENT_MOCK_SCENARIO=disk python -m hal_agent     # failing disk scenario
HAL_SHELL_MOCK=1 python -m hal_shell                                  # token: mock-shell-token-for-local-development-00000
python -m pytest -q tests
```

Scenarios: `ok`, `demo`, `disk` (failing /dev/sda) and `busy` (hot CPU, throttling, failed service). In mock mode the API docs are at `http://127.0.0.1:8120/docs`. `python scripts/export_demo.py ../app/src/demo` refreshes the demo data built into the app.

## What lives where on the Pi

| Path | Owner | Purpose |
|---|---|---|
| `/opt/hal-agent` | root, 0755 | code, venv, helper scripts |
| `/etc/hal-agent` | root, files 0640 | configuration and tokens |
| `/var/lib/hal-agent` | halagent, 0750 | statistics (SQLite), audit log |
| `/var/lib/hal-agent/smart` | root:halagent, 0750 | SMART JSON from the timer |
| `/var/lib/hal-agent/apt` | root:halagent, 0750 | available system updates from the timer |
| `/var/cache/hal-agent-update` | root, 0700 | download of an agent update (removed after success) |
| `/etc/systemd/system/hal-*` | root | units, plus drop-in `hal-agent.service.d/10-hardware.conf` |
| `/etc/polkit-1/rules.d/50-hal-agent.rules` | root | allowed actions |
| docker `hal-docker-socket-proxy` | root | 127.0.0.1:2375, GET only |

## Uninstall

```bash
sudo systemctl disable --now hal-agent hal-smart-collect.timer; sudo systemctl stop hal-shell
sudo docker compose -f /opt/hal-agent/docker/docker-compose.yml down
sudo tailscale serve reset          # only if you used --tailscale and serve nothing else
sudo rm -rf /etc/systemd/system/hal-* /etc/polkit-1/rules.d/50-hal-agent.rules /opt/hal-agent /etc/hal-agent /var/lib/hal-agent
sudo systemctl daemon-reload && sudo userdel halagent
```
