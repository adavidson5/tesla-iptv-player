"""Stream Proxy and M3U8 Manifest Rewriter.
Proxies live HLS, MPEG-TS, and VOD streams to avoid Mixed Content (HTTPS -> HTTP)
and CORS issues in the Tesla Chromium browser.
"""

import re
from typing import AsyncGenerator
from urllib.parse import quote, unquote, urljoin
import httpx
from fastapi import Request, Response
from fastapi.responses import StreamingResponse

# Many IPTV providers restrict access to known IPTV player User-Agents
IPTV_USER_AGENT = "IPTVSmartersPro/3.0.0 (Linux; Android 12)"
CHUNK_SIZE = 64 * 1024  # 64 KB chunks for smooth streaming


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


async def proxy_stream_request(request: Request, target_url: str) -> Response:
    """
    Proxies an arbitrary video stream or playlist URL.
    - If real M3U8 (#EXTM3U), rewrites segment paths to proxy URLs.
    - If binary (TS, MP4, etc.), immediately streams via StreamingResponse to avoid buffering hangs.
    """
    forward_headers = {
        "User-Agent": IPTV_USER_AGENT,
        "Accept": "*/*",
    }

    # Forward Range header for VOD seeking
    range_header = request.headers.get("range")
    if range_header:
        forward_headers["Range"] = range_header

    client = httpx.AsyncClient(timeout=30.0, verify=False, follow_redirects=True)

    try:
        req = client.build_request("GET", target_url, headers=forward_headers)
        upstream_resp = await client.send(req, stream=True)

        status_code = upstream_resp.status_code
        content_type = upstream_resp.headers.get("content-type", "").lower()
        proxy_base_url = str(request.base_url).rstrip("/")

        # If upstream failed (e.g. 401 Unauthorized, 404 Not Found), return error immediately
        if status_code >= 400:
            error_body = await upstream_resp.aread()
            await upstream_resp.aclose()
            await client.aclose()
            return Response(
                content=error_body,
                status_code=status_code,
                headers={"Access-Control-Allow-Origin": "*", "Content-Type": content_type or "text/plain"},
            )

        # Read first chunk to inspect header bytes without buffering the whole infinite stream
        stream_iter = upstream_resp.aiter_bytes(chunk_size=CHUNK_SIZE)
        try:
            first_chunk = await anext(stream_iter)
        except StopAsyncIteration:
            first_chunk = b""

        # Check if the content is truly an HLS M3U8 text manifest
        is_known_binary = any(t in content_type for t in [
            "video/mp2t", "video/mp4", "video/mpeg", "video/quicktime", "application/octet-stream"
        ])
        starts_with_extm3u = first_chunk.lstrip().startswith(b"#EXTM3U")

        if starts_with_extm3u and not is_known_binary:
            # It really is an HLS playlist! Read remaining chunks (capped at 512KB so it can never hang)
            body_parts = [first_chunk]
            total_size = len(first_chunk)
            async for chunk in stream_iter:
                body_parts.append(chunk)
                total_size += len(chunk)
                if total_size > 512 * 1024:
                    break

            await upstream_resp.aclose()
            await client.aclose()

            manifest_bytes = b"".join(body_parts)
            try:
                manifest_text = manifest_bytes.decode("utf-8", errors="replace")
                rewritten = rewrite_m3u8(manifest_text, target_url, proxy_base_url)
                manifest_bytes = rewritten.encode("utf-8")
            except Exception:
                pass

            response_headers = {
                "Content-Type": "application/vnd.apple.mpegurl",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
                "Access-Control-Allow-Headers": "*",
                "Cache-Control": "no-cache, no-store, must-revalidate",
            }
            return Response(content=manifest_bytes, status_code=status_code, headers=response_headers)

        # Binary stream (MPEG-TS, MP4, etc.) - Stream directly to browser in real-time
        response_headers = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
            "Access-Control-Allow-Headers": "*",
            "Cache-Control": "no-cache, no-store",
        }

        # Forward key streaming headers
        for h in ("content-length", "content-range", "accept-ranges"):
            if h in upstream_resp.headers:
                response_headers[h] = upstream_resp.headers[h]

        # Determine media type: default to video/mp2t for IPTV live streams
        media_type = upstream_resp.headers.get("content-type")
        if not media_type or "text" in media_type.lower() or "octet-stream" in media_type.lower():
            media_type = "video/mp2t"
        response_headers["Content-Type"] = media_type

        async def body_iterator() -> AsyncGenerator[bytes, None]:
            try:
                if first_chunk:
                    yield first_chunk
                async for chunk in stream_iter:
                    yield chunk
            finally:
                await upstream_resp.aclose()
                await client.aclose()

        return StreamingResponse(
            body_iterator(),
            status_code=status_code,
            headers=response_headers,
            media_type=media_type,
        )

    except Exception as e:
        await client.aclose()
        return Response(
            content=f"Stream proxy error: {str(e)}".encode("utf-8"),
            status_code=502,
            media_type="text/plain",
            headers={"Access-Control-Allow-Origin": "*"}
        )
