def test_services_filter_invalid(client, auth_headers):
    r = client.get("/v1/services?filter=alles", headers=auth_headers)
    assert r.status_code == 422 and r.json()["code"] == "invalid_input"


def test_service_logs_injection(client, auth_headers):
    for bad in ["nginx;rm -rf", "--all.service", "../etc.service", "a b.service"]:
        r = client.get(f"/v1/services/{bad}/logs", headers=auth_headers)
        assert r.status_code in (404, 422), bad


def test_service_logs_unknown_unit(client, auth_headers):
    assert client.get("/v1/services/bestaatniet.service/logs", headers=auth_headers).status_code == 404


def test_logs_line_limit(client, auth_headers):
    assert client.get("/v1/services/nginx.service/logs?lines=5000", headers=auth_headers).status_code == 422


def test_extra_fields_rejected(client, auth_headers):
    r = client.post("/v1/actions/restart-service", json={"name": "nginx", "cmd": "reboot"}, headers=auth_headers)
    assert r.status_code == 422


def test_stats_metric_validation(client, auth_headers):
    assert client.get("/v1/stats/history?metric=cpu;drop&range=1h", headers=auth_headers).status_code == 422
    assert client.get("/v1/stats/history?metric=cpu&range=1y", headers=auth_headers).status_code == 422
    many = ",".join(["cpu"] * 25)
    assert client.get(f"/v1/stats/history?metric={many}&range=1h", headers=auth_headers).status_code == 422


def test_stats_batch(client, auth_headers):
    r = client.get("/v1/stats/history?metric=cpu,temp,ram&range=24h", headers=auth_headers)
    assert r.status_code == 200
    series = r.json()["series"]
    assert [s["metric"] for s in series] == ["cpu", "temp", "ram"]
    assert all(len(s["points"]) > 100 for s in series)


def test_stats_export_csv(client, auth_headers):
    r = client.get("/v1/stats/export?metric=temp&range=6h", headers=auth_headers)
    assert r.status_code == 200 and r.text.startswith("timestamp_utc,")
    assert "attachment" in r.headers["content-disposition"]


def test_gpio_pin_range(client, auth_headers):
    assert client.post("/v1/gpio/40", json={"action": "on"}, headers=auth_headers).status_code == 422
    assert client.post("/v1/gpio/17", json={"action": "explode"}, headers=auth_headers).status_code == 422
    assert client.post("/v1/gpio/17", json={"action": "pulse", "duration_ms": 999999}, headers=auth_headers).status_code == 422


def test_gpio_not_allowed(client, auth_headers):
    r = client.post("/v1/gpio/4", json={"action": "on"}, headers=auth_headers)
    assert r.status_code == 403


def test_gpio_allowed_and_audited(client, auth_headers):
    r = client.post("/v1/gpio/17", json={"action": "on"}, headers=auth_headers)
    assert r.status_code == 200 and r.json()["value"] == 1
    audit = client.get("/v1/audit", headers=auth_headers).json()
    assert audit[0]["action"] == "gpio:on" and audit[0]["target"] == "GPIO17"


def test_command_id_validation(client, auth_headers):
    assert client.post("/v1/commands/..%2Fetc/run", headers=auth_headers).status_code in (404, 422)
    assert client.post("/v1/commands/Rm-RF/run", headers=auth_headers).status_code == 422
    assert client.post("/v1/commands/bestaat-niet/run", headers=auth_headers).status_code == 404


def test_power_requires_name(client, auth_headers):
    r = client.post("/v1/actions/power", json={"action": "reboot", "confirm": "ja"}, headers=auth_headers)
    assert r.status_code == 400
    r = client.post("/v1/actions/power", json={"action": "reboot", "confirm": "HOMELAB-PI"}, headers=auth_headers)
    assert r.status_code == 200
    r = client.post("/v1/actions/power", json={"action": "selfdestruct", "confirm": "homelab-pi"}, headers=auth_headers)
    assert r.status_code == 422
