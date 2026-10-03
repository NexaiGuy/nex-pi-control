import json
import time

from hal_agent.collectors.site_discovery import dedupe, merge_sites, parse_ingress, parse_nginx, parse_unit_exec, tunnel_label
from hal_agent.config import HOST_RE, ConfigFiles

OK = lambda h: bool(HOST_RE.match(h))  # noqa: E731

CFG = {
    "tunnel": "6a602213-f823-49f2-a1da-0b4f8eb54610",
    "credentials-file": "/etc/cloudflared/x.json",
    "ingress": [
        {"hostname": "Shop.Example.com", "service": "http://localhost:8113"},
        {"hostname": "api.example.com", "service": "http://127.0.0.1:8120", "path": "/v1"},
        {"hostname": "ssh.example.com", "service": "ssh://localhost:22"},
        {"hostname": "*.example.com", "service": "http://localhost:80"},
        {"hostname": "app.example.com", "service": "http://web:3000"},
        {"hostname": "secure.example.com", "service": "https://localhost:8443"},
        {"service": "http_status:404"},
    ],
}


def test_parse_ingress_keeps_http_hosts_only():
    out = parse_ingress(CFG, "home")
    hosts = {s["hostname"]: s for s in out}
    assert set(hosts) == {"shop.example.com", "api.example.com", "app.example.com", "secure.example.com"}
    assert hosts["shop.example.com"]["local"] == "http://127.0.0.1:8113"
    assert "local" not in hosts["app.example.com"] and "local" not in hosts["secure.example.com"]
    assert all(s["source"] == "home" and s["kind"] == "tunnel" for s in out)


def test_tunnel_label():
    assert tunnel_label("/etc/cloudflared/agenticslop.yml", CFG) == "agenticslop"
    assert tunnel_label("/home/pi/.cloudflared/config.yml", CFG) == "config (pi)"
    assert tunnel_label("/etc/cloudflared/config.yml", {"tunnel": "socialhub"}) == "socialhub"
    assert tunnel_label("/srv/x/config.yml", CFG, "cloudflared-web.service") == "cloudflared-web"


def test_parse_unit_exec():
    assert parse_unit_exec("{ path=/usr/bin/cloudflared ; argv[]=/usr/bin/cloudflared --config /etc/cf/a.yml tunnel run }") == {"config": "/etc/cf/a.yml", "remote": False}
    assert parse_unit_exec("argv[]=/usr/bin/cloudflared --no-autoupdate tunnel run --token eyJh")["remote"] is True
    assert parse_unit_exec("argv[]=/usr/bin/cloudflared tunnel run", "TUNNEL_TOKEN=abc")["remote"] is True


def test_parse_nginx():
    text = """
    upstream app { server 127.0.0.1:9000; }
    server {
        listen 8113; # demo
        server_name demo.example.com www.demo.example.com _;
        location / { proxy_pass http://app; }
    }
    server { listen 443 ssl; server_name ~^(.+)\\.example\\.com$ secure.example.com; }
    server { listen 80; server_name localhost; }
    """
    out = parse_nginx(text, "nginx demo")
    hosts = {s["hostname"]: s for s in out}
    assert set(hosts) == {"demo.example.com", "www.demo.example.com", "secure.example.com"}
    assert hosts["demo.example.com"]["local"] == "http://127.0.0.1:8113"
    assert "local" not in hosts["secure.example.com"]


def test_dedupe_prefers_tunnel():
    out = dedupe([{"hostname": "a.example.com", "source": "nginx x", "kind": "nginx", "local": "http://127.0.0.1:1"},
                  {"hostname": "a.example.com", "source": "home", "kind": "tunnel"}])
    assert out == [{"hostname": "a.example.com", "source": "home", "kind": "tunnel", "local": "http://127.0.0.1:1"}]


