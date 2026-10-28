"""Layout and wallpaper selects."""
from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.exceptions import HomeAssistantError

from .api import GlowUpError
from .entity import GlowUpEntity


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    c = entry.runtime_data
    async_add_entities([GlowUpLayout(c, "layout"), GlowUpWallpaper(c, "wallpaper")])


class _Base(GlowUpEntity, SelectEntity):
    async def _patch(self, patch: dict) -> None:
        try:
            await self.coordinator.client.patch_config(patch)
        except GlowUpError as err:
            raise HomeAssistantError(str(err)) from err
        await self.coordinator.async_request_refresh()


class GlowUpLayout(_Base):
    @property
    def options(self) -> list[str]:
        return self.coordinator.data["info"].get("layouts", [])

    @property
    def current_option(self) -> str | None:
        return self.coordinator.data["config"].get("layout")

    async def async_select_option(self, option: str) -> None:
        await self._patch({"layout": option})


class GlowUpWallpaper(_Base):
    _attr_translation_key = "wallpaper"

    @property
    def options(self) -> list[str]:
        return [w["id"] for w in self.coordinator.data["wallpapers"]]

    @property
    def current_option(self) -> str | None:
        ids = self.coordinator.data["config"].get("theme", {}).get("wallpaper", {}).get("ids") or []
        return ids[0] if ids and ids[0] in self.options else None

    async def async_select_option(self, option: str) -> None:
        await self._patch({"theme": {"wallpaper": {"mode": "image", "ids": [option]}}})
