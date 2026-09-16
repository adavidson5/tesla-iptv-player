/**
 * Tesla IPTV Player - Video Engine
 * Supports HLS (.m3u8) via Hls.js, raw MPEG-TS (.ts) via mpegts.js, and native HTML5 video.
 * Tuned for rapid startup without aggressive watchdog reload loops.
 */

class IPTVPlayer {
  constructor(videoElement, options = {}) {
    this.video = videoElement;
    this.options = options;
    this.hls = null;
    this.mpegtsPlayer = null;
    this.currentStream = null;
    this.currentFormat = 'm3u8';
    this.aspectRatios = ['aspect-contain', 'aspect-cover', 'aspect-fill'];
    this.currentAspectIdx = 0;
    this.overlayTimer = null;
    this.isOverlayVisible = true;

    this.initEventListeners();
  }

  initEventListeners() {
    this.video.addEventListener('playing', () => {
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

    this.video.addEventListener('canplay', () => {
      this.hideLoading();
    });

    this.video.addEventListener('error', (e) => {
      console.error('HTML5 Video Error:', e);
      this.showLoading('Stream playback error. Tap format button to switch engine.');
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
      // Configure Hls.js for standard legacy IPTV (lowLatencyMode MUST be false)
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false, // Standard IPTV is not LL-HLS; true causes infinite buffer stalls!
        liveSyncDurationCount: 2, // Start 2 segments back from live head for instant start
        maxBufferLength: 20, // Buffer 20s ahead
        maxMaxBufferLength: 40,
        backBufferLength: 15,
        nudgeMaxRetry: 8,
        nudgeOffset: 0.1,
        manifestLoadingTimeOut: 15000,
        levelLoadingTimeOut: 15000,
        fragLoadingTimeOut: 25000,
      });

      this.hls = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(this.video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const playPromise = this.video.play();
        if (playPromise && playPromise.catch) {
          playPromise.catch(err => {
            console.warn('HLS Autoplay unmuted was blocked by browser:', err);
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
          console.warn('HLS Fatal Error:', data.type, data.details);
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.warn('HLS Network Error, recovering...');
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.warn('HLS Media Error, attempting media recovery...');
              hls.recoverMediaError();
              break;
            default:
              this.showLoading('Stream format error. Tap the format button to try MPEG-TS.');
              break;
          }
        }
      });
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
          enableStashBuffer: false, // Don't hoard buffer: decode and display immediately!
          autoCleanupSourceBuffer: true,
          autoCleanupMaxBackwardDuration: 30,
          autoCleanupMinBackwardDuration: 15,
        });

        this.mpegtsPlayer = player;
        player.attachMediaElement(this.video);
        player.load();

        const playPromise = player.play();
        if (playPromise && playPromise.catch) {
          playPromise.catch(err => {
            console.warn('MPEG-TS Autoplay issue:', err);
            if (err.name === 'NotAllowedError') {
              this.video.muted = true;
              player.play().catch(e => console.error('Muted autoplay failed:', e));
              this.showUnmuteToast();
            }
          });
        }

        player.on(mpegts.Events.ERROR, (errType, errDetail) => {
          console.error('MPEG-TS error event:', errType, errDetail);
          this.showLoading('MPEG-TS stream error. Tap format button to try HLS.');
        });
      } catch (err) {
        console.error('Failed to init mpegts.js:', err);
        this.playHLS(streamUrl.replace(/([?&])ext=[^&]+/, '$1ext=m3u8'));
      }
    } else {
      this.playHLS(streamUrl.replace(/([?&])ext=[^&]+/, '$1ext=m3u8'));
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
      }, 5000);
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
