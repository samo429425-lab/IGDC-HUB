/*
 * MARU Real-time AI Subtitle Engine — Web R1
 * ------------------------------------------------------------
 * Purpose
 *   Transient, non-persistent real-time translated captions for MARU Media Hub.
 *   Designed to sit on top of an existing HTML5 <video> / <audio> player without
 *   replacing the player or changing its playback route.
 *
 * Source compatibility basis
 *   - MARU Media Player Windows public build AI endpoint contract
 *   - MARU Media Player Android v185 / mobile-r8bw-v185 AI chunk contract
 *
 * Privacy / storage policy
 *   - Does NOT save SRT/VTT or transcript files.
 *   - Does NOT persist transcript text in localStorage/sessionStorage/IndexedDB.
 *   - Sends only short transient audio chunks when the user starts the feature.
 *   - Keeps only a tiny in-memory queue and the last displayed caption.
 *
 * Security
 *   - Never put an OpenAI/API provider secret in this client file.
 *   - Requests go only to the MARU server endpoint. Authentication is supplied
 *     by getAuth() when the host site has a signed-in MARU member session.
 *
 * Browser note
 *   - Direct HTML5 media with same-origin/CORS-accessible audio can be captured.
 *   - Cross-origin iframe players (YouTube, etc.) cannot be audio-captured by a
 *     parent page because of browser security. Use an official caption/API path
 *     or provide a legal MediaStream through streamProvider for those players.
 */
