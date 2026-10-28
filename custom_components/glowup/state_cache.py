"""Per-TV cache of the last widget payloads pushed (pure Python, no Home Assistant import)."""
from __future__ import annotations

import hashlib
import json
import time
from typing import Any, Callable


def _digest(payload: dict[str, Any]) -> str:
    return hashlib.sha256(json.dumps(payload, sort_keys=True, default=str).encode()).hexdigest()


class StateCache:
    """ttl 0 = never expires. `clock` is injectable for tests (monotonic seconds)."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._items: dict[str, tuple[dict[str, Any], int, float, str]] = {}

    @staticmethod
    def _expired(ttl: int, sent: float, now: float) -> bool:
        return ttl > 0 and now - sent >= ttl

    def should_send(self, widget: str, payload: dict[str, Any], ttl: int = 0) -> bool:
        item = self._items.get(widget)
        if item is None:
            return True
        _, old_ttl, sent, digest = item
        if digest != _digest(payload) or old_ttl != ttl:
            return True
        # Same content again: past half its TTL it is a keep-alive the TV needs, or the widget would expire.
        return old_ttl > 0 and self._clock() - sent >= old_ttl / 2

    def remember(self, widget: str, payload: dict[str, Any], ttl: int = 0) -> None:
        self._items[widget] = (dict(payload), ttl, self._clock(), _digest(payload))

    def forget(self, widget: str) -> None:
        self._items.pop(widget, None)

    def pending_repush(self) -> list[tuple[str, dict[str, Any], int]]:
        """Return (widget, payload, remaining_ttl) for unexpired widgets; remaining 0 = forever."""
        now = self._clock()
        out = []
        for widget, (payload, ttl, sent, _) in list(self._items.items()):
            if self._expired(ttl, sent, now):
                del self._items[widget]
                continue
            out.append((widget, dict(payload), 0 if ttl == 0 else max(1, int(ttl - (now - sent)))))
        return out
