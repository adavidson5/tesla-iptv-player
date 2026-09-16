/**
 * Tesla IPTV Player - Video Engine
 * Supports HLS (.m3u8) via Hls.js, raw MPEG-TS (.ts) via mpegts.js, and native HTML5 video.
 * Designed for automotive touchscreens with stall detection, auto-unmute recovery & auto-fallback.
 */

class IPTVPlayer {
  constructor(videoElement, options = {}) {
    this.video = videoElement;
    this.options = options;
    this.hls = null;
    this.mpegtsPlayer = null;
    this.currentStream = null;
    this.currentFormat = 'ts'; // 'ts', 'm3u8', 'direct'
    this.aspectRatios = ['aspect-contain', 'aspect-cover', 'aspect-fill'];
    this.currentAspectIdx = 0;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 4;
    this.reconnectTimer = null;
    this.stallTimer = null;
    this.overlayTimer = null;
    this.isOverlayVisible = true;

    this.initEventListeners();
  }

  initEventListeners() {
    this.video.addEventListener('playing', () => {
      this.reconnectAttempts = 0;
      clearTimeout(this.stallTimer);
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
      this.startStallWatchdog();
    });

    this.video.addEventListener('timeupdate', () => {
      clearTimeout(this.stallTimer);
    });

    this.video.addEventListener('error', (e) => {
      console.error('HTML5 Video Error:', e);
      clearTimeout(this.stallTimer);
      this.handleStreamError('Stream playback error. Attempting recovery...');
    });

    // Touch / click on video container toggles overlay
    const container = this.video.closest('.video-container');
    if (container) {
      container.addEventListener('click', (e) => {
        if (e.target === this.video || e.target.classList.contains('video-container')) {
          this.toggleOverlay();
        }
      });
    }
  }

  startStallWatchdog() {
    clearTimeout(this.stallTimer);
    // If stream stays buffering for > 7 seconds, attempt failover
    this.stallTimer = setTimeout(() => {
      if (this.video.paused || this.video.readyState < 3) {
        console.warn('Stream stall detected (>7s). Attempting format failover...');
        this.handleStallFailover();
      }
    }, 7000);
  }

