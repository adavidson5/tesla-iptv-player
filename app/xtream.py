"""Xtream Codes API Client.
Provides async methods to authenticate, query categories, streams, VOD, series, and EPG.
"""

from typing import Any, Dict, List, Optional
import httpx
from urllib.parse import urljoin, quote

DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"


def clean_server_url(url: str) -> str:
    """Normalize the server URL by trimming whitespace, trailing slashes, and ensuring scheme."""
    url = url.strip()
    if not url.startswith(("http://", "https://")):
        url = "http://" + url
    return url.rstrip("/")


class XtreamClient:
    def __init__(self, server_url: str, username: str, password: str, timeout: float = 20.0):
        self.server_url = clean_server_url(server_url)
        self.username = username.strip()
        self.password = password.strip()
        self.timeout = timeout
        self.headers = {
            "User-Agent": DEFAULT_USER_AGENT,
            "Accept": "*/*",
        }

    @property
    def base_api_url(self) -> str:
        return f"{self.server_url}/player_api.php"

    def _get_api_params(self, extra_params: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        params = {
            "username": self.username,
            "password": self.password,
        }
        if extra_params:
            params.update(extra_params)
        return params

    async def authenticate(self) -> Dict[str, Any]:
        """Validate credentials against /player_api.php and return account info."""
        async with httpx.AsyncClient(timeout=self.timeout, verify=False, follow_redirects=True) as client:
            resp = await client.get(
                self.base_api_url,
                params=self._get_api_params(),
                headers=self.headers,
            )
            resp.raise_for_status()
            data = resp.json()

            user_info = data.get("user_info", {})
            auth = user_info.get("auth")
            status = user_info.get("status")

            if auth == 1 and status in ("Active", "active"):
                return {
                    "success": True,
                    "user_info": user_info,
                    "server_info": data.get("server_info", {}),
                }
            elif auth == 1:
                return {
                    "success": True,
                    "user_info": user_info,
                    "server_info": data.get("server_info", {}),
                    "warning": f"Account status is '{status}'",
                }
            else:
                message = user_info.get("message") or "Authentication failed. Invalid username or password."
                return {
                    "success": False,
                    "error": message,
                    "raw": data,
                }

    async def get_live_categories(self) -> List[Dict[str, Any]]:
        """Fetch list of Live TV categories."""
        async with httpx.AsyncClient(timeout=self.timeout, verify=False, follow_redirects=True) as client:
            resp = await client.get(
                self.base_api_url,
                params=self._get_api_params({"action": "get_live_categories"}),
                headers=self.headers,
            )
            resp.raise_for_status()
            data = resp.json()
            return data if isinstance(data, list) else []

    async def get_live_streams(self, category_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Fetch live streams, optionally filtered by category_id."""
        params: Dict[str, Any] = {"action": "get_live_streams"}
        if category_id and category_id != "all":
            params["category_id"] = category_id

        async with httpx.AsyncClient(timeout=self.timeout, verify=False, follow_redirects=True) as client:
            resp = await client.get(
                self.base_api_url,
                params=self._get_api_params(params),
                headers=self.headers,
            )
            resp.raise_for_status()
            data = resp.json()
            return data if isinstance(data, list) else []

    async def get_vod_categories(self) -> List[Dict[str, Any]]:
        """Fetch list of VOD (Movies) categories."""
        async with httpx.AsyncClient(timeout=self.timeout, verify=False, follow_redirects=True) as client:
            resp = await client.get(
                self.base_api_url,
                params=self._get_api_params({"action": "get_vod_categories"}),
                headers=self.headers,
            )
            resp.raise_for_status()
            data = resp.json()
            return data if isinstance(data, list) else []

    async def get_vod_streams(self, category_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Fetch VOD movies, optionally filtered by category_id."""
        params: Dict[str, Any] = {"action": "get_vod_streams"}
        if category_id and category_id != "all":
            params["category_id"] = category_id

        async with httpx.AsyncClient(timeout=self.timeout, verify=False, follow_redirects=True) as client:
            resp = await client.get(
                self.base_api_url,
                params=self._get_api_params(params),
                headers=self.headers,
            )
            resp.raise_for_status()
            data = resp.json()
            return data if isinstance(data, list) else []

    async def get_vod_info(self, vod_id: str) -> Dict[str, Any]:
        """Fetch detailed info about a VOD item."""
        async with httpx.AsyncClient(timeout=self.timeout, verify=False, follow_redirects=True) as client:
            resp = await client.get(
                self.base_api_url,
                params=self._get_api_params({"action": "get_vod_info", "vod_id": vod_id}),
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json()

    async def get_series_categories(self) -> List[Dict[str, Any]]:
        """Fetch list of Series categories."""
        async with httpx.AsyncClient(timeout=self.timeout, verify=False, follow_redirects=True) as client:
            resp = await client.get(
                self.base_api_url,
                params=self._get_api_params({"action": "get_series_categories"}),
                headers=self.headers,
            )
            resp.raise_for_status()
            data = resp.json()
            return data if isinstance(data, list) else []

    async def get_series(self, category_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Fetch TV series, optionally filtered by category_id."""
        params: Dict[str, Any] = {"action": "get_series"}
        if category_id and category_id != "all":
            params["category_id"] = category_id

        async with httpx.AsyncClient(timeout=self.timeout, verify=False, follow_redirects=True) as client:
            resp = await client.get(
                self.base_api_url,
                params=self._get_api_params(params),
                headers=self.headers,
            )
            resp.raise_for_status()
            data = resp.json()
            return data if isinstance(data, list) else []

    async def get_series_info(self, series_id: str) -> Dict[str, Any]:
        """Fetch seasons and episodes info for a TV series."""
        async with httpx.AsyncClient(timeout=self.timeout, verify=False, follow_redirects=True) as client:
            resp = await client.get(
                self.base_api_url,
                params=self._get_api_params({"action": "get_series_info", "series_id": series_id}),
                headers=self.headers,
            )
            resp.raise_for_status()
            return resp.json()

    async def get_short_epg(self, stream_id: str, limit: int = 4) -> List[Dict[str, Any]]:
        """Fetch short EPG (Now/Next) for a live stream."""
        async with httpx.AsyncClient(timeout=10.0, verify=False, follow_redirects=True) as client:
            resp = await client.get(
                self.base_api_url,
                params=self._get_api_params({"action": "get_short_epg", "stream_id": stream_id, "limit": limit}),
                headers=self.headers,
            )
            if resp.status_code != 200:
                return []
            data = resp.json()
            listings = data.get("epg_listings", [])
            return listings if isinstance(listings, list) else []

    def build_live_stream_url(self, stream_id: str, extension: str = "m3u8") -> str:
        """Construct direct Xtream live stream URL."""
        return f"{self.server_url}/live/{self.username}/{self.password}/{stream_id}.{extension}"

    def build_vod_stream_url(self, stream_id: str, extension: str = "mp4") -> str:
        """Construct direct Xtream movie (VOD) stream URL."""
        return f"{self.server_url}/movie/{self.username}/{self.password}/{stream_id}.{extension}"

    def build_series_stream_url(self, stream_id: str, extension: str = "mp4") -> str:
        """Construct direct Xtream series episode stream URL."""
        return f"{self.server_url}/series/{self.username}/{self.password}/{stream_id}.{extension}"
