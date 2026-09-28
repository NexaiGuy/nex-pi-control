from __future__ import annotations

import logging
import sys

import uvicorn

from hal_common.web import host_allowed

from .main import ShellSettings, create_app


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s", stream=sys.stdout)
    # httpx/httpcore loggen elke aanvraag (tientallen per poll naar de Docker-proxy); enkel waarschuwingen tonen.
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    s = ShellSettings()
    if not host_allowed(s.host):
        logging.error("Refused: hal-shell only listens on loopback, or a private LAN address with HAL_ALLOW_LAN=1")
        return 2
    if hasattr(__import__("os"), "geteuid") and __import__("os").geteuid() == 0 and not s.mock:
        logging.error("Refused: hal-shell never runs as root")
        return 2
    try:
        app = create_app(s)
    except RuntimeError as exc:
        logging.error("Kan niet starten: %s", exc)
        return 3
    uvicorn.run(app, host=s.host, port=s.port, log_level="info", access_log=False, proxy_headers=False,
                server_header=False, ws_max_size=1024 * 1024, timeout_graceful_shutdown=5)
    return 0


if __name__ == "__main__":
    sys.exit(main())
