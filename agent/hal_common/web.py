"""Security headers, foutformaat en veilige subprocess-aanroepen."""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from .i18n import lang_from_header, reset_lang, set_lang, tr

SAFE_ENV = {
    "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "LANG": "C.UTF-8",
    "LC_ALL": "C.UTF-8",
    "SYSTEMD_COLORS": "0",
    "SYSTEMD_PAGER": "",
    "SYSTEMD_LESS": "",
}

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
}


def install_common(app: FastAPI) -> None:
    @app.middleware("http")
    async def _security_headers(request: Request, call_next):
        token = set_lang(lang_from_header(request.headers.get("accept-language")))
        try:
            response = await call_next(request)
        finally:
            reset_lang(token)
        for k, v in SECURITY_HEADERS.items():
            response.headers.setdefault(k, v)
        if "server" in response.headers:
            del response.headers["server"]
        return response

    @app.exception_handler(HTTPException)
    async def _http_exc(_request: Request, exc: HTTPException):
        detail = exc.detail
        if isinstance(detail, dict):
            body = {"code": detail.get("code", "error"), "message": tr(detail.get("message", "Fout"))}
        else:
            body = {"code": _code_for(exc.status_code), "message": tr(str(detail))}
        return JSONResponse(status_code=exc.status_code, content=body, headers=getattr(exc, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def _validation_exc(_request: Request, exc: RequestValidationError):
        errors = [
            {"loc": [str(p) for p in e.get("loc", [])], "msg": e.get("msg", "")}
            for e in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={"code": "invalid_input", "message": tr("Ongeldige invoer"), "errors": errors},
        )


def _code_for(status: int) -> str:
    return {
        400: "bad_request",
        401: "unauthorized",
        403: "forbidden",
        404: "not_found",
        409: "conflict",
        413: "too_large",
        429: "rate_limited",
        503: "unavailable",
    }.get(status, "error")


def api_error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


@dataclass
class ProcResult:
    code: int
    stdout: str
    stderr: str
    timed_out: bool = False


async def run(argv: list[str], timeout: float = 15.0, max_output: int = 4 * 1024 * 1024) -> ProcResult:
    """Voert een commando uit met een vaste argumentenlijst. Nooit via een shell."""
    if not argv or not all(isinstance(a, str) for a in argv):
        raise ValueError("argv moet een lijst van strings zijn")
    proc = await asyncio.create_subprocess_exec(
        *argv,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=SAFE_ENV,
        start_new_session=True,
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except TimeoutError:
        try:
            os.killpg(proc.pid, 9)
        except ProcessLookupError:
            pass
        await proc.wait()
        return ProcResult(code=-1, stdout="", stderr="timeout", timed_out=True)
    return ProcResult(
        code=proc.returncode if proc.returncode is not None else -1,
        stdout=out[:max_output].decode("utf-8", "replace"),
        stderr=err[:65536].decode("utf-8", "replace"),
    )


def host_allowed(host: str) -> bool:
    """Loopback altijd. Een privé-LAN-adres enkel met HAL_ALLOW_LAN=1 (setup.sh --lan). Nooit 0.0.0.0 of publiek."""
    import ipaddress
    import os

    if host in ("127.0.0.1", "::1", "localhost"):
        return True
    if os.environ.get("HAL_ALLOW_LAN") != "1":
        return False
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return ip.is_private and not ip.is_unspecified and not ip.is_loopback
