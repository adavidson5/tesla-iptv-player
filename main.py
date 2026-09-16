"""FastAPI Main Server for Tesla IPTV Web Player.
Serves the touch-optimized UI and proxies Xtream Codes API and media streams.
"""

from typing import Optional
from urllib.parse import quote, unquote
import os

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.stream_proxy import proxy_stream_request
from app.xtream import XtreamClient, clean_server_url

app = FastAPI(title="Tesla IPTV Player", version="1.0.0")

# Enable wide-open CORS so in-car browser and cross-origin tools never fail
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")


class LoginRequest(BaseModel):
    server_url: str
    username: str
    password: str


@app.post("/api/login")
async def api_login(req: LoginRequest):
    """Verify Xtream Codes credentials and return account details."""
    client = XtreamClient(req.server_url, req.username, req.password)
    try:
        auth_result = await client.authenticate()
        return auth_result
    except Exception as e:
        return JSONResponse(
            status_code=400,
            content={"success": False, "error": f"Failed to connect to IPTV server: {str(e)}"},
        )


@app.get("/api/categories")
async def api_categories(
    server_url: str = Query(...),
    username: str = Query(...),
    password: str = Query(...),
    type: str = Query("live", pattern="^(live|vod|series)$"),
):
    """Get category list for Live TV, Movies (VOD), or Series."""
    client = XtreamClient(server_url, username, password)
    try:
        if type == "live":
            categories = await client.get_live_categories()
        elif type == "vod":
            categories = await client.get_vod_categories()
        else:
            categories = await client.get_series_categories()
        return categories
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error fetching categories: {str(e)}")


@app.get("/api/streams")
async def api_streams(
    server_url: str = Query(...),
    username: str = Query(...),
    password: str = Query(...),
    type: str = Query("live", pattern="^(live|vod|series)$"),
    category_id: Optional[str] = Query(None),
):
    """Get streams/items in a category."""
    client = XtreamClient(server_url, username, password)
    try:
        if type == "live":
            streams = await client.get_live_streams(category_id=category_id)
        elif type == "vod":
            streams = await client.get_vod_streams(category_id=category_id)
        else:
            streams = await client.get_series(category_id=category_id)
        return streams
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error fetching streams: {str(e)}")


@app.get("/api/epg")
async def api_epg(
    server_url: str = Query(...),
    username: str = Query(...),
    password: str = Query(...),
    stream_id: str = Query(...),
):
    """Get short now/next EPG listing for a live stream."""
    client = XtreamClient(server_url, username, password)
    try:
        listings = await client.get_short_epg(stream_id)
        return listings
    except Exception as e:
        return []


@app.get("/api/vod_info")
async def api_vod_info(
    server_url: str = Query(...),
    username: str = Query(...),
    password: str = Query(...),
    vod_id: str = Query(...),
):
    """Get detailed information for a VOD movie."""
    client = XtreamClient(server_url, username, password)
    try:
        info = await client.get_vod_info(vod_id)
        return info
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error fetching VOD info: {str(e)}")


@app.get("/api/series_info")
async def api_series_info(
    server_url: str = Query(...),
    username: str = Query(...),
    password: str = Query(...),
    series_id: str = Query(...),
):
    """Get detailed series info including seasons and episodes."""
    client = XtreamClient(server_url, username, password)
    try:
        info = await client.get_series_info(series_id)
        return info
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error fetching series info: {str(e)}")


@app.get("/stream/live/{stream_id}")
async def proxy_live_stream(
    stream_id: str,
    request: Request,
    server_url: str = Query(...),
    username: str = Query(...),
    password: str = Query(...),
    ext: str = Query("m3u8"),
):
    """
    Proxy live TV stream.
    Defaults to .m3u8 (HLS), or .ts if requested.
    """
    client = XtreamClient(server_url, username, password)
    upstream_url = client.build_live_stream_url(stream_id, extension=ext)
    return await proxy_stream_request(request, upstream_url)


@app.get("/stream/vod/{stream_id}")
async def proxy_vod_stream(
    stream_id: str,
    request: Request,
    server_url: str = Query(...),
    username: str = Query(...),
    password: str = Query(...),
    ext: str = Query("mp4"),
):
    """Proxy VOD (movie) stream."""
    client = XtreamClient(server_url, username, password)
    upstream_url = client.build_vod_stream_url(stream_id, extension=ext)
    return await proxy_stream_request(request, upstream_url)


@app.get("/stream/series/{stream_id}")
async def proxy_series_stream(
    stream_id: str,
    request: Request,
    server_url: str = Query(...),
    username: str = Query(...),
    password: str = Query(...),
    ext: str = Query("mp4"),
):
    """Proxy series episode stream."""
    client = XtreamClient(server_url, username, password)
    upstream_url = client.build_series_stream_url(stream_id, extension=ext)
    return await proxy_stream_request(request, upstream_url)


@app.get("/stream/chunk")
async def proxy_chunk(request: Request, url: str = Query(...)):
    """Proxy a rewritten M3U8 chunk or subplaylist."""
    target_url = unquote(url)
    return await proxy_stream_request(request, target_url)


@app.get("/api/theater_url")
async def api_theater_url(request: Request):
    """
    Returns the Tesla Theater Mode redirect URL for opening this app in true fullscreen on Tesla.
    """
    base_url = str(request.base_url).rstrip("/")
    youtube_redirect = f"https://www.youtube.com/redirect?q={quote(base_url, safe='')}"
    return {
        "player_url": base_url,
        "theater_redirect_url": youtube_redirect,
        "instructions": (
            "Open the YouTube app in your Tesla Theater, click any link in video description or "
            "navigate to this redirect URL to launch the IPTV player in genuine full-screen mode!"
        ),
    }


# Mount static assets
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/")
async def root_index():
    index_file = os.path.join(STATIC_DIR, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return Response(content="Tesla IPTV Player - Static files not found.", media_type="text/plain")
