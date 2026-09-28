# Connect with Tailscale (recommended)

Tailscale puts your phone and your Pi in a private, encrypted network (a tailnet). Nothing is exposed to the internet and it works from anywhere, also on mobile data. The free personal plan is enough.

## 1. Tailscale on the Pi

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

Open the link it prints and log in. In the Tailscale admin console, make sure **MagicDNS** and **HTTPS certificates** are enabled (DNS page). `tailscale serve` needs both.

## 2. Install the agent

```bash
curl -fsSL https://raw.githubusercontent.com/NexaiGuy/nex-pi-control/main/install.sh | sudo bash -s -- --tailscale
```

The installer publishes the agent inside your tailnet only:

- `https://<your-pi>.<tailnet>.ts.net` for the agent
- `https://<your-pi>.<tailnet>.ts.net:8443` for the admin shell

It prints the exact `hal-qr` command at the end.

## 3. Tailscale on your phone

Install the Tailscale app from Google Play and log in with the same account. Keep it connected when you use Nex Pi Control.

## 4. Scan

```bash
sudo /opt/hal-agent/bin/hal-qr --api https://<your-pi>.<tailnet>.ts.net --shell https://<your-pi>.<tailnet>.ts.net:8443
```

In the app: **Connect my Pi**, scan the QR code, **Test connection**, done.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "No connection" in the app | Is the Tailscale app on your phone connected? |
| Certificate error | Enable HTTPS certificates in the Tailscale admin console, then run the installer again with `--tailscale` |
| Terminal does not open | The admin shell starts on demand. Tap **Start admin mode** first |
| Check what is published | `tailscale serve status` on the Pi |
