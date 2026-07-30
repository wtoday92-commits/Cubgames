// Сеть поверх PeerJS (публичный брокер, без своего сервера).
// Хост авторитетен: считает состояние, рассылает виды. Гость шлёт действия.
// PeerJS подключается глобально из CDN (window.Peer) в index.html.

const PREFIX = 'dicearena-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих символов
const CONNECT_TIMEOUT_MS = 22000;

// ============================================================================
//  ВАШ TURN-СЕРВЕР  (нужен, чтобы пробивать домашние/мобильные NAT).
//  Metered даёт API-ключ и адрес приложения <app>.metered.live, а список
//  серверов программа сама запрашивает по ключу. Достаточно вписать 2 строки:
//
//    1. Зарегистрируйтесь на https://dashboard.metered.ca
//    2. Создайте приложение — его имя (поддомен вида  МОЁ-ИМЯ .metered.live)
//       впишите в METERED_APP  (без ".metered.live").
//    3. Найдите API Key (Secret Key) приложения и впишите в METERED_API_KEY.
//
//  Пока поля пустые — используется публичный запасной TURN (часто не работает).
//  После вписывания ключа поднимите версию ?v= в index.html и js/*.js,
//  затем git push, и обоим обновить страницу.
// ============================================================================
// --- Способ A (проще): вставьте сюда массив из кнопки "Show ICE Servers Array".
//     Пример того, что даёт Metered:
//       { urls: "stun:stun.relay.metered.ca:80" },
//       { urls: "turn:global.relay.metered.ca:80", username: "...", credential: "..." },
//       ... (ещё несколько строк)
const MY_ICE_SERVERS = [
  { urls: 'stun:stun.relay.metered.ca:80' },
  { urls: 'turn:global.relay.metered.ca:80', username: '6d470c3c9a8d4b92fe233463', credential: 'SFH+k86OX5WG6MeU' },
  { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: '6d470c3c9a8d4b92fe233463', credential: 'SFH+k86OX5WG6MeU' },
  { urls: 'turn:global.relay.metered.ca:443', username: '6d470c3c9a8d4b92fe233463', credential: 'SFH+k86OX5WG6MeU' },
  { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: '6d470c3c9a8d4b92fe233463', credential: 'SFH+k86OX5WG6MeU' },
];

// --- Способ B (альтернатива): API-ключ + имя приложения (кнопка "Show API Key").
const METERED_APP = '';      // например: 'dicearena'
const METERED_API_KEY = '';  // например: 'a1b2c3d4e5...'

const STUN = { urls: 'stun:stun.l.google.com:19302' };

