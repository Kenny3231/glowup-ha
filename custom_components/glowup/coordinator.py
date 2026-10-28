"""Coordinator: GET /info (+ config, wallpapers) every 60 s, repush widgets after a TV restart."""
from __future__ import annotations

import logging
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import GlowUpAuthError, GlowUpClient, GlowUpError
from .const import DOMAIN, SCAN_INTERVAL
from .state_cache import StateCache

_LOGGER = logging.getLogger(__name__)


class GlowUpCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    def __init__(self, hass: HomeAssistant, entry: ConfigEntry, client: GlowUpClient) -> None:
        super().__init__(hass, _LOGGER, name=DOMAIN, update_interval=SCAN_INTERVAL, config_entry=entry)
        self.client = client
        self.cache = StateCache()
        self._boot_id: str | None = None

    async def _async_update_data(self) -> dict[str, Any]:
        # The coordinator logs the first failure and the recovery only, so a TV that is off does not spam.
        try:
            info = await self.client.info()
            config = await self.client.config()
            wallpapers = await self.client.wallpapers()
        except GlowUpAuthError as err:
            raise ConfigEntryAuthFailed from err
        except GlowUpError as err:
            raise UpdateFailed(f"TV unreachable: {err}") from err
        boot_id = info.get("boot_id")
        if boot_id != self._boot_id:
            # First poll or TV restarted: repush is idempotent on the TV.
            self._boot_id = boot_id
            await self._repush()
        return {"info": info, "config": config, "wallpapers": wallpapers}

    async def _repush(self) -> None:
        for widget, payload, ttl in self.cache.pending_repush():
            try:
                await self.client.put_widget(widget, dict(payload, ttl=ttl))
            except GlowUpError as err:
                _LOGGER.debug("Repush of widget %s failed: %s", widget, err)
