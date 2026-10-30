"""GlowUp TV integration."""
from __future__ import annotations

import base64
from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import CONF_HOST, CONF_PORT, CONF_TOKEN, Platform
from homeassistant.core import HomeAssistant, ServiceCall, ServiceResponse, SupportsResponse
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv, device_registry as dr
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .api import GlowUpClient, GlowUpError
from .const import DOMAIN, MAX_IMAGE_BYTES
from .coordinator import GlowUpCoordinator

PLATFORMS = [Platform.BINARY_SENSOR, Platform.SENSOR, Platform.SELECT]
CONTENT_KEYS = ("text", "icon", "color", "value", "unit", "label", "secondary", "trend", "items", "caption", "detail")

TARGET = {vol.Optional("device_id"): vol.All(cv.ensure_list, [cv.string]), vol.Optional("config_entry_id"): cv.string}
SET_WIDGET = vol.Schema(
    {
        **TARGET,
        vol.Required("widget"): cv.string,
        vol.Optional("ttl"): vol.All(vol.Coerce(int), vol.Range(min=0, max=604800)),
        vol.Optional("camera_entity"): cv.entity_id,
        **{vol.Optional(k): object for k in CONTENT_KEYS},
    }
)
CLEAR_WIDGET = vol.Schema({**TARGET, vol.Required("widget"): cv.string})
PATCH_CONFIG = vol.Schema({**TARGET, vol.Required("patch"): dict})
SET_LAYOUT = vol.Schema({**TARGET, vol.Required("layout"): cv.string})
TOAST = vol.Schema(
    {
        **TARGET,
        vol.Required("text"): cv.string,
        vol.Optional("icon"): cv.string,
        vol.Optional("seconds"): vol.All(vol.Coerce(int), vol.Range(min=1, max=30)),
    }
)
LAUNCH = vol.Schema({**TARGET, vol.Required("package"): cv.string})
TARGET_ONLY = vol.Schema(TARGET)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    client = GlowUpClient(async_get_clientsession(hass), entry.data[CONF_HOST], entry.data[CONF_PORT], entry.data[CONF_TOKEN])
    coordinator = GlowUpCoordinator(hass, entry, client)
    await coordinator.async_config_entry_first_refresh()
    entry.runtime_data = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    _register_services(hass)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


def _targets(hass: HomeAssistant, call: ServiceCall) -> list[GlowUpCoordinator]:
    """Explicit target, else every configured TV (so a single TV needs no target)."""
    ids: set[str] = set()
    if entry_id := call.data.get("config_entry_id"):
        ids.add(entry_id)
    reg = dr.async_get(hass)
    for dev_id in call.data.get("device_id", []):
        if device := reg.async_get(dev_id):
            ids.update(device.config_entries)
    entries = [
        e
        for e in hass.config_entries.async_entries(DOMAIN)
        if e.state is ConfigEntryState.LOADED and (not ids or e.entry_id in ids)
    ]
    if not entries:
        raise HomeAssistantError("No GlowUp TV matches this call")
    return [e.runtime_data for e in entries]


async def _each(hass: HomeAssistant, call: ServiceCall, fn) -> None:
    for coord in _targets(hass, call):
        try:
            await fn(coord)
        except GlowUpError as err:
            raise HomeAssistantError(str(err)) from err


def _register_services(hass: HomeAssistant) -> None:
    if hass.services.has_service(DOMAIN, "set_widget"):
        return

    async def set_widget(call: ServiceCall) -> None:
        widget = call.data["widget"]
        ttl = call.data.get("ttl", 0)
        payload: dict[str, Any] = {k: call.data[k] for k in CONTENT_KEYS if k in call.data}
        if cam := call.data.get("camera_entity"):
            # Imported here: the camera component is only needed by image widgets.
            from homeassistant.components.camera import async_get_image

            image = await async_get_image(hass, cam)
            if len(image.content) > MAX_IMAGE_BYTES:
                raise HomeAssistantError("Camera image is larger than 1 MB")
            payload["data"] = base64.b64encode(image.content).decode()

        async def push(c: GlowUpCoordinator) -> None:
            if c.cache.should_send(widget, payload, ttl):
                await c.client.put_widget(widget, dict(payload, ttl=ttl))
                c.cache.remember(widget, payload, ttl)

        await _each(hass, call, push)

    async def clear_widget(call: ServiceCall) -> None:
        async def go(c: GlowUpCoordinator) -> None:
            await c.client.delete_widget(call.data["widget"])
            c.cache.forget(call.data["widget"])

        await _each(hass, call, go)

    async def _patch(c: GlowUpCoordinator, patch: dict[str, Any]) -> None:
        await c.client.patch_config(patch)
        await c.async_request_refresh()

    async def patch_config(call: ServiceCall) -> None:
        await _each(hass, call, lambda c: _patch(c, call.data["patch"]))

    async def set_layout(call: ServiceCall) -> None:
        await _each(hass, call, lambda c: _patch(c, {"layout": call.data["layout"]}))

    async def toast(call: ServiceCall) -> None:
        await _each(hass, call, lambda c: c.client.toast(call.data["text"], call.data.get("icon"), call.data.get("seconds")))

    async def launch_app(call: ServiceCall) -> None:
        await _each(hass, call, lambda c: c.client.launch(call.data["package"]))

    async def go_home(call: ServiceCall) -> None:
        await _each(hass, call, lambda c: c.client.home())

    async def get_data(call: ServiceCall) -> ServiceResponse:
        """Live read of everything the TV API exposes, one entry per TV (used by the Lovelace card)."""
        tvs = []
        for c in _targets(hass, call):
            tv: dict[str, Any] = {"entry_id": c.config_entry.entry_id, "title": c.config_entry.title, "errors": {}}
            for key, fn in (
                ("info", c.client.info),
                ("config", c.client.config),
                ("state", c.client.state),
                ("apps", c.client.apps),
                ("wallpapers", c.client.wallpapers),
            ):
                try:
                    tv[key] = await fn()
                except GlowUpError as err:
                    tv[key] = None
                    tv["errors"][key] = str(err)
            tvs.append(tv)
        return {"tvs": tvs}

    hass.services.async_register(DOMAIN, "get_data", get_data, schema=TARGET_ONLY, supports_response=SupportsResponse.ONLY)

    for name, fn, schema in (
        ("go_home", go_home, TARGET_ONLY),
        ("set_widget", set_widget, SET_WIDGET),
        ("clear_widget", clear_widget, CLEAR_WIDGET),
        ("patch_config", patch_config, PATCH_CONFIG),
        ("set_layout", set_layout, SET_LAYOUT),
        ("toast", toast, TOAST),
        ("launch_app", launch_app, LAUNCH),
    ):
        hass.services.async_register(DOMAIN, name, fn, schema=schema)