  handleStallFailover() {
    if (!this.currentStream) return;

    if (this.currentFormat === 'm3u8') {
      console.log('Failing over from HLS to MPEG-TS...');
      this.showLoading('HLS stalled. Switching to MPEG-TS mode...');
      this.currentFormat = 'ts';
      const tsUrl = this.currentStream.url.replace(/([?&])ext=[^&]+/, '$1ext=ts');
      this.currentStream.url = tsUrl;
      this.playMpegTS(tsUrl);
    } else if (this.currentFormat === 'ts') {
      console.log('Failing over from MPEG-TS to HLS...');
      this.showLoading('MPEG-TS stalled. Switching to HLS mode...');
      this.currentFormat = 'm3u8';
      const hlsUrl = this.currentStream.url.replace(/([?&])ext=[^&]+/, '$1ext=m3u8');
      this.currentStream.url = hlsUrl;
      this.playHLS(hlsUrl);
    } else {
      this.handleStreamError('Stream stalled. Reconnecting...');
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
    clearTimeout(this.stallTimer);

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
   * Play stream with format selection (defaulting to MPEG-TS for Xtream live streams).
   */
  loadStream(streamConfig) {
    this.currentStream = streamConfig;
    this.destroyCurrent();
    this.showLoading(`Connecting to ${streamConfig.title || 'Channel'}...`);

    const { url, format } = streamConfig;
    this.currentFormat = format || 'ts';

    if (this.currentFormat === 'm3u8') {
      this.playHLS(url);
    } else if (this.currentFormat === 'ts') {
      this.playMpegTS(url);
    } else {
      this.playDirect(url);
    }
  }

  playMpegTS(streamUrl) {
    if (window.mpegts && mpegts.isSupported()) {
      try {
        const player = mpegts.createPlayer({
          type: 'mpegts',
          isLive: true,
          url: streamUrl,
        }, {
          enableWorker: true,
          lazyLoad: false,
          liveBufferLatencyChasing: false,
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 60,
          autoCleanupMinBackwardDuration: 30,
        });

        this.mpegtsPlayer = player;
        player.attachMediaElement(this.video);
        player.load();

        const playPromise = player.play();
        if (playPromise && playPromise.catch) {
          playPromise.catch(err => {
            console.warn('MPEG-TS Autoplay issue:', err);
            // If browser blocks unmuted audio autoplay, mute and retry
            if (err.name === 'NotAllowedError') {
              this.video.muted = true;
              player.play().catch(e => console.error('Muted autoplay failed:', e));
              this.showUnmuteToast();
            }
          });
        }

        player.on(mpegts.Events.ERROR, (errType, errDetail) => {
          console.error('MPEG-TS error event:', errType, errDetail);
          // Try HLS failover
          if (this.currentStream && this.currentFormat === 'ts') {
            this.handleStallFailover();
          }
        });

        this.startStallWatchdog();
      } catch (err) {
        console.error('Failed to init mpegts.js:', err);
        this.playHLS(streamUrl.replace('&ext=ts', '&ext=m3u8'));
      }
    } else {
      this.playHLS(streamUrl.replace('&ext=ts', '&ext=m3u8'));
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
        manifestLoadingTimeOut: 6000,
        manifestLoadingMaxRetry: 2,
      });

      this.hls = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(this.video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const playPromise = this.video.play();
        if (playPromise && playPromise.catch) {
          playPromise.catch(err => {
            console.warn('HLS Autoplay prevented:', err);
            if (err.name === 'NotAllowedError') {
              this.video.muted = true;
              this.video.play().catch(e => console.error(e));
              this.showUnmuteToast();
            }
          });
        }
      });

      hls.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.warn('HLS Fatal Error details:', data.type, data.details);
          // If manifest cannot be parsed or loaded, immediately fail over to MPEG-TS
          if (
            data.details === 'manifestParsingError' ||
            data.details === 'manifestLoadError' ||
            data.details === 'manifestLoadTimeOut' ||
            (data.response && data.response.code >= 400)
          ) {
            console.warn('HLS manifest unsupported by IPTV server. Switching to MPEG-TS...');
            this.showLoading('Switching to MPEG-TS mode...');
            if (this.currentStream) {
              this.currentFormat = 'ts';
              const tsUrl = this.currentStream.url.replace(/([?&])ext=[^&]+/, '$1ext=ts');
              this.currentStream.url = tsUrl;
              this.playMpegTS(tsUrl);
            }
            return;
          }

          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('HLS Network Error, attempting recovery...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('HLS Media Error, attempting recovery...');
              hls.recoverMediaError();
              break;
            default:
              this.handleStallFailover();
              break;
          }
        }
      });

      this.startStallWatchdog();
    } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      this.video.src = streamUrl;
      this.video.play().catch(err => {
        if (err.name === 'NotAllowedError') {
          this.video.muted = true;
          this.video.play();
          this.showUnmuteToast();
        }
      });
    } else {
      this.playDirect(streamUrl);
    }
  }

  playDirect(streamUrl) {
    this.video.src = streamUrl;
    this.video.load();
    const p = this.video.play();
    if (p && p.catch) {
      p.catch(err => {
        console.warn('Direct play blocked:', err);
        if (err.name === 'NotAllowedError') {
          this.video.muted = true;
          this.video.play();
          this.showUnmuteToast();
        }
      });
    }
  }

  showUnmuteToast() {
    const muteBtn = document.getElementById('mute-btn');
    if (muteBtn) {
      muteBtn.textContent = '🔇 Tap to Unmute';
      muteBtn.classList.add('primary');
      setTimeout(() => {
        muteBtn.textContent = '🔇';
        muteBtn.classList.remove('primary');
      }, 4000);
    }
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
      this.showLoading('Stream unavailable. Try switching format (TS/HLS) or select another channel.');
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
