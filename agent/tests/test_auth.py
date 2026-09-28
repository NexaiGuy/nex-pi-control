import time

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException

from hal_common.auth import AccessVerifier, AuthConfig, Authenticator, client_ip, normalize_team_domain

from .conftest import TOKEN

TEAM = "nexai.cloudflareaccess.com"
AUD = "a" * 64


@pytest.fixture(scope="module")
def keypair():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = jwt.algorithms.RSAAlgorithm.to_jwk(key.public_key(), as_dict=True)
    jwk["kid"] = "k1"
    return key, {"keys": [jwk]}


def make_jwt(key, aud=AUD, iss=f"https://{TEAM}", exp_delta=300, kid="k1"):
    now = int(time.time())
    return jwt.encode({"aud": [aud], "iss": iss, "iat": now, "exp": now + exp_delta, "common_name": "svc.hal-control-app"},
                      key, algorithm="RS256", headers={"kid": kid})


@pytest.fixture()
def authn(keypair):
    _, jwks = keypair
    verifier = AccessVerifier(TEAM, AUD, http_get=lambda url: jwks)
    return Authenticator(AuthConfig(TOKEN, TEAM, AUD), verifier)


def test_health_no_auth(client):
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["ok"] is True
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["cache-control"] == "no-store"


def test_missing_token_401(client):
    assert client.get("/v1/overview").status_code == 401


def test_wrong_token_401(client):
    r = client.get("/v1/overview", headers={"Authorization": "Bearer " + "x" * 48})
    assert r.status_code == 401 and r.json()["code"] == "unauthorized"


def test_good_token_local(client, auth_headers):
    assert client.get("/v1/overview", headers=auth_headers).status_code == 200


def test_tunnel_without_access_config_is_refused(client, auth_headers):
    r = client.get("/v1/overview", headers={**auth_headers, "Cf-Ray": "abc", "Cf-Connecting-Ip": "81.82.1.10"})
    assert r.status_code == 503 and r.json()["code"] == "access_not_configured"


def test_short_token_refused():
    with pytest.raises(RuntimeError):
        Authenticator(AuthConfig("kort"))


def test_jwt_valid(authn, keypair):
    key, _ = keypair
    ident = authn.authenticate({"cf-ray": "x", "cf-access-jwt-assertion": make_jwt(key), "authorization": f"Bearer {TOKEN}",
                                "cf-connecting-ip": "81.82.1.10"}, "127.0.0.1")
    assert ident["via"] == "tunnel" and ident["actor"] == "svc.hal-control-app" and ident["ip"] == "81.82.1.10"


@pytest.mark.parametrize("kwargs", [{"aud": "b" * 64}, {"iss": "https://evil.cloudflareaccess.com"}, {"exp_delta": -120}])
def test_jwt_rejected(authn, keypair, kwargs):
    key, _ = keypair
    with pytest.raises(HTTPException) as e:
        authn.authenticate({"cf-ray": "x", "cf-access-jwt-assertion": make_jwt(key, **kwargs), "authorization": f"Bearer {TOKEN}"}, "127.0.0.1")
    assert e.value.status_code == 403


def test_jwt_wrong_signing_key(authn):
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(HTTPException) as e:
        authn.authenticate({"cf-ray": "x", "cf-access-jwt-assertion": make_jwt(other), "authorization": f"Bearer {TOKEN}"}, "127.0.0.1")
    assert e.value.status_code == 403


def test_jwt_missing(authn):
    with pytest.raises(HTTPException) as e:
        authn.authenticate({"cf-ray": "x", "authorization": f"Bearer {TOKEN}"}, "127.0.0.1")
    assert e.value.status_code == 403


def test_jwt_ok_but_bearer_wrong(authn, keypair):
    key, _ = keypair
    with pytest.raises(HTTPException) as e:
        authn.authenticate({"cf-ray": "x", "cf-access-jwt-assertion": make_jwt(key), "authorization": "Bearer nope"}, "127.0.0.1")
    assert e.value.status_code == 401


def test_hs256_alg_confusion_rejected(authn):
    forged = jwt.encode({"aud": [AUD], "iss": f"https://{TEAM}", "iat": int(time.time()), "exp": int(time.time()) + 60},
                        "secret", algorithm="HS256", headers={"kid": "k1"})
    with pytest.raises(HTTPException):
        authn.authenticate({"cf-ray": "x", "cf-access-jwt-assertion": forged, "authorization": f"Bearer {TOKEN}"}, "127.0.0.1")


def test_spoofed_tunnel_headers_from_remote_peer(authn):
    with pytest.raises(HTTPException) as e:
        authn.authenticate({"cf-ray": "x", "authorization": f"Bearer {TOKEN}"}, "192.168.0.50")
    assert e.value.status_code == 403


def test_client_ip_trust():
    assert client_ip({"cf-connecting-ip": "1.2.3.4"}, "127.0.0.1") == "1.2.3.4"
    assert client_ip({"cf-connecting-ip": "1.2.3.4"}, "10.0.0.9") == "10.0.0.9"
    assert client_ip({"cf-connecting-ip": "rommel"}, "127.0.0.1") == "invalid"


def test_normalize_team_domain():
    assert normalize_team_domain("https://nexai.cloudflareaccess.com/") == "nexai.cloudflareaccess.com"
    assert normalize_team_domain("nexai") == "nexai.cloudflareaccess.com"
    assert normalize_team_domain("") is None


def test_host_allowed(monkeypatch):
    from hal_common.web import host_allowed

    monkeypatch.delenv("HAL_ALLOW_LAN", raising=False)
    assert host_allowed("127.0.0.1")
    assert not host_allowed("192.168.1.20")
    assert not host_allowed("0.0.0.0")
    monkeypatch.setenv("HAL_ALLOW_LAN", "1")
    assert host_allowed("192.168.1.20") and host_allowed("10.0.0.5")
    assert not host_allowed("0.0.0.0") and not host_allowed("8.8.8.8")


def test_lan_request_uses_bearer_only():
    a = Authenticator(AuthConfig(TOKEN))
    ident = a.authenticate({"authorization": f"Bearer {TOKEN}"}, "192.168.1.30")
    assert ident["via"] == "local" and ident["ip"] == "192.168.1.30"
