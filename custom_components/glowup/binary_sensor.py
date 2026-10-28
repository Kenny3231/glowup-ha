"""Online (connectivity) binary sensor."""
from __future__ import annotations

from homeassistant.components.binary_sensor import BinarySensorDeviceClass, BinarySensorEntity

from .entity import GlowUpEntity


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    async_add_entities([GlowUpOnline(entry.runtime_data, "online")])


class GlowUpOnline(GlowUpEntity, BinarySensorEntity):
    _attr_device_class = BinarySensorDeviceClass.CONNECTIVITY

    @property
    def available(self) -> bool:  # stays visible (as off) when the TV is down
        return True

    @property
    def is_on(self) -> bool:
        return self.coordinator.last_update_success
