"""Launcher script for Tesla IPTV Player.
Detects local IP address and launches Uvicorn server on port 8000.
"""

import os
import socket
import sys
import uvicorn


def get_local_ip() -> str:
    """Find local network IP to display convenient Tesla browser URL."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        # Does not need to be reachable, used to determine interface IP
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = "127.0.0.1"
    finally:
        s.close()
    return ip


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    is_prod = os.environ.get("ENV") == "production"
    local_ip = get_local_ip()

    print("=" * 60)
    print("  TESLA MODEL 3 IPTV PLAYER SERVER")
    print("=" * 60)
    print(f"Port:                 {port}")
    print(f"Local Access:         http://localhost:{port}")
    print(f"Tesla In-Car URL:     http://{local_ip}:{port}")
    print("=" * 60)
    print("Tip: When your Tesla is connected to your home Wi-Fi or mobile hotspot,")
    print(f"simply type 'http://{local_ip}:{port}' into the Tesla Web Browser.")
    print("=" * 60)

    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=not is_prod)
