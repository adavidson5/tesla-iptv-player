# ⚡ Tesla Model 3 IPTV Web Player

A touch-optimized, self-hosted web IPTV player designed specifically for the **2019 Tesla Model 3** (and all MCU2/MCU3 Tesla vehicles). Accepts **Xtream Codes** login credentials (Server URL, Username, Password) and provides streaming for Live TV, Movies (VOD), and TV Series.

---

## 🚗 Why This Player Was Built for Tesla

1. **Bypasses Mixed Content & CORS**: Most IPTV servers operate over unencrypted HTTP and lack CORS headers. The built-in async reverse proxy securely relays streams and rewrites M3U8 manifests so your Tesla Chromium browser never gets blocked.
2. **Dual Playback Engines**: Supports both `.m3u8` (HLS via Hls.js) and raw `.ts` (MPEG-TS via mpegts.js), covering virtually every Xtream IPTV provider.
3. **Automotive Touchscreen UI**: High-contrast OLED dark theme, oversized tap targets (>48px), quick-tap channel flipping (CH +/-), and stream stall auto-reconnect designed for cellular network handoffs.
4. **Persistent In-Car Login**: Your Xtream credentials are saved locally in the browser so you don't need to retype them on the Tesla virtual keyboard every time you get into your car.
5. **Tesla Fullscreen Theater Mode**: Includes built-in support and a helper link generator to launch in true full-screen mode via Tesla Theater.

---

## 🚀 Quick Start

### 1. Requirements
- Python 3.10+ (Python 3.13 supported)

### 2. Installation
Open a terminal in the project directory:

```bash
cd tesla-iptv-player
pip install -r requirements.txt
```

### 3. Start the Server
```bash
python run.py
```

The terminal will display your local network IP address, for example:
```
============================================================
  TESLA MODEL 3 IPTV PLAYER SERVER
============================================================
Local Access:         http://localhost:8000
Tesla In-Car URL:     http://192.168.1.150:8000
============================================================
```

---

## 🚙 Using It Inside Your Tesla Model 3

### Method 1: Connected to Home Wi-Fi or Phone Hotspot
1. Ensure your Tesla is connected to your home Wi-Fi or your phone's personal mobile hotspot.
2. Open the **Web Browser** on your Tesla Model 3 touchscreen.
3. Navigate to: `http://<YOUR_COMPUTER_IP>:8000` (e.g. `http://192.168.1.150:8000`).
4. Enter your Xtream Codes credentials:
   - **Server URL**: `http://iptv-provider.com:8080`
   - **Username**: `your_username`
   - **Password**: `your_password`
5. Tap **Connect & Stream**.

---

### Method 2: True 100% Full-Screen (Tesla Theater Hack)
Tesla's standard web browser retains top navigation bars. To watch in **100% borderless Full Screen**:
1. Park your car (Tesla Theater is active when parked).
2. Open the **Tesla Theater** app and tap **YouTube**.
3. Inside YouTube, click **Terms** or **Privacy** at the bottom (or sign in to Google and open a link in video description).
4. Tap the **⚡ Theater Mode** button in the top bar of this player to get your custom redirect URL:
   ```
   https://www.youtube.com/redirect?q=http://YOUR_SERVER_URL:8000
   ```
5. Opening that URL inside YouTube launches this player in true 100% fullscreen Theater mode with full audio!

---

### Method 3: Access Anywhere Over Tesla LTE (Free Cloudflare Tunnel)
If you want to use the player away from home over your car's built-in Tesla LTE connection without port-forwarding:
1. Download [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
2. Run:
   ```bash
   cloudflared tunnel --url http://localhost:8000
   ```
3. Cloudflare will give you a free, public HTTPS link (e.g. `https://random-words.trycloudflare.com`).
4. Bookmark that link in your Tesla browser to stream anywhere on the road!

---

## 🐳 Docker Deployment

To run in Docker or on a home server / NAS (Unraid, Synology, TrueNAS, Raspberry Pi):

```bash
docker compose up -d --build
```
The player will be available on port `8000`.

---

## 📺 Features Overview

- **Live TV**: Full category listing, search filtering, channel logos, and EPG (Now Playing).
- **Movies (VOD)**: Posters, metadata, and scrubbing with HTML5 range request support.
- **Series**: Season and episode picker.
- **Favorites**: One-tap star icon to save your go-to channels at the top.
- **Aspect Ratio Switcher**: Switch between **Fit (Contain)**, **Fill (Cover)**, and **Stretch**.
- **Auto Reconnect**: Detects buffer stalls and automatically attempts recovery with format fallback.
