/**
 * Tesla IPTV Player - Video Engine
 * Supports HLS (.m3u8) via Hls.js, raw MPEG-TS (.ts) via mpegts.js, and native HTML5 video.
 * Designed for automotive touchscreens with stall detection & auto-reconnect.
 */

class IPTVPlayer {
  constructor(videoElement, options = {}) {
    this.video = videoElement;
    this.options = options;
    this.hls = null;
    this.mpegtsPlayer = null;
    this.currentStream = null;
    this.currentFormat = 'm3u8'; // 'm3u8', 'ts', 'direct'
    this.aspectRatios = ['aspect-contain', 'aspect-cover', 'aspect-fill'];
    this.currentAspectIdx = 0;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectTimer = null;
    this.overlayTimer = null;
    this.isOverlayVisible = true;

    this.initEventListeners();
  }

  initEventListeners() {
    // Video element state listeners
    this.video.addEventListener('playing', () => {
      this.reconnectAttempts = 0;
      this.hideLoading();
      this.triggerOverlayFade();
      if (this.options.onPlayStateChange) {
        this.options.onPlayStateChange(true);
      }
    });

    this.video.addEventListener('pause', () => {
      this.showOverlay();
      if (this.options.onPlayStateChange) {
        this.options.onPlayStateChange(false);
      }
    });

    this.video.addEventListener('waiting', () => {
      this.showLoading('Buffering stream...');
    });

    this.video.addEventListener('error', (e) => {
      console.error('HTML5 Video Error:', e);
      this.handleStreamError('Stream playback error. Attempting reconnect...');
    });

    // Touch / click on video container toggles overlay
    const container = this.video.closest('.video-container');
    if (container) {
      container.addEventListener('click', (e) => {
        // If clicking directly on container or video, toggle overlay
        if (e.target === this.video || e.target.classList.contains('video-container')) {
          this.toggleOverlay();
        }
      });
    }
  }

  showLoading(message = 'Loading stream...') {
    const overlay = document.getElementById('player-state-overlay');
    const msgEl = document.getElementById('player-state-msg');
    if (overlay && msgEl) {
      msgEl.textContent = message;
      overlay.style.display = 'flex';
    }
  }

