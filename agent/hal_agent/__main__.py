"""Startpunt: python -m hal_agent. uvicorn handelt SIGTERM en SIGINT netjes af (lifespan shutdown)."""

from __future__ import annotations

import logging
import sys

import uvicorn

from hal_common.web import host_allowed

from .config import Settings
from .main import create_app


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s", stream=sys.stdout)
    settings = Settings.from_env()
    if not host_allowed(settings.host):
        logging.error("Refused: hal-agent only listens on loopback, or a private LAN address with HAL_ALLOW_LAN=1 (got %s)", settings.host)
        return 2
    try:
        app = create_app(settings)
    except RuntimeError as exc:
        logging.error("Kan niet starten: %s", exc)
        return 3
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        log_level="info",
        access_log=False,
        proxy_headers=False,
        server_header=False,
        timeout_graceful_shutdown=10,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
