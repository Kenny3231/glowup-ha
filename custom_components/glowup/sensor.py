"""Version sensor."""
from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.helpers.entity import EntityCategory

from .entity import GlowUpEntity


async def async_setup_entry(hass, entry, async_add_entities) -> None:
    async_add_entities([GlowUpVersion(entry.runtime_data, "version")])


class GlowUpVersion(GlowUpEntity, SensorEntity):
    _attr_entity_category = EntityCategory.DIAGNOSTIC

    @property
    def native_value(self):
        return self.coordinator.data["info"].get("version")