def test_merge_manual_overrides_and_exclude():
    disc = {"sites": [{"hostname": "a.example.com", "local": "http://127.0.0.1:1", "source": "home"},
                      {"hostname": "old.example.com", "source": "home"}, {"hostname": "bad host", "source": "x"}]}
    manual = {"exclude": ["old.example.com"], "sites": [{"hostname": "a.example.com", "path": "/health"}, {"hostname": "b.example.com"}]}
    out = merge_sites(manual, disc, OK)
    assert [s["hostname"] for s in out] == ["a.example.com", "b.example.com"]
    assert out[0] == {"hostname": "a.example.com", "local": "http://127.0.0.1:1", "path": "/health", "source": "home"}
    assert out[1]["source"] == "sites.yml"
    assert [s["hostname"] for s in merge_sites({**manual, "discover": False}, disc, OK)] == ["a.example.com", "b.example.com"]
    assert merge_sites({}, None, OK) == []


def test_config_reads_discovered_file(tmp_path):
    (tmp_path / "sites.yml").write_text("sites:\n  - hostname: manual.example.com\n")
    disc = tmp_path / "discovered.json"
    disc.write_text(json.dumps({"generated_at": int(time.time()), "sites": [{"hostname": "new.example.com", "source": "home"}],
                                "sources": [{"label": "home", "kind": "tunnel", "count": 1, "path": "/etc/cloudflared/home.yml"}],
                                "remote_tunnels": ["cloudflared-remote"]}))
    cf = ConfigFiles(tmp_path, disc)
    assert [s["hostname"] for s in cf.site_list()] == ["manual.example.com", "new.example.com"]
    info = cf.site_discovery()
    assert info["enabled"] and info["remote_tunnels"] == ["cloudflared-remote"]
    assert info["sources"] == [{"label": "home", "kind": "tunnel", "count": 1}]  # geen paden naar buiten
    assert ConfigFiles(tmp_path).site_list() == [{"hostname": "manual.example.com", "local": None, "path": "/", "source": "sites.yml"}]


def test_sites_endpoint_has_discovery(client, auth_headers):
    r = client.get("/v1/sites", headers=auth_headers).json()
    assert "discovery" in r and r["sites"][0].get("source")


def test_merge_skips_shell_origin():
    disc = {"sites": [{"hostname": "shell.example.com", "local": "http://127.0.0.1:8121", "source": "home"},
                      {"hostname": "api.example.com", "local": "http://127.0.0.1:8120", "source": "home"}]}
    out = merge_sites({}, disc, OK, {"http://127.0.0.1:8121"})
    assert [s["hostname"] for s in out] == ["api.example.com"]


def test_parse_remote_log_takes_last_config():
    from hal_agent.collectors.site_discovery import parse_remote_log
    cfg1 = json.dumps({"ingress": [{"hostname": "old.example.com", "service": "http://localhost:1"}, {"service": "http_status:404"}]})
    cfg2 = json.dumps({"ingress": [{"hostname": "a.example.com", "service": "http://web:3000"},
                                   {"hostname": "b.example.com", "service": "http://localhost:8080"}, {"service": "http_status:404"}],
                       "warp-routing": {"enabled": False}})
    esc = lambda c: json.dumps(c)[1:-1]  # noqa: E731  zoals cloudflared het logt: met \\" escapes
    log = [
        "2026-10-01T08:00:00Z INF Starting tunnel tunnelID=abc\n",
        f'2026-10-01T08:00:01Z INF Updated to new configuration config="{esc(cfg1)}" version=1\n',
        f'2026-10-01T09:00:00Z INF Updated to new configuration config="{esc(cfg2)}" version=2\n',
        "2026-10-01T09:00:01Z INF Registered tunnel connection\n",
    ]
    data = parse_remote_log(log)
    hosts = {s["hostname"]: s for s in parse_ingress(data, "ndf-tunnel")}
    assert set(hosts) == {"a.example.com", "b.example.com"}
    assert hosts["b.example.com"]["local"] == "http://127.0.0.1:8080"
    assert parse_remote_log(["no config here\n"]) is None
