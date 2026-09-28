# Connect on your home network

The simplest setup: your phone talks to the Pi directly over Wi-Fi. It only works at home, and the traffic is **not encrypted** inside your network. Anyone on the same Wi-Fi could read along. For encrypted access from anywhere, use [Tailscale](connect-tailscale.md).

## 1. Install the agent

```bash
curl -fsSL https://raw.githubusercontent.com/NexaiGuy/nex-pi-control/main/install.sh | sudo bash -s -- --lan
```

The agent then listens on the Pi's LAN address (for example `http://192.168.1.50:8120`) and only accepts requests from private addresses. Every request still needs the token.

## 2. Firewall

The installer never changes your firewall. If UFW is active, it prints the two commands to allow the app from your home network, for example:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 8120 proto tcp comment 'Nex Pi Control'
sudo ufw allow from 192.168.1.0/24 to any port 8121 proto tcp comment 'Nex Pi Control shell'
```

## 3. Scan

```bash
sudo /opt/hal-agent/bin/hal-qr --api http://192.168.1.50:8120 --shell http://192.168.1.50:8121
```

The app accepts plain `http://` only for private addresses (192.168.x.x, 10.x.x.x, 172.16 to 31.x.x, `.local`) and shows a warning. It never sends your token over plain http to the internet.

Tip: give your Pi a fixed address in your router (DHCP reservation), otherwise the address can change.
