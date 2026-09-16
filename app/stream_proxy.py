"""Stream Proxy and M3U8 Manifest Rewriter.
Proxies live HLS, MPEG-TS, and VOD streams to avoid Mixed Content (HTTPS -> HTTP)
and CORS issues in the Tesla Chromium browser.
"""

import re
from typing import AsyncGenerator, Optional
from urllib.parse import quote, unquote, urljoin, urlparse
import httpx
from fastapi import Request, Response
from fastapi.responses import StreamingResponse

DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
CHUNK_SIZE = 64 * 1024  # 64 KB chunks for smooth streaming


def is_m3u8_content(content_type: str, url: str) -> bool:
    """Check if the content or URL indicates an HLS playlist."""
    return (
        "application/vnd.apple.mpegurl" in content_type.lower()
        or "application/x-mpegurl" in content_type.lower()
        or url.lower().endswith(".m3u8")
    )


def rewrite_m3u8(manifest_text: str, base_url: str, proxy_base_url: str) -> str:
    """
    Rewrites URIs in an M3U8 manifest so that sub-playlists and TS chunks
    route through this proxy server.
    """
    output_lines = []
    lines = manifest_text.splitlines()

    for line in lines:
        stripped = line.strip()
        if not stripped:
            output_lines.append(line)
            continue

        if stripped.startswith("#"):
            # Handle URI in tags like #EXT-X-KEY:METHOD=...,URI="..." or #EXT-X-MAP:URI="..."
            def replace_tag_uri(match):
                prefix = match.group(1)
                uri = match.group(2)
                suffix = match.group(3)
                abs_uri = urljoin(base_url, uri)
                proxied = f"{proxy_base_url}/stream/chunk?url={quote(abs_uri, safe='')}"
                return f'{prefix}"{proxied}"{suffix}'

            # Match URI="xyz" pattern in tags
            line_rewritten = re.sub(
                r'(URI\s*=\s*")([^"]+)(")',
                replace_tag_uri,
                line
            )
            output_lines.append(line_rewritten)
        else:
            # This is a media segment or sub-playlist URI
            abs_uri = urljoin(base_url, stripped)
            proxied_uri = f"{proxy_base_url}/stream/chunk?url={quote(abs_uri, safe='')}"
            output_lines.append(proxied_uri)

    return "\n".join(output_lines)


async def stream_remote_content(
    target_url: str,
    headers: dict,
    timeout: float = 30.0
) -> AsyncGenerator[bytes, None]:
    """Asynchronously stream bytes from a remote IPTV URL in chunks."""
    async with httpx.AsyncClient(timeout=timeout, verify=False, follow_redirects=True) as client:
        async with client.stream("GET", target_url, headers=headers) as response:
            async for chunk in response.aiter_bytes(chunk_size=CHUNK_SIZE):
                if chunk:
                    yield chunk


async def proxy_stream_request(request: Request, target_url: str) -> Response:
    """
    Proxies an arbitrary video stream or playlist URL.
    - If M3U8, rewrites segment paths to proxy URLs.
    - If binary (TS, MP4, etc.), streams response with byte-range and CORS support.
    """
    forward_headers = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Accept": "*/*",
    }

    # Forward Range header for VOD seeking
    range_header = request.headers.get("range")
    if range_header:
        forward_headers["Range"] = range_header

    client = httpx.AsyncClient(timeout=40.0, verify=False, follow_redirects=True)

    try:
        # First check response headers
        req = client.build_request("GET", target_url, headers=forward_headers)
        upstream_resp = await client.send(req, stream=True)

        status_code = upstream_resp.status_code
        content_type = upstream_resp.headers.get("content-type", "video/mp2t")

        # Base proxy URL from incoming request
        proxy_base_url = str(request.base_url).rstrip("/")

        # If it's an M3U8 manifest, read whole body and rewrite
        if is_m3u8_content(content_type, target_url):
            body_bytes = await upstream_resp.aread()
            await upstream_resp.aclose()
            await client.aclose()

            try:
                manifest_text = body_bytes.decode("utf-8", errors="replace")
                rewritten = rewrite_m3u8(manifest_text, target_url, proxy_base_url)
                body_bytes = rewritten.encode("utf-8")
            except Exception:
                pass

            response_headers = {
                "Content-Type": "application/vnd.apple.mpegurl",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
                "Access-Control-Allow-Headers": "*",
                "Cache-Control": "no-cache, no-store, must-revalidate",
            }
            return Response(content=body_bytes, status_code=status_code, headers=response_headers)

        # For binary streams (TS chunks, MP4, etc.), stream directly to client
        response_headers = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }

        # Forward key headers
        for h in ("content-type", "content-length", "content-range", "accept-ranges"):
            if h in upstream_resp.headers:
                response_headers[h] = upstream_resp.headers[h]

        async def body_iterator() -> AsyncGenerator[bytes, None]:
            try:
                async for chunk in upstream_resp.aiter_bytes(chunk_size=CHUNK_SIZE):
                    yield chunk
            finally:
                await upstream_resp.aclose()
                await client.aclose()

        return StreamingResponse(
            body_iterator(),
            status_code=status_code,
            headers=response_headers,
            media_type=content_type,
        )

    except Exception as e:
        await client.aclose()
        return Response(
            content=f"Stream proxy error: {str(e)}".encode("utf-8"),
            status_code=502,
            media_type="text/plain",
            headers={"Access-Control-Allow-Origin": "*"}
        )
