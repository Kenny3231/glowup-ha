"""Config flow: host/port (or mDNS), then the 6-digit code shown on the TV."""
from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigFlow, ConfigFlowResult
from homeassistant.const import CONF_HOST, CONF_PORT, CONF_TOKEN
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo

from .api import GlowUpClient, GlowUpConnectionError, GlowUpError
from .const import DEFAULT_PORT, DOMAIN

PAIR_ERRORS = {"wrong_code": "wrong_code", "pairing_blocked": "pairing_blocked"}
CODE_SCHEMA = vol.Schema({vol.Required("code"): str})


class GlowUpConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    def __init__(self) -> None:
        self._host = ""
        self._port = DEFAULT_PORT

    def _client(self, token: str | None = None) -> GlowUpClient:
        return GlowUpClient(async_get_clientsession(self.hass), self._host, self._port, token)

    @staticmethod
    def _pair_error(err: GlowUpError) -> str:
        if isinstance(err, GlowUpConnectionError):
            return "cannot_connect"
        return PAIR_ERRORS.get(err.error, "unknown")

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            self._host, self._port = user_input[CONF_HOST].strip(), user_input[CONF_PORT]
            try:
                await self._client().health()
            except GlowUpError:
                errors["base"] = "cannot_connect"
            else:
                return await self.async_step_pair()
        schema = vol.Schema({vol.Required(CONF_HOST): str, vol.Required(CONF_PORT, default=DEFAULT_PORT): int})
        return self.async_show_form(step_id="user", data_schema=schema, errors=errors)

    async def async_step_zeroconf(self, discovery_info: ZeroconfServiceInfo) -> ConfigFlowResult:
        self._host, self._port = discovery_info.host, discovery_info.port or DEFAULT_PORT
        if device_id := discovery_info.properties.get("id"):
            await self.async_set_unique_id(device_id)
            self._abort_if_unique_id_configured(updates={CONF_HOST: self._host, CONF_PORT: self._port})
        return await self.async_step_zeroconf_confirm()

    async def async_step_zeroconf_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is None:
            return self.async_show_form(step_id="zeroconf_confirm", description_placeholders={"host": self._host})
        return await self.async_step_pair()

    async def async_step_pair(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                token = await self._client().pair(user_input["code"].replace(" ", ""))
                info = await self._client(token).info()
            except GlowUpError as err:
                errors["base"] = self._pair_error(err)
            else:
                await self.async_set_unique_id(info["device_id"])
                self._abort_if_unique_id_configured(updates={CONF_HOST: self._host, CONF_PORT: self._port})
                return self.async_create_entry(
                    title=f"GlowUp TV — {info.get('name') or info.get('device') or self._host}",
                    data={CONF_HOST: self._host, CONF_PORT: self._port, CONF_TOKEN: token},
                )
        return self.async_show_form(step_id="pair", data_schema=CODE_SCHEMA, errors=errors)

    async def async_step_reauth(self, entry_data: dict[str, Any]) -> ConfigFlowResult:
        self._host, self._port = entry_data[CONF_HOST], entry_data[CONF_PORT]
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                token = await self._client().pair(user_input["code"].replace(" ", ""))
                info = await self._client(token).info()
            except GlowUpError as err:
                errors["base"] = self._pair_error(err)
            else:
                # The address may now belong to another GlowUp TV: never store its token on this entry.
                await self.async_set_unique_id(info["device_id"])
                self._abort_if_unique_id_mismatch()
                return self.async_update_reload_and_abort(self._get_reauth_entry(), data_updates={CONF_TOKEN: token})
        return self.async_show_form(step_id="reauth_confirm", data_schema=CODE_SCHEMA, errors=errors)