  hideLoading() {
    const overlay = document.getElementById('player-state-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
  }

  showOverlay() {
    clearTimeout(this.overlayTimer);
    const overlay = document.querySelector('.video-overlay');
    if (overlay) {
      overlay.classList.remove('hidden');
      this.isOverlayVisible = true;
    }
  }

  hideOverlay() {
    const overlay = document.querySelector('.video-overlay');
    if (overlay && !this.video.paused) {
      overlay.classList.add('hidden');
      this.isOverlayVisible = false;
    }
  }

  toggleOverlay() {
    if (this.isOverlayVisible) {
      this.hideOverlay();
    } else {
      this.showOverlay();
      this.triggerOverlayFade();
    }
  }

  triggerOverlayFade(timeoutMs = 4000) {
    clearTimeout(this.overlayTimer);
    this.overlayTimer = setTimeout(() => {
      if (!this.video.paused) {
        this.hideOverlay();
      }
    }, timeoutMs);
  }

  destroyCurrent() {
    clearTimeout(this.reconnectTimer);

    if (this.hls) {
      try {
        this.hls.destroy();
      } catch (e) {
        console.warn('Error destroying HLS:', e);
      }
      this.hls = null;
    }

    if (this.mpegtsPlayer) {
      try {
        this.mpegtsPlayer.pause();
        this.mpegtsPlayer.unload();
        this.mpegtsPlayer.detachMediaElement();
        this.mpegtsPlayer.destroy();
      } catch (e) {
        console.warn('Error destroying mpegts:', e);
      }
      this.mpegtsPlayer = null;
    }

    this.video.removeAttribute('src');
    this.video.load();
  }

  /**
   * Play stream with format auto-fallback (HLS -> MPEG-TS -> Direct).
   */
  loadStream(streamConfig) {
    this.currentStream = streamConfig;
    this.destroyCurrent();
    this.showLoading(`Connecting to ${streamConfig.title || 'Channel'}...`);

    const { url, format } = streamConfig;
    this.currentFormat = format || 'm3u8';

    if (this.currentFormat === 'm3u8') {
      this.playHLS(url);
    } else if (this.currentFormat === 'ts') {
      this.playMpegTS(url);
    } else {
      this.playDirect(url);
    }
  }

  playHLS(streamUrl) {
    if (window.Hls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
        backBufferLength: 60,
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
      });

      this.hls = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(this.video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.video.play().catch(err => {
          console.warn('Autoplay prevented, user interaction required:', err);
          this.showOverlay();
        });
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('HLS Fatal Network Error, attempting recovery...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('HLS Fatal Media Error, attempting recovery...');
              hls.recoverMediaError();
              break;
            default:
              console.error('Unrecoverable HLS error:', data);
              this.handleStreamError('Stream error. Falling back to MPEG-TS...');
              // Fallback to MPEG-TS format if available
              if (this.currentStream && this.currentFormat === 'm3u8') {
                this.currentFormat = 'ts';
                const tsUrl = this.currentStream.url.replace('&ext=m3u8', '&ext=ts');
                this.currentStream.url = tsUrl;
                this.playMpegTS(tsUrl);
              }
              break;
          }
        }
      });
    } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native Apple/Safari HLS
      this.video.src = streamUrl;
      this.video.play().catch(err => console.warn('Autoplay blocked:', err));
    } else {
      this.playDirect(streamUrl);
    }
  }

  playMpegTS(streamUrl) {
    if (window.mpegts && mpegts.isSupported()) {
      try {
        const player = mpegts.createPlayer({
          type: 'mse', // or 'mpegts'
          isLive: true,
          url: streamUrl,
        }, {
          enableWorker: true,
          lazyLoad: false,
          liveBufferLatencyChasing: true,
          liveBufferLatencyMaxLatency: 3.0,
          liveBufferLatencyMinRemain: 1.0,
        });

        this.mpegtsPlayer = player;
        player.attachMediaElement(this.video);
        player.load();
        player.play().catch(err => console.warn('MPEG-TS Autoplay blocked:', err));

        player.on(mpegts.Events.ERROR, (errType, errDetail) => {
          console.error('MPEG-TS error:', errType, errDetail);
          this.handleStreamError('MPEG-TS stream stalled. Retrying...');
        });
      } catch (err) {
        console.error('Failed to init mpegts.js:', err);
        this.playDirect(streamUrl);
      }
    } else {
      this.playDirect(streamUrl);
    }
  }

  playDirect(streamUrl) {
    this.video.src = streamUrl;
    this.video.load();
    this.video.play().catch(err => {
      console.warn('Direct play error/blocked:', err);
      this.showOverlay();
    });
  }

  handleStreamError(message) {
    this.reconnectAttempts++;
    if (this.reconnectAttempts <= this.maxReconnectAttempts) {
      this.showLoading(`${message} (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => {
        if (this.currentStream) {
          this.loadStream(this.currentStream);
        }
      }, 2500);
    } else {
      this.showLoading('Stream unavailable or offline. Please select another channel.');
    }
  }

  togglePlay() {
    if (this.video.paused) {
      this.video.play();
    } else {
      this.video.pause();
    }
  }

  toggleMute() {
    this.video.muted = !this.video.muted;
    return this.video.muted;
  }

  cycleAspectRatio() {
    this.aspectRatios.forEach(cls => this.video.classList.remove(cls));
    this.currentAspectIdx = (this.currentAspectIdx + 1) % this.aspectRatios.length;
    const nextCls = this.aspectRatios[this.currentAspectIdx];
    this.video.classList.add(nextCls);

    const labels = {
      'aspect-contain': 'Fit (Contain)',
      'aspect-cover': 'Zoom (Cover)',
      'aspect-fill': 'Stretch (Fill)'
    };
    return labels[nextCls];
  }

  requestFullscreen() {
    const elem = document.documentElement;
    if (elem.requestFullscreen) {
      elem.requestFullscreen();
    } else if (elem.webkitRequestFullscreen) {
      elem.webkitRequestFullscreen();
    } else if (elem.mozRequestFullScreen) {
      elem.mozRequestFullScreen();
    } else if (elem.msRequestFullscreen) {
      elem.msRequestFullscreen();
    }
  }
}

window.IPTVPlayer = IPTVPlayer;
