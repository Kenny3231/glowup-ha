"""Shared base entity."""
from __future__ import annotations

from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import GlowUpCoordinator


class GlowUpEntity(CoordinatorEntity[GlowUpCoordinator]):
    _attr_has_entity_name = True

    def __init__(self, coordinator: GlowUpCoordinator, key: str) -> None:
        super().__init__(coordinator)
        info = coordinator.data["info"]
        self._attr_unique_id = f"{info['device_id']}_{key}"
        self._attr_translation_key = key
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, info["device_id"])},
            name=info.get("name") or "GlowUp TV",
            manufacturer="GlowUp TV",
            model=info.get("device"),
            sw_version=info.get("version"),
        )
