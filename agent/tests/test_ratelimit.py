from hal_common.ratelimit import RateLimiter


def test_window():
    rl = RateLimiter({"a": (3, 60.0)})
    assert [rl.hit("a", "ip", now=t) for t in (0, 1, 2)] == [None, None, None]
    wait = rl.hit("a", "ip", now=3)
    assert wait is not None and 56 < wait <= 57
    assert rl.hit("a", "ander-ip", now=3) is None
    assert rl.hit("a", "ip", now=61) is None


def test_actions_limited_to_5_per_minute(client, auth_headers):
    codes = [client.post("/v1/wol/desktop", headers=auth_headers).status_code for _ in range(7)]
    assert codes[:5] == [200] * 5
    assert codes[5] == 429
    r = client.post("/v1/wol/desktop", headers=auth_headers)
    assert r.json()["code"] == "rate_limited" and int(r.headers["retry-after"]) >= 1


def test_limit_per_client_ip(client, auth_headers):
    client.app.state.limiter.limits["action"] = (1, 60.0)
    h1 = {**auth_headers}
    assert client.post("/v1/wol/desktop", headers=h1).status_code == 200
    assert client.post("/v1/wol/desktop", headers=h1).status_code == 429
