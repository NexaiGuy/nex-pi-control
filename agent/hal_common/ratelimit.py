"""Eenvoudige sliding-window rate limiter per client en per categorie."""

from __future__ import annotations

import threading
import time
from collections import deque

from fastapi import HTTPException, Request

from .auth import client_ip


class RateLimiter:
    def __init__(self, limits: dict[str, tuple[int, float]]) -> None:
        # categorie -> (max aanvragen, venster in seconden)
        self.limits = limits
        self._hits: dict[tuple[str, str], deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, category: str, key: str, now: float | None = None) -> float | None:
        """Registreert een aanvraag. Geeft None terug als ze mag, anders het aantal seconden wachten."""
        max_req, window = self.limits[category]
        now = time.monotonic() if now is None else now
        with self._lock:
            q = self._hits.setdefault((category, key), deque())
            while q and now - q[0] >= window:
                q.popleft()
            if len(q) >= max_req:
                return max(0.0, window - (now - q[0]))
            q.append(now)
            if len(self._hits) > 10000:
                self._gc(now)
            return None

    def _gc(self, now: float) -> None:
        for k in list(self._hits):
            q = self._hits[k]
            _, window = self.limits[k[0]]
            if not q or now - q[-1] >= window:
                del self._hits[k]

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()

    def dependency(self, category: str):
        async def _dep(request: Request) -> None:
            peer = request.client.host if request.client else None
            key = client_ip(request.headers, peer)
            wait = self.hit(category, key)
            if wait is not None:
                raise HTTPException(
                    status_code=429,
                    detail={"code": "rate_limited", "message": "Te veel aanvragen, probeer zo meteen opnieuw"},
                    headers={"Retry-After": str(int(wait) + 1)},
                )

        return _dep