// Запасной публичный вариант (нестабилен — работает не всегда).
const FALLBACK_ICE = [
  STUN,
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

export const USING_CUSTOM_TURN = MY_ICE_SERVERS.length > 0 || !!(METERED_APP && METERED_API_KEY);

// ICE-серверы загружаем один раз.
let _icePromise = null;
function loadIce() {
  if (_icePromise) return _icePromise;
  if (MY_ICE_SERVERS.length > 0) {
    // Способ A: готовый массив вставлен вручную.
    const hasStun = MY_ICE_SERVERS.some((s) => String(s.urls).startsWith('stun:'));
    _icePromise = Promise.resolve(hasStun ? MY_ICE_SERVERS : [STUN, ...MY_ICE_SERVERS]);
  } else if (METERED_APP && METERED_API_KEY) {
    const url = `https://${METERED_APP}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(METERED_API_KEY)}`;
    _icePromise = fetch(url)
      .then((r) => { if (!r.ok) throw new Error('TURN HTTP ' + r.status); return r.json(); })
      .then((list) => (Array.isArray(list) && list.length ? [STUN, ...list] : FALLBACK_ICE))
      .catch((e) => { console.warn('Не удалось получить TURN от Metered:', e); return FALLBACK_ICE; });
  } else {
    _icePromise = Promise.resolve(FALLBACK_ICE);
  }
  return _icePromise;
}

function randomCode(len = 5) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export class Net {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.isHost = false;
    this.code = null;
    this._connectTimer = null;
    this.handlers = {
      data: () => {}, open: () => {}, connected: () => {},
      closed: () => {}, error: () => {}, status: () => {},
    };
  }

  on(event, fn) { this.handlers[event] = fn; return this; }

  _newPeer(id, ice) {
    // eslint-disable-next-line no-undef
    return new Peer(id, { debug: 1, config: { iceServers: ice } });
  }

  _bindPeerCommon(peer) {
    // Разрыв связи с брокером — пробуем восстановить (нужно для приёма новых
    // соединений и переустановки, само WebRTC-соединение при этом живёт).
    peer.on('disconnected', () => {
      this.handlers.status('Переподключение к серверу комнат…');
      try { peer.reconnect(); } catch (_) {}
    });
  }

  host() {
    this.isHost = true;
    this.handlers.status('Подготовка соединения…');
    loadIce().then((ice) => this._startHost(ice));
  }

  _startHost(ice) {
    let attempts = 0;
    const tryHost = () => {
      this.code = randomCode();
      const peer = this._newPeer(PREFIX + this.code, ice);
      this.peer = peer;
      this._bindPeerCommon(peer);
      peer.on('open', () => this.handlers.open(this.code));
      peer.on('error', (e) => {
        if (e && (e.type === 'unavailable-id') && attempts < 5) {
          attempts++;
          try { peer.destroy(); } catch (_) {}
          tryHost();
          return;
        }
        this.handlers.error(e);
      });
      peer.on('connection', (conn) => {
        if (this.conn && this.conn.open) { conn.close(); return; } // только один гость
        this.conn = conn;
        this._armTimeout('Не удалось установить прямое соединение с игроком.');
        this._bindConn(conn);
      });
    };
    tryHost();
  }

  join(code) {
    this.isHost = false;
    this.code = String(code).trim().toUpperCase();
    this.handlers.status('Подготовка соединения…');
    loadIce().then((ice) => this._startJoin(ice));
  }

  _startJoin(ice) {
    const peer = this._newPeer(undefined, ice);
    this.peer = peer;
    this._bindPeerCommon(peer);
    peer.on('open', () => {
      this.handlers.status('Ищем комнату…');
      const conn = peer.connect(PREFIX + this.code, { reliable: true });
      this.conn = conn;
      this._armTimeout('Соединение не установилось. Возможно, разные сети — попробуйте мобильный интернет или VPN у одного из игроков.');
      this._bindConn(conn);
    });
    peer.on('error', (e) => {
      if (e && e.type === 'peer-unavailable') {
        this._clearTimeout();
        this.handlers.error({ type: 'peer-unavailable', message: 'Комната не найдена. Проверьте код (и что хост ещё ждёт).' });
        return;
      }
      this.handlers.error(e);
    });
  }

  _armTimeout(msg) {
    this._clearTimeout();
    this._connectTimer = setTimeout(() => {
      if (!(this.conn && this.conn.open)) this.handlers.error({ type: 'timeout', message: msg });
    }, CONNECT_TIMEOUT_MS);
  }

  _clearTimeout() {
    if (this._connectTimer) { clearTimeout(this._connectTimer); this._connectTimer = null; }
  }

  _bindConn(conn) {
    conn.on('open', () => { this._clearTimeout(); this.handlers.connected(); });
    conn.on('data', (msg) => this.handlers.data(msg));
    conn.on('close', () => this.handlers.closed());
    conn.on('error', (e) => this.handlers.error(e));
  }

  send(msg) {
    if (this.conn && this.conn.open) this.conn.send(msg);
  }

  destroy() {
    this._clearTimeout();
    try { if (this.conn) this.conn.close(); } catch (_) {}
    try { if (this.peer) this.peer.destroy(); } catch (_) {}
    this.conn = null;
    this.peer = null;
  }
}
