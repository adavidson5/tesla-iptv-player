/**
 * Tesla Model 3 IPTV Player - Main Application Controller
 */

(function () {
  // App State
  const state = {
    auth: {
      serverUrl: '',
      username: '',
      password: '',
      isLoggedIn: false,
      userInfo: null,
      serverInfo: null,
    },
    activeTab: 'live', // 'live', 'vod', 'series', 'favs'
    categories: [],
    activeCategoryId: 'all',
    streams: [],
    filteredStreams: [],
    activeStream: null,
    activeStreamIndex: -1,
    favorites: JSON.parse(localStorage.getItem('tesla_iptv_favs') || '[]'),
    streamFormat: localStorage.getItem('tesla_iptv_format') || 'm3u8', // 'm3u8' (HLS) or 'ts' (MPEG-TS)
    searchQuery: '',
    isSidebarCollapsed: false,
  };

  let player = null;

  // DOM Elements
  const elements = {
    video: document.getElementById('iptv-video'),
    loginModal: document.getElementById('login-modal'),
    theaterModal: document.getElementById('theater-modal'),
    settingsModal: document.getElementById('settings-modal'),
    loginForm: document.getElementById('login-form'),
    serverUrlInput: document.getElementById('server-url-input'),
    usernameInput: document.getElementById('username-input'),
    passwordInput: document.getElementById('password-input'),
    loginError: document.getElementById('login-error'),
    navTabs: document.querySelectorAll('.tab-btn'),
    categorySelect: document.getElementById('category-select'),
    searchInput: document.getElementById('search-input'),
    clearSearchBtn: document.getElementById('clear-search-btn'),
    streamList: document.getElementById('stream-list'),
    currentTitle: document.getElementById('current-title'),
    currentEpg: document.getElementById('current-epg'),
    liveBadge: document.getElementById('live-badge'),
    playPauseBtn: document.getElementById('play-pause-btn'),
    centerPlayBtn: document.getElementById('center-play-btn'),
    muteBtn: document.getElementById('mute-btn'),
    aspectBtn: document.getElementById('aspect-btn'),
    fullscreenBtn: document.getElementById('fullscreen-btn'),
    formatBtn: document.getElementById('format-btn'),
    settingFormatSelect: document.getElementById('setting-format-select'),
    channelPrevBtn: document.getElementById('channel-prev-btn'),
    channelNextBtn: document.getElementById('channel-next-btn'),
    theaterBtn: document.getElementById('theater-btn'),
    settingsBtn: document.getElementById('settings-btn'),
    theaterRedirectLink: document.getElementById('theater-redirect-link'),
    copyTheaterLinkBtn: document.getElementById('copy-theater-link-btn'),
    toggleSidebarBtn: document.getElementById('toggle-sidebar-btn'),
    explorerPanel: document.querySelector('.explorer-panel'),
  };

  // Initialize Application
  function init() {
    initPlayer();
    initEventListeners();
    updateFormatButton();
    loadStoredCredentials();
  }

  function updateFormatButton() {
    if (elements.formatBtn) {
      elements.formatBtn.textContent = state.streamFormat === 'ts' ? '⚡ TS' : '📡 HLS';
      elements.formatBtn.title = state.streamFormat === 'ts'
        ? 'Stream Engine: MPEG-TS (Click to switch to HLS)'
        : 'Stream Engine: HLS (Click to switch to MPEG-TS)';
    }
    if (elements.settingFormatSelect) {
      elements.settingFormatSelect.value = state.streamFormat;
    }
  }

  function initPlayer() {
    player = new IPTVPlayer(elements.video, {
      onPlayStateChange: (isPlaying) => {
        const icon = isPlaying ? '⏸' : '▶';
        if (elements.playPauseBtn) elements.playPauseBtn.textContent = icon;
        if (elements.centerPlayBtn) elements.centerPlayBtn.textContent = icon;
      },
    });
  }

  function initEventListeners() {
    // Navigation Tabs
    elements.navTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        switchTab(tabName);
      });
    });

    // Login Form
    elements.loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      await handleLogin();
    });

    // Category Selector
    elements.categorySelect.addEventListener('change', (e) => {
      state.activeCategoryId = e.target.value;
      loadStreamsForActiveTab();
    });

    // Search Box
    elements.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value.toLowerCase().trim();
      elements.clearSearchBtn.style.display = state.searchQuery ? 'block' : 'none';
      filterStreams();
    });

    elements.clearSearchBtn.addEventListener('click', () => {
      elements.searchInput.value = '';
      state.searchQuery = '';
      elements.clearSearchBtn.style.display = 'none';
      filterStreams();
    });

    // Player Controls
    elements.playPauseBtn.addEventListener('click', () => player.togglePlay());
    elements.centerPlayBtn.addEventListener('click', () => player.togglePlay());

    elements.muteBtn.addEventListener('click', () => {
      const isMuted = player.toggleMute();
      elements.muteBtn.textContent = isMuted ? '🔇' : '🔊';
    });

    elements.aspectBtn.addEventListener('click', () => {
      const aspectName = player.cycleAspectRatio();
      elements.aspectBtn.title = aspectName;
    });

    elements.fullscreenBtn.addEventListener('click', () => {
      player.requestFullscreen();
    });

    // Stream Engine Format Toggle (TS vs HLS)
    if (elements.formatBtn) {
      elements.formatBtn.addEventListener('click', () => {
        state.streamFormat = state.streamFormat === 'ts' ? 'm3u8' : 'ts';
        localStorage.setItem('tesla_iptv_format', state.streamFormat);
        updateFormatButton();
        if (state.activeStream && state.activeTab === 'live') {
          playChannelByIndex(state.activeStreamIndex);
        }
      });
    }

    if (elements.settingFormatSelect) {
      elements.settingFormatSelect.addEventListener('change', (e) => {
        state.streamFormat = e.target.value;
        localStorage.setItem('tesla_iptv_format', state.streamFormat);
        updateFormatButton();
        if (state.activeStream && state.activeTab === 'live') {
          playChannelByIndex(state.activeStreamIndex);
        }
      });
    }

    // Channel Next / Previous
    elements.channelPrevBtn.addEventListener('click', () => changeChannel(-1));
    elements.channelNextBtn.addEventListener('click', () => changeChannel(1));

    // Modals
    elements.theaterBtn.addEventListener('click', openTheaterModal);
    elements.settingsBtn.addEventListener('click', () => openModal(elements.settingsModal));

    document.querySelectorAll('.modal-close-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeAllModals();
      });
    });

    // Copy Theater Link
    if (elements.copyTheaterLinkBtn) {
      elements.copyTheaterLinkBtn.addEventListener('click', () => {
        const link = elements.theaterRedirectLink.textContent;
        navigator.clipboard.writeText(link).then(() => {
          elements.copyTheaterLinkBtn.textContent = 'Copied!';
          setTimeout(() => {
            elements.copyTheaterLinkBtn.textContent = 'Copy Link';
          }, 2000);
        });
      });
    }

    // Toggle Sidebar on small / theater screens
    if (elements.toggleSidebarBtn) {
      elements.toggleSidebarBtn.addEventListener('click', () => {
        state.isSidebarCollapsed = !state.isSidebarCollapsed;
        elements.explorerPanel.classList.toggle('collapsed', state.isSidebarCollapsed);
        elements.toggleSidebarBtn.textContent = state.isSidebarCollapsed ? '☰ List' : '✕ Hide';
      });
    }

    // Logout button inside settings
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', handleLogout);
    }
  }

  function openModal(modalEl) {
    if (modalEl) modalEl.style.display = 'flex';
  }

  function closeModal(modalEl) {
    if (modalEl) modalEl.style.display = 'none';
  }

  function closeAllModals() {
    document.querySelectorAll('.modal-backdrop').forEach((m) => (m.style.display = 'none'));
  }

  // Credentials & Login Management
  function loadStoredCredentials() {
    const savedServer = localStorage.getItem('tesla_iptv_server');
    const savedUser = localStorage.getItem('tesla_iptv_user');
    const savedPass = localStorage.getItem('tesla_iptv_pass');

    if (savedServer && savedUser && savedPass) {
      elements.serverUrlInput.value = savedServer;
      elements.usernameInput.value = savedUser;
      elements.passwordInput.value = savedPass;
      state.auth.serverUrl = savedServer;
      state.auth.username = savedUser;
      state.auth.password = savedPass;
      handleLogin(true);
    } else {
      openModal(elements.loginModal);
    }
  }

  async function handleLogin(isAutoLogin = false) {
    const serverUrl = elements.serverUrlInput.value.trim();
    const username = elements.usernameInput.value.trim();
    const password = elements.passwordInput.value.trim();

    if (!serverUrl || !username || !password) {
      showLoginError('Please enter Server URL, Username, and Password.');
      return;
    }

    showLoginError('');
    const submitBtn = elements.loginForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
      const resp = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ server_url: serverUrl, username, password }),
      });

      const data = await resp.json();

      if (data.success) {
        state.auth.serverUrl = serverUrl;
        state.auth.username = username;
        state.auth.password = password;
        state.auth.isLoggedIn = true;
        state.auth.userInfo = data.user_info;
        state.auth.serverInfo = data.server_info;

        // Persist to localStorage for effortless Tesla startup
        localStorage.setItem('tesla_iptv_server', serverUrl);
        localStorage.setItem('tesla_iptv_user', username);
        localStorage.setItem('tesla_iptv_pass', password);

        closeModal(elements.loginModal);
        updateAccountInfo();
        loadCategories();
      } else {
        showLoginError(data.error || 'Login failed. Check your credentials.');
        if (isAutoLogin) openModal(elements.loginModal);
      }
    } catch (err) {
      showLoginError(`Connection error: ${err.message}`);
      if (isAutoLogin) openModal(elements.loginModal);
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function showLoginError(msg) {
    if (elements.loginError) {
      elements.loginError.textContent = msg;
      elements.loginError.style.display = msg ? 'block' : 'none';
    }
  }

  function handleLogout() {
    localStorage.removeItem('tesla_iptv_server');
    localStorage.removeItem('tesla_iptv_user');
    localStorage.removeItem('tesla_iptv_pass');
    state.auth.isLoggedIn = false;
    player.destroyCurrent();
    closeAllModals();
    openModal(elements.loginModal);
  }

  function updateAccountInfo() {
    const user = state.auth.userInfo;
    if (!user) return;

    const expiryEl = document.getElementById('account-expiry');
    const statusEl = document.getElementById('account-status');
    const connectionsEl = document.getElementById('account-connections');

    if (expiryEl && user.exp_date) {
      const date = new Date(parseInt(user.exp_date) * 1000);
      expiryEl.textContent = isNaN(date.getTime()) ? user.exp_date : date.toLocaleDateString();
    }
    if (statusEl) statusEl.textContent = user.status || 'Active';
    if (connectionsEl) connectionsEl.textContent = `${user.active_cons || 0} / ${user.max_connections || 1}`;
  }

  // Tabs & Categories
  function switchTab(tabName) {
    state.activeTab = tabName;
    state.activeCategoryId = 'all';
    state.searchQuery = '';
    elements.searchInput.value = '';
    elements.clearSearchBtn.style.display = 'none';

    elements.navTabs.forEach((tab) => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    if (tabName === 'favs') {
      renderFavorites();
      elements.categorySelect.style.display = 'none';
    } else {
      elements.categorySelect.style.display = 'block';
      loadCategories();
    }
  }

  async function loadCategories() {
    if (!state.auth.isLoggedIn || state.activeTab === 'favs') return;

    elements.categorySelect.innerHTML = '<option value="all">Loading Categories...</option>';

    try {
      const params = new URLSearchParams({
        server_url: state.auth.serverUrl,
        username: state.auth.username,
        password: state.auth.password,
        type: state.activeTab,
      });

      const resp = await fetch(`/api/categories?${params.toString()}`);
      if (!resp.ok) throw new Error('Failed to load categories');
      const categories = await resp.json();
      state.categories = categories;

      renderCategorySelect(categories);
      loadStreamsForActiveTab();
    } catch (err) {
      console.error('Error loading categories:', err);
      elements.categorySelect.innerHTML = '<option value="all">All Categories</option>';
      loadStreamsForActiveTab();
    }
  }

  function renderCategorySelect(categories) {
    let optionsHtml = '<option value="all">★ All Categories</option>';
    categories.forEach((cat) => {
      optionsHtml += `<option value="${cat.category_id}">${cat.category_name}</option>`;
    });
    elements.categorySelect.innerHTML = optionsHtml;
    elements.categorySelect.value = state.activeCategoryId;
  }

  // Loading & Displaying Streams
  async function loadStreamsForActiveTab() {
    if (!state.auth.isLoggedIn) return;

    elements.streamList.innerHTML = '<div class="player-state-overlay" style="position: relative; background: transparent; height: 160px;"><div class="spinner"></div><div class="player-state-msg">Fetching content...</div></div>';

    try {
      const params = new URLSearchParams({
        server_url: state.auth.serverUrl,
        username: state.auth.username,
        password: state.auth.password,
        type: state.activeTab,
      });

      if (state.activeCategoryId && state.activeCategoryId !== 'all') {
        params.append('category_id', state.activeCategoryId);
      }

      const resp = await fetch(`/api/streams?${params.toString()}`);
      if (!resp.ok) throw new Error('Failed to load streams');
      const streams = await resp.json();
      state.streams = streams;
      filterStreams();
    } catch (err) {
      console.error('Error loading streams:', err);
      elements.streamList.innerHTML = `<div class="player-state-msg" style="padding: 2rem;">Error: ${err.message}</div>`;
    }
  }

  function filterStreams() {
    let list = state.streams;

    if (state.searchQuery) {
      list = list.filter((item) => {
        const name = (item.name || item.title || '').toLowerCase();
        return name.includes(state.searchQuery);
      });
    }

    state.filteredStreams = list;
    renderStreamList(list);
  }

  function renderStreamList(items) {
    if (!items || items.length === 0) {
      elements.streamList.innerHTML = '<div class="player-state-msg" style="padding: 2rem; color: var(--text-muted);">No channels or movies found in this category.</div>';
      return;
    }

    if (state.activeTab === 'live') {
      renderLiveChannels(items);
    } else {
      renderVodOrSeriesGrid(items);
    }
  }

  function renderLiveChannels(channels) {
    const html = channels
      .map((ch, idx) => {
        const streamId = ch.stream_id;
        const name = ch.name || `Channel ${ch.num || idx + 1}`;
        const icon = ch.stream_icon;
        const isFav = isFavorite(streamId);
        const isActive = state.activeStream && state.activeStream.stream_id === streamId;

        return `
          <div class="channel-card ${isActive ? 'active' : ''}" data-idx="${idx}" data-stream-id="${streamId}">
            <div class="channel-logo">
              ${icon ? `<img src="${icon}" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex';" loading="lazy">` : ''}
              <div class="channel-logo-placeholder" style="${icon ? 'display:none;' : ''}">TV</div>
            </div>
            <div class="channel-details">
              <div class="channel-name">${escapeHtml(name)}</div>
              <div class="channel-now-playing" id="epg-${streamId}">Tap to play</div>
            </div>
            <button class="channel-fav-btn ${isFav ? 'favorited' : ''}" data-stream-id="${streamId}" title="Favorite">
              ${isFav ? '★' : '☆'}
            </button>
          </div>
        `;
      })
      .join('');

    elements.streamList.innerHTML = `<div class="stream-list">${html}</div>`;

    // Bind channel clicks
    elements.streamList.querySelectorAll('.channel-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.channel-fav-btn')) return;
        const idx = parseInt(card.dataset.idx, 10);
        playChannelByIndex(idx);
      });
    });

    // Bind favorite button clicks
    elements.streamList.querySelectorAll('.channel-fav-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const streamId = btn.dataset.streamId;
        const channel = channels.find((c) => String(c.stream_id) === String(streamId));
        if (channel) {
          toggleFavorite(channel);
          btn.classList.toggle('favorited');
          btn.textContent = isFavorite(streamId) ? '★' : '☆';
        }
      });
    });
  }

  function renderVodOrSeriesGrid(items) {
    const html = items
      .map((item, idx) => {
        const id = item.stream_id || item.series_id;
        const title = item.name || item.title || 'Untitled';
        const poster = item.stream_icon || item.cover;

        return `
          <div class="vod-card" data-idx="${idx}" data-id="${id}">
            <img class="vod-poster" src="${poster || ''}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22150%22 fill=%22%23222%22><text x=%2250%%22 y=%2250%%22 fill=%22%23666%22 font-size=%2214%22 text-anchor=%22middle%22>No Poster</text></svg>'" loading="lazy">
            <div class="vod-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
          </div>
        `;
      })
      .join('');

    elements.streamList.innerHTML = `<div class="vod-grid">${html}</div>`;

    elements.streamList.querySelectorAll('.vod-card').forEach((card) => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.dataset.idx, 10);
        const item = state.filteredStreams[idx];
        if (state.activeTab === 'vod') {
          playVodMovie(item);
        } else if (state.activeTab === 'series') {
          openSeriesDetails(item);
        }
      });
    });
  }

  // Playback Triggers
  function playChannelByIndex(idx) {
    if (idx < 0 || idx >= state.filteredStreams.length) return;

    state.activeStreamIndex = idx;
    const channel = state.filteredStreams[idx];
    state.activeStream = channel;

    // Update active UI cards
    elements.streamList.querySelectorAll('.channel-card').forEach((card, i) => {
      card.classList.toggle('active', i === idx);
    });

    const streamId = channel.stream_id;
    const streamName = channel.name || `Channel ${channel.num || idx + 1}`;

    elements.currentTitle.textContent = streamName;
    elements.currentEpg.textContent = 'Loading live stream...';
    elements.liveBadge.style.display = 'inline-block';

    const fmt = state.streamFormat || 'ts';

    // Build proxied stream URL (TS or M3U8 based on user preference/provider support)
    const proxyUrl = `/stream/live/${streamId}?server_url=${encodeURIComponent(state.auth.serverUrl)}&username=${encodeURIComponent(state.auth.username)}&password=${encodeURIComponent(state.auth.password)}&ext=${fmt}`;

    player.loadStream({
      url: proxyUrl,
      title: streamName,
      format: fmt,
      streamId: streamId,
    });

    fetchEPG(streamId);
  }

  function playVodMovie(item) {
    const streamId = item.stream_id;
    const title = item.name || 'Movie';
    const ext = item.container_extension || 'mp4';

    elements.currentTitle.textContent = title;
    elements.currentEpg.textContent = 'VOD Movie';
    elements.liveBadge.style.display = 'none';

    const proxyUrl = `/stream/vod/${streamId}?server_url=${encodeURIComponent(state.auth.serverUrl)}&username=${encodeURIComponent(state.auth.username)}&password=${encodeURIComponent(state.auth.password)}&ext=${ext}`;

    player.loadStream({
      url: proxyUrl,
      title: title,
      format: 'direct',
      streamId: streamId,
    });
  }

  async function openSeriesDetails(seriesItem) {
    const seriesId = seriesItem.series_id;
    elements.streamList.innerHTML = '<div class="player-state-overlay" style="position: relative; background: transparent; height: 160px;"><div class="spinner"></div><div class="player-state-msg">Loading episodes...</div></div>';

    try {
      const params = new URLSearchParams({
        server_url: state.auth.serverUrl,
        username: state.auth.username,
        password: state.auth.password,
        series_id: seriesId,
      });

      const resp = await fetch(`/api/series_info?${params.toString()}`);
      if (!resp.ok) throw new Error('Failed to load series');
      const data = await resp.json();
      renderSeriesEpisodes(data, seriesItem);
    } catch (err) {
      console.error(err);
      loadStreamsForActiveTab();
    }
  }

  function renderSeriesEpisodes(data, seriesItem) {
    const seasons = data.seasons || [];
    const episodes = data.episodes || {};

    let html = `
      <div style="padding: 0.5rem; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border-color); margin-bottom: 0.5rem;">
        <button class="icon-btn" id="back-to-series-btn">← Back to Series</button>
        <div style="font-weight: 700; font-size: 1.1rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 65%;">${escapeHtml(seriesItem.name)}</div>
      </div>
    `;

    Object.keys(episodes).forEach((seasonNum) => {
      html += `<div style="font-weight: 700; color: var(--tesla-red); margin: 0.75rem 0 0.25rem 0.5rem;">Season ${seasonNum}</div>`;
      const epList = episodes[seasonNum] || [];

      epList.forEach((ep) => {
        const epTitle = ep.title || `Episode ${ep.episode_num}`;
        const epId = ep.id;
        const ext = ep.container_extension || 'mp4';

        html += `
          <div class="channel-card" data-ep-id="${epId}" data-ext="${ext}" data-ep-title="${escapeHtml(epTitle)}" style="margin-bottom: 0.4rem;">
            <div class="channel-details">
              <div class="channel-name">E${ep.episode_num}: ${escapeHtml(epTitle)}</div>
            </div>
            <button class="btn btn-primary" style="min-height: 40px; padding: 0 1rem; font-size: 0.85rem;">Play</button>
          </div>
        `;
      });
    });

    elements.streamList.innerHTML = html;

    const backBtn = document.getElementById('back-to-series-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => filterStreams());
    }

    elements.streamList.querySelectorAll('.channel-card[data-ep-id]').forEach((card) => {
      card.addEventListener('click', () => {
        const epId = card.dataset.epId;
        const ext = card.dataset.ext;
        const title = `${seriesItem.name} - ${card.dataset.epTitle}`;

        elements.currentTitle.textContent = title;
        elements.currentEpg.textContent = 'TV Series';
        elements.liveBadge.style.display = 'none';

        const proxyUrl = `/stream/series/${epId}?server_url=${encodeURIComponent(state.auth.serverUrl)}&username=${encodeURIComponent(state.auth.username)}&password=${encodeURIComponent(state.auth.password)}&ext=${ext}`;

        player.loadStream({
          url: proxyUrl,
          title: title,
          format: 'direct',
          streamId: epId,
        });
      });
    });
  }

  function changeChannel(delta) {
    if (state.filteredStreams.length === 0) return;
    let nextIdx = state.activeStreamIndex + delta;
    if (nextIdx < 0) nextIdx = state.filteredStreams.length - 1;
    if (nextIdx >= state.filteredStreams.length) nextIdx = 0;
    playChannelByIndex(nextIdx);
  }

  // EPG Handling
  async function fetchEPG(streamId) {
    try {
      const params = new URLSearchParams({
        server_url: state.auth.serverUrl,
        username: state.auth.username,
        password: state.auth.password,
        stream_id: streamId,
      });

      const resp = await fetch(`/api/epg?${params.toString()}`);
      if (!resp.ok) return;
      const listings = await resp.json();

      if (listings && listings.length > 0) {
        const now = listings[0];
        const title = decodeBase64Safe(now.title) || now.title;
        elements.currentEpg.textContent = `Now: ${title}`;

        const cardEpg = document.getElementById(`epg-${streamId}`);
        if (cardEpg) cardEpg.textContent = title;
      }
    } catch (e) {
      console.warn('EPG fetch failed:', e);
    }
  }

  // Favorites
  function isFavorite(streamId) {
    return state.favorites.some((f) => String(f.stream_id) === String(streamId));
  }

  function toggleFavorite(channel) {
    const id = String(channel.stream_id);
    const existingIdx = state.favorites.findIndex((f) => String(f.stream_id) === id);

    if (existingIdx >= 0) {
      state.favorites.splice(existingIdx, 1);
    } else {
      state.favorites.push(channel);
    }

    localStorage.setItem('tesla_iptv_favs', JSON.stringify(state.favorites));
  }

  function renderFavorites() {
    state.filteredStreams = state.favorites;
    renderLiveChannels(state.favorites);
  }

  // Tesla Theater Mode Modal
  async function openTheaterModal() {
    try {
      const resp = await fetch('/api/theater_url');
      const data = await resp.json();
      if (elements.theaterRedirectLink) {
        elements.theaterRedirectLink.textContent = data.theater_redirect_url;
        const openLinkBtn = document.getElementById('open-theater-direct-btn');
        if (openLinkBtn) {
          openLinkBtn.href = data.theater_redirect_url;
        }
      }
    } catch (e) {
      console.warn('Theater URL fetch error:', e);
    }
    openModal(elements.theaterModal);
  }

  // Utilities
  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function decodeBase64Safe(str) {
    try {
      return decodeURIComponent(escape(window.atob(str)));
    } catch (e) {
      return str;
    }
  }

  // Bootstrap
  document.addEventListener('DOMContentLoaded', init);
})();