(function (root, factory) {
  const api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MaruRealtimeAISubtitle = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const VERSION = 'web-realtime-r1';
  const DEFAULT_ENDPOINT = '/.netlify/functions/maru-ai-media';
  const DEFAULT_CHUNK_MS = 1800;
  const DEFAULT_MAX_QUEUE = 3;
  const DEFAULT_MAX_CONCURRENT = 2;
  const DEFAULT_RESULT_MAX_AGE_SEC = 5.5;
  const DEFAULT_SILENCE_RMS = 0.0065;
  const MIN_CHUNK_SECONDS = 0.45;
  const MAX_AUDIO_BYTES = 600 * 1024; // Keep parity with Android v185 server-safe limit.

  const LANGUAGES = Object.freeze({
    ko: 'Korean',
    en: 'English',
    zh: 'Simplified Chinese',
    zht: 'Traditional Chinese',
    ja: 'Japanese',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    ru: 'Russian',
    pt: 'Portuguese',
    it: 'Italian',
    ar: 'Arabic',
    vi: 'Vietnamese',
    th: 'Thai',
    id: 'Indonesian',
    hi: 'Hindi',
    tr: 'Turkish',
    ta: 'Tamil',
    sw: 'Swahili',
    ur: 'Urdu',
    bn: 'Bengali',
    fa: 'Persian',
    hu: 'Hungarian',
    ms: 'Malay',
    nl: 'Dutch',
    pl: 'Polish',
    sv: 'Swedish',
    tl: 'Filipino',
    uk: 'Ukrainian',
    uz: 'Uzbek'
  });

  const KO_LABELS = Object.freeze({
    start: 'AI 실시간 자막',
    stop: 'AI 자막 끄기',
    language: '번역 언어',
    waiting: '재생을 시작하면 AI 자막이 표시됩니다.',
    listening: '음성을 인식하고 있습니다…',
    paused: '일시정지',
    noAudio: '이 영상의 음성 스트림에 접근할 수 없습니다.',
    unsupported: '이 브라우저에서는 실시간 오디오 캡처를 지원하지 않습니다.',
    iframeBlocked: '외부 iframe 영상은 브라우저 보안상 직접 음성 캡처가 제한됩니다.',
    auth: 'AI 사용 권한 확인이 필요합니다.',
    credit: 'AI 크레딧을 확인해 주세요.',
    error: '실시간 AI 자막 처리에 실패했습니다.'
  });
  const EN_LABELS = Object.freeze({
    start: 'AI Live Captions',
    stop: 'Stop AI Captions',
    language: 'Translation language',
    waiting: 'AI captions will appear when playback starts.',
    listening: 'Listening and translating…',
    paused: 'Paused',
    noAudio: 'The audio stream for this media is not accessible.',
    unsupported: 'Real-time audio capture is not supported in this browser.',
    iframeBlocked: 'Cross-origin iframe audio cannot be captured directly by the parent page.',
    auth: 'AI access verification is required.',
    credit: 'Please check your AI credit balance.',
    error: 'Real-time AI caption processing failed.'
  });

  const STATE = Object.freeze({
    IDLE: 'idle',
    STARTING: 'starting',
    WAITING: 'waiting',
    LISTENING: 'listening',
    PAUSED: 'paused',
    STOPPED: 'stopped',
    ERROR: 'error'
  });

  function isBrowser() {
    return !!(root && root.document && root.navigator);
  }

  function normalizeLang(code) {
    let value = String(code || '').trim().toLowerCase().replace('_', '-');
    if (value === 'zh-tw' || value === 'zh-hk' || value === 'zh-hant') value = 'zht';
    if (value === 'zh-cn' || value === 'zh-hans') value = 'zh';
    value = value.split('-')[0] === 'zh' && value !== 'zht' ? 'zh' : value.split('-')[0];
    return LANGUAGES[value] ? value : 'en';
  }

  function uiLanguage() {
    if (!isBrowser()) return 'en';
    const lang = normalizeLang(root.document.documentElement.lang || root.navigator.language || 'en');
    return lang === 'ko' ? 'ko' : 'en';
  }

  function labelsFor(custom) {
    const base = uiLanguage() === 'ko' ? KO_LABELS : EN_LABELS;
    return Object.freeze(Object.assign({}, base, custom || {}));
  }

  function isMediaElement(media) {
    if (!media) return false;
    const tag = String(media.tagName || '').toLowerCase();
    return tag === 'video' || tag === 'audio';
  }

  function safeNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function basenameFromMedia(media) {
    try {
      const raw = String(media.currentSrc || media.src || 'media');
      const url = new URL(raw, root.location && root.location.href ? root.location.href : 'https://local.invalid/');
      const name = decodeURIComponent(url.pathname.split('/').pop() || 'media');
      return name.slice(0, 180) || 'media';
    } catch (_) {
      return 'media';
    }
  }

  function detectPlatform() {
    if (!isBrowser()) return 'web';
    const ua = String(root.navigator.userAgent || '').toLowerCase();
    if (/iphone|ipad|ipod/.test(ua)) return 'ios-web';
    if (/android/.test(ua)) return 'android-web';
    if (/windows/.test(ua)) return 'windows-web';
    if (/macintosh|mac os/.test(ua)) return 'mac-web';
    return 'web';
  }

  function makeEphemeralDeviceId() {
    try {
      if (root.crypto && typeof root.crypto.randomUUID === 'function') {
        return 'web-' + root.crypto.randomUUID();
      }
    } catch (_) {}
    return 'web-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  function defaultAuthProvider() {
    if (!isBrowser()) return {};
    let identity = '';
    try {
      identity = String(
        root.localStorage.getItem('maru_player_member_identity') ||
        root.localStorage.getItem('maru_player_ai_pro_identity') ||
        ''
      ).trim();
    } catch (_) {}
    return { identity };
  }

  function chooseMimeType() {
    if (!isBrowser() || typeof root.MediaRecorder !== 'function') return '';
    const candidates = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4;codecs=mp4a.40.2',
      'audio/mp4',
      'audio/ogg;codecs=opus'
    ];
    for (const mime of candidates) {
      try {
        if (!root.MediaRecorder.isTypeSupported || root.MediaRecorder.isTypeSupported(mime)) return mime;
      } catch (_) {}
    }
    return '';
  }

  function blobExtension(mime) {
    const m = String(mime || '').toLowerCase();
    if (m.includes('mp4')) return 'm4a';
    if (m.includes('ogg')) return 'ogg';
    if (m.includes('mpeg')) return 'mp3';
    return 'webm';
  }

  async function blobToBase64(blob) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const step = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += step) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
    }
    return root.btoa ? root.btoa(binary) : Buffer.from(bytes).toString('base64');
  }

  function stripSubtitleFormatting(text) {
    return String(text || '')
      .replace(/^\uFEFF/, '')
      .replace(/^WEBVTT[^\n]*\n?/i, '')
      .replace(/^\s*\d+\s*$/gm, '')
      .replace(/^\s*\d{1,2}:\d{2}(?::\d{2})?[,.]\d{1,3}\s*-->[^\n]*$/gm, '')
      .replace(/^\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->[^\n]*$/gm, '')
      .replace(/<[^>]+>/g, '')
      .replace(/\{\\[^}]+\}/g, '')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  function extractResponseText(response) {
    if (!response || typeof response !== 'object') return '';
    let segments = Array.isArray(response.segments) ? response.segments : null;
    if (!segments && response.result && Array.isArray(response.result.segments)) segments = response.result.segments;
    if (segments) {
      const joined = segments
        .map((row) => String((row && (row.text || row.subtitle || row.translation)) || '').trim())
        .filter(Boolean)
        .join(' ')
        .trim();
      if (joined) return stripSubtitleFormatting(joined);
    }
    const direct =
      response.translatedText ||
      response.translatedSubtitle ||
      response.subtitleText ||
      response.subtitle ||
      response.text ||
      (response.result && (response.result.text || response.result.subtitleText)) ||
      '';
    return stripSubtitleFormatting(direct);
  }

  function normalizeForDuplicate(text) {
    return String(text || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ' ').trim();
  }

  function sameOriginOrCorsDeclared(media) {
    if (!isBrowser()) return false;
    try {
      const raw = String(media.currentSrc || media.src || '');
      if (!raw || raw.startsWith('blob:') || raw.startsWith('data:')) return true;
      const url = new URL(raw, root.location.href);
      if (url.origin === root.location.origin) return true;
      return !!String(media.crossOrigin || '').trim();
    } catch (_) {
      return false;
    }
  }

  class SilenceGate {
    constructor(stream, threshold) {
      this.stream = stream;
      this.threshold = threshold;
      this.context = null;
      this.source = null;
      this.analyser = null;
      this.timer = null;
      this.peak = null;
      this.buffer = null;
    }

    async start() {
      if (!isBrowser()) return false;
      const AudioCtx = root.AudioContext || root.webkitAudioContext;
      if (!AudioCtx || !this.stream) return false;
      try {
        this.context = new AudioCtx();
        if (this.context.state === 'suspended') await this.context.resume().catch(() => {});
        this.source = this.context.createMediaStreamSource(this.stream);
        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = 512;
        this.analyser.smoothingTimeConstant = 0.15;
        this.source.connect(this.analyser);
        this.buffer = new Float32Array(this.analyser.fftSize);
        this.peak = 0;
        this.timer = root.setInterval(() => this.sample(), 80);
        return true;
      } catch (_) {
        await this.destroy();
        return false;
      }
    }

    sample() {
      if (!this.analyser || !this.buffer) return;
      try {
        this.analyser.getFloatTimeDomainData(this.buffer);
        let sum = 0;
        for (let i = 0; i < this.buffer.length; i++) sum += this.buffer[i] * this.buffer[i];
        const rms = Math.sqrt(sum / Math.max(1, this.buffer.length));
        this.peak = Math.max(Number(this.peak || 0), rms);
      } catch (_) {}
    }

    consume() {
      if (this.peak == null) return null;
      const value = this.peak;
      this.peak = 0;
      return value;
    }

    async destroy() {
      if (this.timer) root.clearInterval(this.timer);
      this.timer = null;
      try { if (this.source) this.source.disconnect(); } catch (_) {}
      try { if (this.analyser) this.analyser.disconnect(); } catch (_) {}
      try { if (this.context) await this.context.close(); } catch (_) {}
      this.source = null;
      this.analyser = null;
      this.context = null;
      this.peak = null;
    }
  }

  class Controller {
    constructor(media, options) {
      if (!isBrowser()) throw new Error('browser_required');
      if (!isMediaElement(media)) throw new Error('html_media_element_required');

      this.media = media;
      this.options = Object.assign({
        endpoint: DEFAULT_ENDPOINT,
        targetLanguage: normalizeLang(root.document.documentElement.lang || root.navigator.language || 'en'),
        sourceLanguage: 'auto',
        chunkMs: DEFAULT_CHUNK_MS,
        maxQueue: DEFAULT_MAX_QUEUE,
        maxConcurrent: DEFAULT_MAX_CONCURRENT,
        resultMaxAgeSec: DEFAULT_RESULT_MAX_AGE_SEC,
        silenceRms: DEFAULT_SILENCE_RMS,
        suppressSilence: true,
        ui: true,
        overlay: true,
        textTrack: true,
        autoStartOnPlay: false,
        getAuth: defaultAuthProvider,
        streamProvider: null,
        fetchImpl: root.fetch ? root.fetch.bind(root) : null,
        labels: null,
        container: null,
        requestTimeoutMs: 45000,
        onCaption: null,
        onState: null,
        onError: null
      }, options || {});

      this.options.targetLanguage = normalizeLang(this.options.targetLanguage);
      this.options.chunkMs = clamp(safeNumber(this.options.chunkMs, DEFAULT_CHUNK_MS), 900, 5000);
      this.options.maxQueue = clamp(Math.round(safeNumber(this.options.maxQueue, DEFAULT_MAX_QUEUE)), 1, 8);
      this.options.maxConcurrent = clamp(Math.round(safeNumber(this.options.maxConcurrent, DEFAULT_MAX_CONCURRENT)), 1, 4);
      this.options.resultMaxAgeSec = clamp(safeNumber(this.options.resultMaxAgeSec, DEFAULT_RESULT_MAX_AGE_SEC), 1.5, 15);
      this.options.silenceRms = clamp(safeNumber(this.options.silenceRms, DEFAULT_SILENCE_RMS), 0, 0.1);
      this.labels = labelsFor(this.options.labels);
      this.deviceId = makeEphemeralDeviceId();
      this.active = false;
      this.destroyed = false;
      this.state = STATE.IDLE;
      this.generation = 0;
      this.sequence = 0;
      this.queue = [];
      this.inflight = 0;
      this.abortControllers = new Set();
      this.captureStream = null;
      this.ownsCaptureStream = false;
      this.recorder = null;
      this.recordTimer = null;
      this.recordingPromise = null;
      this.silenceGate = null;
      this.webAudio = null;
      this.textTrack = null;
      this.overlay = null;
      this.controls = null;
      this.parentPositionChanged = false;
      this.lastTextNorm = '';
      this.lastCaptionAt = 0;
      this._bound = {};

      this._prepareUi();
      this._bindMediaEvents();
      this._setState(STATE.IDLE, '');

      if (this.options.autoStartOnPlay && !this.media.paused) {
        Promise.resolve().then(() => this.start()).catch(() => {});
      }
    }

    _emit(name, detail) {
      try {
        if (this.media && typeof this.media.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') {
          this.media.dispatchEvent(new root.CustomEvent(name, { detail }));
        }
      } catch (_) {}
    }

    _setState(state, message) {
      this.state = state;
      if (this.controls) {
        const button = this.controls.querySelector('[data-maru-rt-action]');
        const status = this.controls.querySelector('[data-maru-rt-status]');
        if (button) button.textContent = this.active ? this.labels.stop : this.labels.start;
        if (status) status.textContent = String(message || '');
        this.controls.setAttribute('data-state', state);
      }
      const detail = { state, message: String(message || ''), active: this.active, targetLanguage: this.options.targetLanguage };
      if (typeof this.options.onState === 'function') {
        try { this.options.onState(detail); } catch (_) {}
      }
      this._emit('maru:realtime-ai-state', detail);
    }

    _reportError(code, error, fatal) {
      const message = String((error && error.message) || error || code || this.labels.error);
      const detail = { code: String(code || 'error'), message, fatal: !!fatal };
      if (typeof this.options.onError === 'function') {
        try { this.options.onError(detail); } catch (_) {}
      }
      this._emit('maru:realtime-ai-error', detail);
      if (fatal) {
        this.active = false;
        this._setState(STATE.ERROR, message);
        this._stopRecorderOnly();
      }
    }

    _prepareUi() {
      if (!this.options.overlay && !this.options.ui) return;
      const parent = this.options.container || this.media.parentElement || root.document.body;
      if (!parent) return;
      try {
        const computed = root.getComputedStyle(parent);
        if (computed.position === 'static' && parent !== root.document.body) {
          parent.style.position = 'relative';
          this.parentPositionChanged = true;
        }
      } catch (_) {}

      if (this.options.overlay) {
        const overlay = root.document.createElement('div');
        overlay.className = 'maru-rt-ai-caption';
        overlay.setAttribute('aria-live', 'polite');
        overlay.setAttribute('aria-atomic', 'true');
        overlay.hidden = true;
        parent.appendChild(overlay);
        this.overlay = overlay;
      }

      if (this.options.ui) {
        const controls = root.document.createElement('div');
        controls.className = 'maru-rt-ai-controls';
        controls.innerHTML = '<button type="button" data-maru-rt-action></button>' +
          '<select data-maru-rt-language aria-label="' + escapeHtml(this.labels.language) + '"></select>' +
          '<span data-maru-rt-status aria-live="polite"></span>';
        const select = controls.querySelector('[data-maru-rt-language]');
        Object.entries(LANGUAGES).forEach(([code, name]) => {
          const option = root.document.createElement('option');
          option.value = code;
          option.textContent = name;
          if (code === this.options.targetLanguage) option.selected = true;
          select.appendChild(option);
        });
        controls.querySelector('[data-maru-rt-action]').addEventListener('click', () => {
          if (this.active) this.stop();
          else this.start();
        });
        select.addEventListener('change', () => this.setTargetLanguage(select.value));
        parent.appendChild(controls);
        this.controls = controls;
      }

      ensureStyle();
    }

    _bindMediaEvents() {
      const onPlay = () => {
        if (!this.active) {
          if (this.options.autoStartOnPlay) this.start().catch(() => {});
          return;
        }
        this._setState(STATE.LISTENING, this.labels.listening);
        this._scheduleRecording(0);
      };
      const onPause = () => {
        if (!this.active) return;
        this._stopRecorderOnly();
        this._setState(STATE.PAUSED, this.labels.paused);
      };
      const onEnded = () => {
        if (this.active) this.stop();
      };
      const onSeeking = () => {
        if (!this.active) return;
        this.generation += 1;
        this.queue.length = 0;
        this._stopRecorderOnly();
        this._clearCaption();
      };
      const onSeeked = () => {
        if (this.active && !this.media.paused) this._scheduleRecording(50);
      };
      const onEmptied = () => {
        if (!this.active) return;
        this.generation += 1;
        this.queue.length = 0;
        this._clearCaption();
      };
      this._bound = { onPlay, onPause, onEnded, onSeeking, onSeeked, onEmptied };
      this.media.addEventListener('play', onPlay);
      this.media.addEventListener('pause', onPause);
      this.media.addEventListener('ended', onEnded);
      this.media.addEventListener('seeking', onSeeking);
      this.media.addEventListener('seeked', onSeeked);
      this.media.addEventListener('emptied', onEmptied);
    }

    async _obtainCaptureStream() {
      if (this.captureStream && this.captureStream.getAudioTracks().length) return this.captureStream;

      if (typeof this.options.streamProvider === 'function') {
        const provided = await this.options.streamProvider(this.media, this);
        if (provided && typeof provided.getAudioTracks === 'function' && provided.getAudioTracks().length) {
          this.captureStream = provided;
          this.ownsCaptureStream = false;
          return provided;
        }
      }

      const capture = this.media.captureStream || this.media.mozCaptureStream;
      if (typeof capture === 'function') {
        try {
          const raw = capture.call(this.media);
          const tracks = raw && raw.getAudioTracks ? raw.getAudioTracks() : [];
          if (tracks.length) {
            const stream = typeof root.MediaStream === 'function' ? new root.MediaStream(tracks) : raw;
            this.captureStream = stream;
            this.ownsCaptureStream = stream !== raw;
            return stream;
          }
        } catch (_) {}
      }

      if (!sameOriginOrCorsDeclared(this.media)) throw new Error('cross_origin_audio_capture_blocked');

      const AudioCtx = root.AudioContext || root.webkitAudioContext;
      if (!AudioCtx || typeof root.MediaStream !== 'function') throw new Error('audio_capture_not_supported');

      // createMediaElementSource may be created only once per media element.
      const sharedKey = '__maruRtWebAudioBridge';
      let bridge = this.media[sharedKey];
      if (!bridge) {
        const context = new AudioCtx();
        if (context.state === 'suspended') await context.resume().catch(() => {});
        const source = context.createMediaElementSource(this.media);
        const destination = context.createMediaStreamDestination();
        source.connect(destination);
        source.connect(context.destination); // Preserve audible playback after routing through WebAudio.
        bridge = { context, source, destination, refs: 0 };
        Object.defineProperty(this.media, sharedKey, { value: bridge, configurable: true });
      }
      bridge.refs += 1;
      this.webAudio = bridge;
      this.captureStream = bridge.destination.stream;
      this.ownsCaptureStream = false;
      if (!this.captureStream.getAudioTracks().length) throw new Error('no_audio_track');
      return this.captureStream;
    }

    async _ensureSilenceGate(stream) {
      if (!this.options.suppressSilence || this.silenceGate) return;
      const gate = new SilenceGate(stream, this.options.silenceRms);
      if (await gate.start()) this.silenceGate = gate;
    }

    _ensureTextTrack() {
      if (!this.options.textTrack || this.textTrack) return;
      try {
        const track = this.media.addTextTrack('subtitles', 'MARU AI Live', this.options.targetLanguage);
        track.mode = 'showing';
        this.textTrack = track;
      } catch (_) {}
    }

    _resetTextTrack() {
      if (this.textTrack) {
        try { this.textTrack.mode = 'disabled'; } catch (_) {}
      }
      this.textTrack = null;
      this._ensureTextTrack();
    }

    async start() {
      if (this.destroyed) throw new Error('controller_destroyed');
      if (this.active) return this;
      if (!this.options.fetchImpl) throw new Error('fetch_not_available');
      if (typeof root.MediaRecorder !== 'function') {
        this._reportError('media_recorder_unsupported', new Error(this.labels.unsupported), true);
        return this;
      }

      this.active = true;
      this.generation += 1;
      this.queue.length = 0;
      this.lastTextNorm = '';
      this._setState(STATE.STARTING, this.labels.waiting);

      try {
        const stream = await this._obtainCaptureStream();
        if (!stream || !stream.getAudioTracks || !stream.getAudioTracks().length) throw new Error('no_audio_track');
        await this._ensureSilenceGate(stream);
        this._ensureTextTrack();
      } catch (error) {
        const code = String(error && error.message || 'audio_capture_failed');
        const message = code === 'cross_origin_audio_capture_blocked' ? this.labels.iframeBlocked : this.labels.noAudio;
        this._reportError(code, new Error(message), true);
        return this;
      }

      if (this.media.paused || this.media.ended) {
        this._setState(STATE.WAITING, this.labels.waiting);
      } else {
        this._setState(STATE.LISTENING, this.labels.listening);
        this._scheduleRecording(0);
      }
      return this;
    }

    stop() {
      if (!this.active && this.state === STATE.STOPPED) return this;
      this.active = false;
      this.generation += 1;
      this.queue.length = 0;
      this._stopRecorderOnly();
      for (const controller of this.abortControllers) {
        try { controller.abort(); } catch (_) {}
      }
      this.abortControllers.clear();
      this._clearCaption();
      this._setState(STATE.STOPPED, '');
      return this;
    }

    setTargetLanguage(code) {
      this.options.targetLanguage = normalizeLang(code);
      this.lastTextNorm = '';
      this._clearCaption();
      this._resetTextTrack();
      if (this.controls) {
        const select = this.controls.querySelector('[data-maru-rt-language]');
        if (select) select.value = this.options.targetLanguage;
      }
      return this;
    }

    _scheduleRecording(delay) {
      if (!this.active || this.destroyed || this.media.paused || this.media.ended) return;
      if (this.recordTimer || this.recorder) return;
      this.recordTimer = root.setTimeout(() => {
        this.recordTimer = null;
        this._recordOneChunk().catch((error) => {
          if (!this.active) return;
          this._reportError('record_chunk_failed', error, false);
          this._scheduleRecording(250);
        });
      }, Math.max(0, delay || 0));
    }

    _stopRecorderOnly() {
      if (this.recordTimer) root.clearTimeout(this.recordTimer);
      this.recordTimer = null;
      if (this.recorder) {
        try {
          if (this.recorder.state !== 'inactive') this.recorder.stop();
        } catch (_) {}
      }
      this.recorder = null;
    }

    async _recordOneChunk() {
      if (!this.active || this.destroyed || this.media.paused || this.media.ended) return;
      const stream = await this._obtainCaptureStream();
      const mimeType = chooseMimeType();
      const generation = this.generation;
      const startAt = safeNumber(this.media.currentTime, 0);
      const startedWall = Date.now();
      const peakBefore = this.silenceGate ? this.silenceGate.consume() : null;
      void peakBefore;

      const chunks = [];
      let recorder;
      try {
        recorder = mimeType ? new root.MediaRecorder(stream, { mimeType }) : new root.MediaRecorder(stream);
      } catch (_) {
        recorder = new root.MediaRecorder(stream);
      }
      this.recorder = recorder;

      const blob = await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (value, error) => {
          if (settled) return;
          settled = true;
          if (error) reject(error); else resolve(value);
        };
        recorder.addEventListener('dataavailable', (event) => {
          if (event.data && event.data.size) chunks.push(event.data);
        });
        recorder.addEventListener('error', (event) => finish(null, event.error || new Error('media_recorder_error')));
        recorder.addEventListener('stop', () => {
          try {
            const type = recorder.mimeType || mimeType || (chunks[0] && chunks[0].type) || 'audio/webm';
            finish(new Blob(chunks, { type }));
          } catch (error) {
            finish(null, error);
          }
        });
        try {
          recorder.start();
          this.recordTimer = root.setTimeout(() => {
            this.recordTimer = null;
            try { if (recorder.state !== 'inactive') recorder.stop(); } catch (_) {}
          }, this.options.chunkMs);
        } catch (error) {
          finish(null, error);
        }
      });

      if (this.recorder === recorder) this.recorder = null;
      if (!this.active || generation !== this.generation) return;

      const endAt = safeNumber(this.media.currentTime, startAt + (Date.now() - startedWall) / 1000);
      const duration = Math.max(0, endAt - startAt);
      const peak = this.silenceGate ? this.silenceGate.consume() : null;

      if (duration >= MIN_CHUNK_SECONDS && blob && blob.size > 180) {
        const silent = peak != null && peak < this.options.silenceRms;
        if (!silent) {
          if (blob.size <= MAX_AUDIO_BYTES) {
            this._enqueue({
              seq: ++this.sequence,
              generation,
              startAt,
              endAt,
              duration,
              blob,
              mimeType: blob.type || mimeType || 'audio/webm',
              targetLanguage: this.options.targetLanguage
            });
          } else {
            this._reportError('audio_chunk_too_large', new Error('Transient audio chunk exceeded the server-safe size limit.'), false);
          }
        }
      }

      this._scheduleRecording(0);
    }

    _enqueue(job) {
      if (!this.active || job.generation !== this.generation) return;
      // Never let paid requests build an unbounded backlog. Prefer current speech over stale speech.
      if (this.queue.length >= this.options.maxQueue) this.queue.shift();
      this.queue.push(job);
      this._pump();
    }

    _pump() {
      while (this.active && this.inflight < this.options.maxConcurrent && this.queue.length) {
        const job = this.queue.shift();
        if (!job || job.generation !== this.generation) continue;
        this.inflight += 1;
        this._sendJob(job)
          .catch((error) => {
            if (!this.active || job.generation !== this.generation) return;
            const message = String(error && error.message || error || 'request_failed');
            const lower = message.toLowerCase();
            const auth = /401|403|auth|login|license|entitle|permission/.test(lower);
            const credit = /402|credit|quota|balance|usage/.test(lower);
            if (auth) this._reportError('authorization_required', new Error(this.labels.auth), true);
            else if (credit) this._reportError('credit_required', new Error(this.labels.credit), true);
            else this._reportError('request_failed', error, false);
          })
          .finally(() => {
            this.inflight = Math.max(0, this.inflight - 1);
            this._pump();
          });
      }
    }

    async _sendJob(job) {
      if (!this.active || job.generation !== this.generation) return;
      const base64 = await blobToBase64(job.blob);
      if (!this.active || job.generation !== this.generation) return;

      let auth = {};
      try {
        auth = typeof this.options.getAuth === 'function' ? await this.options.getAuth(this) : {};
      } catch (_) {
        auth = {};
      }
      auth = auth && typeof auth === 'object' ? auth : {};

      const targetLanguage = normalizeLang(job.targetLanguage);
      const targetName = LANGUAGES[targetLanguage] || targetLanguage;
      const sourceName = basenameFromMedia(this.media);
      const ext = blobExtension(job.mimeType);
      const payload = {
        action: 'generate-subtitle',
        client: 'MARU Media Hub',
        version: VERSION,
        platform: detectPlatform(),
        channel: 'media-hub-realtime',
        source: 'maru-media-hub-web',

        sourceLanguage: String(this.options.sourceLanguage || 'auto'),
        targetLanguage,
        requestedTargetLanguage: targetLanguage,
        targetName,
        targetLanguageRequired: true,
        directTargetLanguage: true,
        generationMode: 'realtime-selected-target-language-subtitle',
        qualityProfile: 'maru-realtime-dialogue-v1',
        format: 'segments',
        response: 'segments',
        requireSegments: true,
        strictTimeline: false,

        chunkOffset: job.startAt.toFixed(3),
        chunkIndex: String(job.seq),
        chunkStartSeconds: job.startAt.toFixed(3),
        chunkDurationSeconds: job.duration.toFixed(3),
        chunkTotal: 0,
        fileName: 'realtime-' + job.seq + '.' + ext,
        audioFileName: 'realtime-' + job.seq + '.' + ext,
        originalFileName: sourceName,
        contentType: job.mimeType,
        mimeType: job.mimeType,
        audioBase64: base64,

        sourceSelectionMode: 'user-started-realtime-caption',
        outputPolicy: 'spoken-or-recognizably-sung-cue-text-only-no-notes-no-instructions-no-disclaimers',
        realtime: true,
        transientProcessing: true,
        persist: false,
        saveSubtitle: false,

        feature: 'ai_translation',
        paidFeature: true,
        creditRequired: true,
        billingMode: 'paid_credit',

        sessionToken: String(auth.sessionToken || ''),
        identity: String(auth.identity || ''),
        userId: String(auth.userId || auth.user_id || ''),
        memberId: String(auth.memberId || auth.member_id || ''),
        licenseKey: String(auth.licenseKey || auth.license_key || ''),
        deviceId: String(auth.deviceId || this.deviceId)
      };

      const headers = {
        'Content-Type': 'application/json; charset=utf-8',
        'X-MARU-Client': 'MARU-Media-Hub',
        'X-MARU-Client-Version': VERSION
      };
      if (payload.sessionToken) headers.Authorization = 'Bearer ' + payload.sessionToken;

      const controller = typeof root.AbortController === 'function' ? new root.AbortController() : null;
      if (controller) this.abortControllers.add(controller);
      const timeout = root.setTimeout(() => {
        try { if (controller) controller.abort(); } catch (_) {}
      }, this.options.requestTimeoutMs);

      try {
        const response = await this.options.fetchImpl(this.options.endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller ? controller.signal : undefined,
          credentials: 'same-origin',
          cache: 'no-store'
        });
        const raw = await response.text();
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; }
        catch (_) { throw new Error('invalid_server_response_' + response.status); }
        if (!response.ok || data.ok === false) {
          const reason = data.error || data.code || data.message || ('server_' + response.status);
          throw new Error(String(response.status) + ': ' + String(reason));
        }
        if (!this.active || job.generation !== this.generation) return;
        const current = safeNumber(this.media.currentTime, job.endAt);
        if (current - job.endAt > this.options.resultMaxAgeSec) return;
        const text = extractResponseText(data);
        if (!text) return;
        this._displayCaption(text, job, data);
      } finally {
        root.clearTimeout(timeout);
        if (controller) this.abortControllers.delete(controller);
      }
    }

    _displayCaption(text, job, response) {
      const clean = String(text || '').trim();
      if (!clean) return;
      const norm = normalizeForDuplicate(clean);
      if (norm && norm === this.lastTextNorm) return;
      this.lastTextNorm = norm;
      this.lastCaptionAt = Date.now();

      if (this.overlay) {
        this.overlay.textContent = clean;
        this.overlay.hidden = false;
        const lang = this.options.targetLanguage;
        this.overlay.lang = lang === 'zht' ? 'zh-Hant' : lang;
        this.overlay.dir = /^(ar|fa|ur)$/.test(lang) ? 'rtl' : 'auto';
      }

      if (this.options.textTrack) {
        this._ensureTextTrack();
        if (this.textTrack && typeof root.VTTCue === 'function') {
          try {
            const now = safeNumber(this.media.currentTime, job.endAt);
            const cueDuration = clamp(1.8 + clean.length / 18, 2.2, 6.5);
            const cue = new root.VTTCue(Math.max(0, now - 0.08), now + cueDuration, clean);
            cue.line = 'auto';
            cue.align = 'center';
            this.textTrack.addCue(cue);
            const cues = this.textTrack.cues ? Array.from(this.textTrack.cues) : [];
            for (const old of cues) {
              if (old !== cue && old.endTime < now - 1.0) {
                try { this.textTrack.removeCue(old); } catch (_) {}
              }
            }
          } catch (_) {}
        }
      }

      const detail = {
        text: clean,
        targetLanguage: this.options.targetLanguage,
        sourceStart: job.startAt,
        sourceEnd: job.endAt,
        sequence: job.seq,
        response
      };
      if (typeof this.options.onCaption === 'function') {
        try { this.options.onCaption(detail); } catch (_) {}
      }
      this._emit('maru:realtime-ai-caption', detail);

      // Hide stale overlay text if no new speech arrives. TextTrack cues expire independently.
      const stamp = this.lastCaptionAt;
      root.setTimeout(() => {
        if (!this.overlay || this.lastCaptionAt !== stamp) return;
        if (Date.now() - stamp >= 6500) this.overlay.hidden = true;
      }, 6600);
    }

    _clearCaption() {
      this.lastTextNorm = '';
      if (this.overlay) {
        this.overlay.textContent = '';
        this.overlay.hidden = true;
      }
      if (this.textTrack && this.textTrack.cues) {
        try {
          for (const cue of Array.from(this.textTrack.cues)) this.textTrack.removeCue(cue);
        } catch (_) {}
      }
    }

    async destroy() {
      if (this.destroyed) return;
      this.stop();
      this.destroyed = true;
      const b = this._bound;
      this.media.removeEventListener('play', b.onPlay);
      this.media.removeEventListener('pause', b.onPause);
      this.media.removeEventListener('ended', b.onEnded);
      this.media.removeEventListener('seeking', b.onSeeking);
      this.media.removeEventListener('seeked', b.onSeeked);
      this.media.removeEventListener('emptied', b.onEmptied);

      if (this.silenceGate) await this.silenceGate.destroy();
      this.silenceGate = null;

      if (this.ownsCaptureStream && this.captureStream) {
        try { this.captureStream.getTracks().forEach((track) => track.stop()); } catch (_) {}
      }
      this.captureStream = null;

      if (this.webAudio) {
        this.webAudio.refs = Math.max(0, Number(this.webAudio.refs || 0) - 1);
        // Keep the bridge alive while the media element exists. Disconnecting it would mute
        // playback because createMediaElementSource redirects element audio through WebAudio.
        this.webAudio = null;
      }

      try { if (this.textTrack) this.textTrack.mode = 'disabled'; } catch (_) {}
      this.textTrack = null;
      try { if (this.overlay) this.overlay.remove(); } catch (_) {}
      try { if (this.controls) this.controls.remove(); } catch (_) {}
      this.overlay = null;
      this.controls = null;
      this._setState(STATE.STOPPED, '');
    }
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  function ensureStyle() {
    if (!isBrowser() || root.document.getElementById('maru-rt-ai-style')) return;
    const style = root.document.createElement('style');
    style.id = 'maru-rt-ai-style';
    style.textContent = [
      '.maru-rt-ai-caption{position:absolute;left:50%;bottom:clamp(62px,10%,116px);transform:translateX(-50%);z-index:2147482000;max-width:min(90%,980px);padding:.42em .72em;border-radius:.45em;background:rgba(0,0,0,.72);color:#fff;font:700 clamp(18px,2.3vw,34px)/1.38 system-ui,-apple-system,"Segoe UI",sans-serif;text-align:center;text-shadow:0 1px 3px #000;white-space:pre-wrap;word-break:keep-all;overflow-wrap:anywhere;pointer-events:none;box-sizing:border-box}',
      '.maru-rt-ai-caption[hidden]{display:none!important}',
      '.maru-rt-ai-controls{position:absolute;top:10px;right:10px;z-index:2147482001;display:flex;align-items:center;gap:7px;max-width:calc(100% - 20px);padding:6px 7px;border-radius:12px;background:rgba(11,18,31,.82);backdrop-filter:blur(7px);box-shadow:0 4px 18px rgba(0,0,0,.25);font:600 12px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff}',
      '.maru-rt-ai-controls button,.maru-rt-ai-controls select{min-height:32px;border:1px solid rgba(255,255,255,.2);border-radius:8px;background:#172033;color:#fff;font:inherit;padding:5px 8px}',
      '.maru-rt-ai-controls button{cursor:pointer;font-weight:800}',
      '.maru-rt-ai-controls select{max-width:150px}',
      '.maru-rt-ai-controls [data-maru-rt-status]{max-width:210px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.78}',
      '.maru-rt-ai-controls[data-state="listening"] [data-maru-rt-action]{outline:2px solid rgba(80,210,160,.65);outline-offset:1px}',
      '@media (max-width:680px){.maru-rt-ai-controls{top:7px;right:7px;left:7px;justify-content:flex-end}.maru-rt-ai-controls [data-maru-rt-status]{display:none}.maru-rt-ai-controls select{max-width:122px}.maru-rt-ai-caption{bottom:clamp(54px,12%,94px);max-width:94%;font-size:clamp(17px,5vw,25px)}}'
    ].join('\n');
    root.document.head.appendChild(style);
  }

  function attach(media, options) {
    return new Controller(media, options || {});
  }

  function attachAll(selector, options) {
    if (!isBrowser()) return [];
    const query = selector || 'video[data-maru-realtime-ai],audio[data-maru-realtime-ai]';
    return Array.from(root.document.querySelectorAll(query)).filter(isMediaElement).map((media) => attach(media, options));
  }

  function support() {
    if (!isBrowser()) return { browser: false, mediaRecorder: false, captureStream: false, webAudio: false };
    const proto = root.HTMLMediaElement && root.HTMLMediaElement.prototype;
    return {
      browser: true,
      mediaRecorder: typeof root.MediaRecorder === 'function',
      captureStream: !!(proto && (proto.captureStream || proto.mozCaptureStream)),
      webAudio: !!(root.AudioContext || root.webkitAudioContext),
      textTrack: !!(proto && proto.addTextTrack),
      mimeType: chooseMimeType(),
      platform: detectPlatform()
    };
  }

  return Object.freeze({
    VERSION,
    LANGUAGES,
    STATE,
    attach,
    attachAll,
    support,
    normalizeLang,
    extractResponseText
  });
});
