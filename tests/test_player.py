"""Unit and integration tests for Tesla IPTV Player.
"""

import pytest
from starlette.testclient import TestClient
from main import app
from app.xtream import clean_server_url, XtreamClient
from app.stream_proxy import rewrite_m3u8


client = TestClient(app)


def test_clean_server_url():
    assert clean_server_url("http://example.com:8080/") == "http://example.com:8080"
    assert clean_server_url("example.com:8080") == "http://example.com:8080"
    assert clean_server_url("https://secure-iptv.net/path/") == "https://secure-iptv.net/path"


def test_xtream_client_url_builders():
    c = XtreamClient("http://myiptv.com:8080", "testuser", "testpass")
    live_m3u8 = c.build_live_stream_url("12345", extension="m3u8")
    assert live_m3u8 == "http://myiptv.com:8080/live/testuser/testpass/12345.m3u8"

    live_ts = c.build_live_stream_url("12345", extension="ts")
    assert live_ts == "http://myiptv.com:8080/live/testuser/testpass/12345.ts"

    vod_url = c.build_vod_stream_url("999", extension="mp4")
    assert vod_url == "http://myiptv.com:8080/movie/testuser/testpass/999.mp4"

    series_url = c.build_series_stream_url("888", extension="mkv")
    assert series_url == "http://myiptv.com:8080/series/testuser/testpass/888.mkv"


def test_rewrite_m3u8():
    sample_manifest = """#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXTINF:10.0,
segment0.ts
#EXTINF:10.0,
http://other-cdn.com/segment1.ts
#EXT-X-ENDLIST"""

    base_url = "http://iptv.server:8080/live/u/p/1.m3u8"
    proxy_base = "http://localhost:8000"

    rewritten = rewrite_m3u8(sample_manifest, base_url, proxy_base)

    assert "#EXTM3U" in rewritten
    assert "#EXT-X-ENDLIST" in rewritten
    # Relative segment should be resolved and routed to proxy
    expected_rel = "http://localhost:8000/stream/chunk?url=http%3A%2F%2Fiptv.server%3A8080%2Flive%2Fu%2Fp%2Fsegment0.ts"
    assert expected_rel in rewritten
    # Absolute segment should also be routed to proxy
    expected_abs = "http://localhost:8000/stream/chunk?url=http%3A%2F%2Fother-cdn.com%2Fsegment1.ts"
    assert expected_abs in rewritten


def test_root_index():
    resp = client.get("/")
    assert resp.status_code == 200
    assert "Tesla IPTV" in resp.text
    assert "viewport-fit=cover" in resp.text


def test_theater_url_api():
    resp = client.get("/api/theater_url")
    assert resp.status_code == 200
    data = resp.json()
    assert "theater_redirect_url" in data
    assert "youtube.com/redirect" in data["theater_redirect_url"]


def test_login_validation_failure():
    # Attempting to login to invalid/unreachable host returns appropriate error
    resp = client.post("/api/login", json={
        "server_url": "http://127.0.0.1:59999",
        "username": "dummy",
        "password": "dummy"
    })
    assert resp.status_code == 400
    data = resp.json()
    assert data["success"] is False
    assert "Failed to connect" in data["error"]


def test_mock_xtream_live_streams():
    from unittest.mock import AsyncMock, patch

    mock_categories = [{"category_id": "1", "category_name": "News"}]
    mock_streams = [
        {"num": 1, "name": "CNN HD", "stream_id": 101, "stream_icon": "http://logo.png"}
    ]
    mock_epg = [{"id": "1", "title": "Evening News"}]

    with patch.object(XtreamClient, "get_live_categories", new=AsyncMock(return_value=mock_categories)), \
         patch.object(XtreamClient, "get_live_streams", new=AsyncMock(return_value=mock_streams)), \
         patch.object(XtreamClient, "get_short_epg", new=AsyncMock(return_value=mock_epg)):

        # Test categories endpoint
        cat_resp = client.get("/api/categories?server_url=http://mock.iptv&username=u&password=p&type=live")
        assert cat_resp.status_code == 200
        assert cat_resp.json() == mock_categories

        # Test streams endpoint
        streams_resp = client.get("/api/streams?server_url=http://mock.iptv&username=u&password=p&type=live&category_id=1")
        assert streams_resp.status_code == 200
        assert streams_resp.json() == mock_streams

        # Test epg endpoint
        epg_resp = client.get("/api/epg?server_url=http://mock.iptv&username=u&password=p&stream_id=101")
        assert epg_resp.status_code == 200
        assert epg_resp.json() == mock_epg
