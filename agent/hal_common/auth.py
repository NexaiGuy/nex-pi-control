"""Authenticatie: bearer-token plus Cloudflare Access JWT.

Regels:
- Elke aanvraag (behalve /health) heeft `Authorization: Bearer <token>` nodig, vergeleken in constante tijd.
- Aanvragen die via de Cloudflare Tunnel binnenkomen (herkenbaar aan Cf-Ray of Cf-Connecting-Ip,
  die de Cloudflare-edge altijd zet) moeten een geldige `Cf-Access-Jwt-Assertion` hebben.
- Is Cloudflare Access nog niet ingesteld (CF_ACCESS_TEAM_DOMAIN of CF_ACCESS_AUD leeg), dan wordt
  elk verzoek via de tunnel geweigerd. Enkel rechtstreekse lokale verzoeken werken dan (smoke test).
"""

from __future__ import annotations

import hmac
import ipaddress
import logging
import threading
import time
from dataclasses import dataclass
from typing import Any

import httpx
import jwt
from fastapi import HTTPException, Request, WebSocket

log = logging.getLogger("hal.auth")

TUNNEL_HEADERS = ("cf-ray", "cf-connecting-ip")
JWT_HEADER = "cf-access-jwt-assertion"


def normalize_team_domain(value: str | None) -> str | None:
    if not value:
        return None
    v = value.strip().lower()
    for prefix in ("https://", "http://"):
        if v.startswith(prefix):
            v = v[len(prefix):]
    v = v.strip("/")
    if not v:
        return None
    if "." not in v:
        v = f"{v}.cloudflareaccess.com"
    return v


@dataclass(frozen=True)
class AuthConfig:
    token: str
    team_domain: str | None = None
    aud: str | None = None

    @property
    def access_configured(self) -> bool:
        return bool(self.team_domain and self.aud)


class AccessVerifier:
    """Controleert Cloudflare Access JWT's tegen de publieke sleutels van het team."""

    CACHE_SECONDS = 3600

    def __init__(self, team_domain: str, aud: str, http_get=None) -> None:
        self.team_domain = team_domain
        self.aud = aud
        self.issuer = f"https://{team_domain}"
        self.certs_url = f"https://{team_domain}/cdn-cgi/access/certs"
        self._http_get = http_get or self._default_get
        self._keys: dict[str, Any] = {}
        self._fetched_at = 0.0
        self._lock = threading.Lock()

    @staticmethod
    def _default_get(url: str) -> dict:
        r = httpx.get(url, timeout=10.0)
        r.raise_for_status()
        return r.json()

    def _refresh(self, force: bool = False) -> None:
        with self._lock:
            if not force and self._keys and time.time() - self._fetched_at < self.CACHE_SECONDS:
                return
            data = self._http_get(self.certs_url)
            keys: dict[str, Any] = {}
            for jwk in data.get("keys", []):
                kid = jwk.get("kid")
                if kid:
                    keys[kid] = jwt.algorithms.RSAAlgorithm.from_jwk(jwk)
            if not keys:
                raise RuntimeError("Geen sleutels ontvangen van Cloudflare Access")
            self._keys = keys
            self._fetched_at = time.time()

    def verify(self, token: str) -> dict:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise ValueError("ongeldige JWT") from exc
        kid = header.get("kid")
        if header.get("alg") != "RS256" or not kid:
            raise ValueError("onverwacht JWT-algoritme")
        self._refresh()
        key = self._keys.get(kid)
        if key is None:
            self._refresh(force=True)
            key = self._keys.get(kid)
        if key is None:
            raise ValueError("onbekende sleutel")
        try:
            return jwt.decode(
                token,
                key=key,
                algorithms=["RS256"],
                audience=self.aud,
                issuer=self.issuer,
                leeway=30,
                options={"require": ["exp", "iat", "aud", "iss"]},
            )
        except jwt.PyJWTError as exc:
            raise ValueError(f"JWT geweigerd: {exc.__class__.__name__}") from exc


def _is_loopback(host: str | None) -> bool:
    if not host:
        return False
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return host in ("testclient", "localhost")


def came_via_tunnel(headers) -> bool:
    return any(h in headers for h in TUNNEL_HEADERS)


def client_ip(headers, peer_host: str | None) -> str:
    """Het echte client-IP. Cf-Connecting-Ip wordt enkel vertrouwd als de peer loopback is (cloudflared)."""
    if _is_loopback(peer_host):
        cf = headers.get("cf-connecting-ip")
        if cf:
            try:
                return str(ipaddress.ip_address(cf.strip()))
            except ValueError:
                return "invalid"
    return peer_host or "unknown"


class Authenticator:
    def __init__(self, config: AuthConfig, verifier: AccessVerifier | None = None) -> None:
        if not config.token or len(config.token) < 32:
            raise RuntimeError("Token ontbreekt of is te kort (minstens 32 tekens)")
        self.config = config
        if verifier is None and config.access_configured:
            verifier = AccessVerifier(config.team_domain, config.aud)  # type: ignore[arg-type]
        self.verifier = verifier
        self._token_bytes = config.token.encode()

    def check_bearer(self, authorization: str | None) -> bool:
        if not authorization or not authorization.startswith("Bearer "):
            return False
        supplied = authorization[7:].strip().encode()
        return hmac.compare_digest(supplied, self._token_bytes)

    def authenticate(self, headers, peer_host: str | None) -> dict:
        """Geeft een klein identiteitsobject terug of gooit HTTPException."""
        via_tunnel = came_via_tunnel(headers)
        identity: dict[str, Any] = {"via": "tunnel" if via_tunnel else "local", "ip": client_ip(headers, peer_host)}

        if via_tunnel and not _is_loopback(peer_host):
            # Tunnelheaders van een niet-lokale peer zijn vervalst: de agent luistert enkel op 127.0.0.1.
            raise HTTPException(status_code=403, detail={"code": "forbidden", "message": "Ongeldige herkomst"})

        if via_tunnel:
            if self.verifier is None:
                raise HTTPException(
                    status_code=503,
                    detail={
                        "code": "access_not_configured",
                        "message": "Cloudflare Access is nog niet ingesteld op de server",
                    },
                )
            assertion = headers.get(JWT_HEADER)
            if not assertion:
                raise HTTPException(status_code=403, detail={"code": "access_denied", "message": "Cloudflare Access-token ontbreekt"})
            try:
                claims = self.verifier.verify(assertion)
            except ValueError as exc:
                log.warning("Access JWT geweigerd van %s: %s", identity["ip"], exc)
                raise HTTPException(status_code=403, detail={"code": "access_denied", "message": "Cloudflare Access-token ongeldig"})
            except Exception:  # netwerkfout bij ophalen sleutels
                log.exception("Kon Cloudflare Access-sleutels niet ophalen")
                raise HTTPException(status_code=503, detail={"code": "access_unavailable", "message": "Cloudflare Access tijdelijk niet te controleren"})
            identity["actor"] = claims.get("common_name") or claims.get("email") or "service-token"
        else:
            identity["actor"] = "lokaal"

        if not self.check_bearer(headers.get("authorization")):
            raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Token ontbreekt of is ongeldig"})
        return identity

    # FastAPI dependencies
    async def http_dependency(self, request: Request) -> dict:
        peer = request.client.host if request.client else None
        identity = self.authenticate(request.headers, peer)
        request.state.identity = identity
        return identity

    def websocket_identity(self, websocket: WebSocket) -> dict:
        peer = websocket.client.host if websocket.client else None
        return self.authenticate(websocket.headers, peer)
