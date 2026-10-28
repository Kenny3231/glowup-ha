"""Minimal async client for the GlowUp TV launcher API."""
from __future__ import annotations

from typing import Any

import aiohttp

from .const import CLIENT_NAME


class GlowUpError(Exception):
    """The TV answered with an error; str() is the TV's detail (never the token)."""

    error: str = ""


class GlowUpAuthError(GlowUpError):
    """401: token missing or revoked."""


class GlowUpConnectionError(GlowUpError):
    """The TV does not answer (off, wrong address)."""


class GlowUpClient:
    def __init__(self, session: aiohttp.ClientSession, host: str, port: int, token: str | None = None) -> None:
        self._session = session
        self._base = f"http://[{host}]:{port}/api/v1" if ":" in host else f"http://{host}:{port}/api/v1"
        self._token = token

    async def _request(self, method: str, path: str, body: Any = None, *, auth: bool = True, ctype: str = "application/json") -> Any:
        headers = {}
        if auth and self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        if body is not None:
            headers["Content-Type"] = ctype
        try:
            async with self._session.request(
                method, self._base + path, json=body, headers=headers, timeout=aiohttp.ClientTimeout(total=10)
            ) as resp:
                try:
                    data = await resp.json(content_type=None)
                except ValueError:
                    data = {}
                if resp.status == 401:
                    raise GlowUpAuthError("unauthorized")
                if resp.status >= 400:
                    err = data if isinstance(data, dict) else {}
                    exc = GlowUpError(str(err.get("detail") or err.get("error") or f"HTTP {resp.status}"))
                    exc.error = str(err.get("error") or "")
                    raise exc
                return data
        except (aiohttp.ClientError, TimeoutError) as err:
            raise GlowUpConnectionError(type(err).__name__) from err

    async def health(self) -> bool:
        return bool((await self._request("GET", "/health", auth=False)).get("ok"))

    async def pair(self, code: str) -> str:
        data = await self._request("POST", "/pair", {"code": code, "client": CLIENT_NAME}, auth=False)
        return data["token"]

    async def info(self) -> dict[str, Any]:
        return await self._request("GET", "/info")

    async def config(self) -> dict[str, Any]:
        return await self._request("GET", "/config")

    async def wallpapers(self) -> list[dict[str, Any]]:
        return (await self._request("GET", "/wallpapers")).get("wallpapers", [])

    async def patch_config(self, patch: dict[str, Any]) -> Any:
        return await self._request("PATCH", "/config", patch, ctype="application/merge-patch+json")

    async def put_widget(self, widget: str, content: dict[str, Any]) -> Any:
        return await self._request("PUT", f"/state/widgets/{widget}", content)

    async def delete_widget(self, widget: str) -> Any:
        return await self._request("DELETE", f"/state/widgets/{widget}")

    async def launch(self, package: str) -> Any:
        return await self._request("POST", "/actions/launch", {"package": package})

    async def toast(self, text: str, icon: str | None, seconds: int | None) -> Any:
        body: dict[str, Any] = {"text": text}
        if icon:
            body["icon"] = icon
        if seconds:
            body["seconds"] = seconds
        return await self._request("POST", "/actions/toast", body)
