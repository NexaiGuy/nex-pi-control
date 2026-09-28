# Connect with Cloudflare Tunnel + Access

For people who already run a Cloudflare Tunnel on their Pi and have a domain on Cloudflare. You get public hostnames that are protected by Cloudflare Access, so only your phone (with a service token) gets through. The installer does not touch your tunnel, you add two routes yourself.

## 1. Install the agent

```bash
curl -fsSL https://raw.githubusercontent.com/NexaiGuy/nex-pi-control/main/install.sh | sudo bash
```

Until Access is configured, the agent refuses every request that comes in through the tunnel (503). That is on purpose.

## 2. Tunnel routes

Add two public hostnames to your tunnel (Zero Trust, Networks, Tunnels, or `ingress:` in `/etc/cloudflared/config.yml`):

| Hostname | Service |
|---|---|
| `pi-api.example.com` | `http://127.0.0.1:8120` |
| `pi-shell.example.com` | `http://127.0.0.1:8121` |

## 3. Access

In Zero Trust:

1. **Access, Service Auth, Service Tokens:** create a token, for example `nex-pi-control-phone`. Copy the Client ID and Client Secret, you need them once.
2. **Access, Applications:** create two *Self-hosted* applications, one per hostname. Give each a policy with action **Service Auth** that includes your service token.
3. Copy the **Application Audience (AUD) tag** of each application.

On the Pi:

```bash
sudo nano /etc/hal-agent/agent.env    # CF_ACCESS_TEAM_DOMAIN=yourteam.cloudflareaccess.com and CF_ACCESS_AUD=<AUD of pi-api>
sudo nano /etc/hal-agent/shell.env    # same team domain, CF_ACCESS_AUD=<AUD of pi-shell>
sudo systemctl restart hal-agent
```

## 4. Scan

```bash
sudo /opt/hal-agent/bin/hal-qr --api https://pi-api.example.com --shell https://pi-shell.example.com
```

It asks for the Client ID and Secret (hidden input) and puts them in the QR code together with the tokens.

## Checks

Every request now passes three locks: Cloudflare Access (service token), the agent token and the fingerprint lock in the app. Test from outside:

```bash
curl -i https://pi-api.example.com/v1/overview     # expect 403 from Cloudflare, not 200
```
