/**
 * Listening Hub - 数据同步模块
 * 离线优先 + 登录后自动云端同步
 */
const SyncManager = {
  // API地址优先级：window.API_BASE > 自动检测（同主机 3000 端口）
  // - GitHub Pages 部署：在 index.html 中设置 window.API_BASE = 'https://your-worker.workers.dev/api'
  // - Docker 部署：nginx 反代 /api，无需配置
  // - 本地开发：自动使用当前主机的 3000 端口
  API_BASE: (typeof window !== 'undefined' && window.API_BASE)
    ? window.API_BASE
    : (typeof location !== 'undefined' && location.port === '18080')
      ? location.protocol + '//' + location.hostname + ':3000/api'
      : '/api',
  _token: null,
  _user: null,
  _version: 0,
  _pushTimer: null,
  _syncing: false,
  _listeners: [],

  // ─── 初始化 ───────────────────────────────────────────────
  init() {
    this._token = localStorage.getItem('auth_token') || null;
    this._user = JSON.parse(localStorage.getItem('auth_user') || 'null');
    this._version = parseInt(localStorage.getItem('sync_version') || '0', 10);

    // 登录状态下自动拉取
    if (this.isLoggedIn()) {
      this.pull().catch(err => console.warn('[Sync] 初始拉取失败:', err.message));
    }
  },

  // ─── 状态 ─────────────────────────────────────────────────
  isLoggedIn() {
    return !!this._token;
  },

  getUser() {
    return this._user;
  },

  getToken() {
    return this._token;
  },

  // ─── 事件 ─────────────────────────────────────────────────
  onChange(fn) {
    this._listeners.push(fn);
  },

  _notify(event, data) {
    this._listeners.forEach(fn => fn(event, data));
  },

  // ─── 认证 ─────────────────────────────────────────────────
  async login(email) {
    const res = await fetch(`${this.API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '请求失败');
    return data; // { message, code }
  },

  async verify(email, code) {
    const res = await fetch(`${this.API_BASE}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '验证失败');

    // 保存登录状态
    this._token = data.token;
    this._user = data.user;
    localStorage.setItem('auth_token', data.token);
    localStorage.setItem('auth_user', JSON.stringify(data.user));

    this._notify('login', data.user);

    // 登录成功后立即同步
    await this.pull();
    return data.user;
  },

  logout() {
    this._token = null;
    this._user = null;
    this._version = 0;
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    localStorage.removeItem('sync_version');
    this._notify('logout');
  },

  // ─── 同步 ─────────────────────────────────────────────────
  async pull() {
    if (!this.isLoggedIn()) return;
    if (this._syncing) return;
    this._syncing = true;

    try {
      const res = await fetch(`${this.API_BASE}/sync`, {
        headers: { 'Authorization': `Bearer ${this._token}` }
      });

      if (res.status === 401) {
        this.logout();
        return;
      }

      const { data, version } = await res.json();

      if (version > this._version && data && Object.keys(data).length > 0) {
        // 云端有更新，合并
        const localData = this._collectLocalData();
        const merged = this._merge(localData, data);
        this._applyData(merged);
        this._version = version;
        localStorage.setItem('sync_version', String(version));
        this._notify('synced', { direction: 'pull', version });
      } else if (this._version === 0 && version === 0) {
        // 首次登录，云端无数据，推送本地数据上去
        await this.push();
      }
    } catch (err) {
      console.warn('[Sync] Pull 失败:', err.message);
    } finally {
      this._syncing = false;
    }
  },

  async push() {
    if (!this.isLoggedIn()) return;
    if (this._syncing) return;
    this._syncing = true;

    try {
      const data = this._collectLocalData();
      const res = await fetch(`${this.API_BASE}/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this._token}`
        },
        body: JSON.stringify({ data, version: this._version })
      });

      if (res.status === 401) {
        this.logout();
        return;
      }

      const result = await res.json();

      if (result.conflict) {
        // 有冲突，合并后重新推送
        const localData = this._collectLocalData();
        const merged = this._merge(localData, result.serverData);
        this._applyData(merged);
        this._version = result.serverVersion;
        localStorage.setItem('sync_version', String(this._version));
        // 用合并后的数据再推一次
        this._syncing = false;
        await this.push();
        return;
      }

      if (result.success) {
        this._version = result.version;
        localStorage.setItem('sync_version', String(result.version));
        this._notify('synced', { direction: 'push', version: result.version });
      }
    } catch (err) {
      console.warn('[Sync] Push 失败:', err.message);
    } finally {
      this._syncing = false;
    }
  },

  // 防抖推送（数据变更后500ms执行）
  schedulePush() {
    if (!this.isLoggedIn()) return;
    if (this._pushTimer) clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => {
      this.push();
    }, 500);
  },

  // ─── 数据收集与应用 ─────────────────────────────────────────
  _collectLocalData() {
    const progress = JSON.parse(localStorage.getItem('voa_progress') || '{}');
    const vocabulary = JSON.parse(localStorage.getItem('voa_vocabulary') || '{}');
    return { progress, vocabulary };
  },

  _applyData(data) {
    if (data.progress) {
      localStorage.setItem('voa_progress', JSON.stringify(data.progress));
    }
    if (data.vocabulary) {
      localStorage.setItem('voa_vocabulary', JSON.stringify(data.vocabulary));
    }
    this._notify('dataUpdated', data);
  },

  // ─── 合并策略 ─────────────────────────────────────────────
  _merge(local, remote) {
    return {
      progress: this._mergeProgress(local.progress || {}, remote.progress || {}),
      vocabulary: this._mergeVocabulary(local.vocabulary || {}, remote.vocabulary || {})
    };
  },

  _mergeProgress(a, b) {
    // 取各字段的最大值
    const merged = { ...a };

    merged.sentencesPlayed = Math.max(a.sentencesPlayed || 0, b.sentencesPlayed || 0);
    merged.streak = Math.max(a.streak || 0, b.streak || 0);
    merged.lastStudyDate = (a.lastStudyDate || '') > (b.lastStudyDate || '') ? a.lastStudyDate : b.lastStudyDate;

    // 合并 studyDays（取每天最大值）
    merged.studyDays = { ...(a.studyDays || {}) };
    for (const [day, count] of Object.entries(b.studyDays || {})) {
      merged.studyDays[day] = Math.max(merged.studyDays[day] || 0, count);
    }

    // 合并 episodesStarted（取最早时间戳）
    merged.episodesStarted = { ...(a.episodesStarted || {}) };
    for (const [ep, ts] of Object.entries(b.episodesStarted || {})) {
      if (!merged.episodesStarted[ep] || ts < merged.episodesStarted[ep]) {
        merged.episodesStarted[ep] = ts;
      }
    }

    // 合并 episodesCompleted（取最早时间戳）
    merged.episodesCompleted = { ...(a.episodesCompleted || {}) };
    for (const [ep, ts] of Object.entries(b.episodesCompleted || {})) {
      if (!merged.episodesCompleted[ep] || ts < merged.episodesCompleted[ep]) {
        merged.episodesCompleted[ep] = ts;
      }
    }

    return merged;
  },

  _mergeVocabulary(a, b) {
    // vocabulary 是 { word: { ...wordData } } 格式
    const merged = { ...a };
    for (const [word, data] of Object.entries(b)) {
      if (!merged[word]) {
        merged[word] = data;
      } else {
        // 两边都有，取 addedAt 较新的版本（保留最新的 SRS 状态）
        const localTime = merged[word].addedAt || 0;
        const remoteTime = data.addedAt || 0;
        if (remoteTime > localTime) {
          merged[word] = data;
        }
      }
    }
    return merged;
  }
};
