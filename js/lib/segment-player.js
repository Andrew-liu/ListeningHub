// 基于 <audio> 的分段播放器：按句子时间戳精确播放、循环、变速（保持音高）
export class SegmentPlayer {
  constructor() {
    const el = new Audio();
    el.preload = 'auto';
    el.preservesPitch = true;
    el.mozPreservesPitch = true;
    el.webkitPreservesPitch = true;
    this.el = el;
    this.src = '';
    this.range = null;       // { t0, t1, loop, gap, onEnd }
    this.handlers = { time: new Set(), state: new Set(), meta: new Set(), ended: new Set(), error: new Set() };
    this._raf = 0;
    this._loopTimer = 0;
    this._token = 0;

    el.addEventListener('play', () => { this._emit('state', true); this._tick(); });
    el.addEventListener('pause', () => { this._emit('state', false); cancelAnimationFrame(this._raf); this._emit('time', el.currentTime); });
    el.addEventListener('loadedmetadata', () => this._emit('meta', el.duration));
    el.addEventListener('seeked', () => this._emit('time', el.currentTime));
    el.addEventListener('ended', () => { this.range = null; this._emit('ended'); });
    el.addEventListener('error', () => this._emit('error', el.error));
  }

  on(type, fn) { this.handlers[type].add(fn); return () => this.handlers[type].delete(fn); }
  _emit(type, v) { this.handlers[type].forEach(fn => { try { fn(v); } catch (e) { console.error(e); } }); }

  get playing() { return !this.el.paused && !this.el.ended; }
  get currentTime() { return this.el.currentTime; }
  get duration() { return this.el.duration || 0; }

  load(src) {
    if (src === this.src) return;
    this.stop();
    this.src = src;
    this.el.src = src;
    this.el.load();
  }

  setRate(rate) {
    this.el.playbackRate = rate;
    this.el.defaultPlaybackRate = rate;
  }

  _seek(t) {
    const el = this.el;
    return new Promise(resolve => {
      const target = Math.max(0, t);
      if (Math.abs(el.currentTime - target) < 0.02) return resolve();
      const done = () => { el.removeEventListener('seeked', done); clearTimeout(timer); resolve(); };
      const timer = setTimeout(done, 1500);
      el.addEventListener('seeked', done);
      el.currentTime = target;
    });
  }

  async _waitReady() {
    const el = this.el;
    if (el.readyState >= 1) return;
    await new Promise(resolve => {
      const done = () => { el.removeEventListener('loadedmetadata', done); resolve(); };
      el.addEventListener('loadedmetadata', done);
      setTimeout(done, 8000);
    });
  }

  // 播放 [t0, t1) 片段；loop=true 时片段结束后间隔 gap 秒重播
  async playRange(t0, t1, { loop = false, gap = 0.6, onEnd } = {}) {
    const token = ++this._token;
    clearTimeout(this._loopTimer);
    this.range = { t0, t1, loop, gap, onEnd };
    await this._waitReady();
    await this._seek(t0);
    if (token !== this._token) return;
    try { await this.el.play(); } catch (e) { this._emit('error', e); }
  }

  // 从 t 开始连续播放
  async playFrom(t) {
    const token = ++this._token;
    clearTimeout(this._loopTimer);
    this.range = null;
    await this._waitReady();
    if (t != null) await this._seek(t);
    if (token !== this._token) return;
    try { await this.el.play(); } catch (e) { this._emit('error', e); }
  }

  resume() {
    if (this.range && this.el.currentTime >= this.range.t1 - 0.05) {
      return this.playRange(this.range.t0, this.range.t1, this.range);
    }
    return this.el.play().catch(e => this._emit('error', e));
  }

  pause() {
    this._token++;
    clearTimeout(this._loopTimer);
    this.el.pause();
  }

  stop() {
    this.pause();
    this.range = null;
  }

  seek(t) {
    this.range = null;
    return this._seek(t);
  }

  _tick() {
    cancelAnimationFrame(this._raf);
    const step = () => {
      const el = this.el;
      if (el.paused) return;
      const t = el.currentTime;
      this._emit('time', t);
      const r = this.range;
      if (r && t >= r.t1 - 0.015) {
        el.pause();
        if (r.loop) {
          const token = this._token;
          this._loopTimer = setTimeout(() => {
            if (token === this._token && this.range === r) this.playRange(r.t0, r.t1, r);
          }, r.gap * 1000);
        } else {
          this.range = null;
          r.onEnd && r.onEnd();
        }
        return;
      }
      this._raf = requestAnimationFrame(step);
    };
    this._raf = requestAnimationFrame(step);
  }
}

// 一次性片段播放（生词本里回放原句等场景），共享一个实例避免多处同时出声
let clipPlayer = null;
export function playClip(src, t0, t1) {
  if (!clipPlayer) clipPlayer = new SegmentPlayer();
  clipPlayer.load(src);
  return clipPlayer.playRange(t0, t1);
}
export function stopClip() {
  if (clipPlayer) clipPlayer.stop();
}
