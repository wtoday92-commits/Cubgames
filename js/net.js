// Сеть поверх PeerJS (публичный брокер, без своего сервера).
// Хост авторитетен: считает состояние, рассылает виды. Гость шлёт действия.
// PeerJS подключается глобально из CDN (window.Peer) в index.html.

const PREFIX = 'dicearena-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих символов
const CONNECT_TIMEOUT_MS = 22000;

// ============================================================================
//  ВАШ TURN-СЕРВЕР  (нужен, чтобы пробивать домашние/мобильные NAT).
//  Бесплатные публичные TURN нестабильны, поэтому лучше вставить свой ключ.
//
//  Как получить бесплатно (50 ГБ/мес, хватает с головой):
//    1. Зарегистрируйтесь на https://dashboard.metered.ca (Open Relay).
//    2. Слева "TURN Server" → там будет готовый JS-массив iceServers
//       (stun: ... и несколько turn: ... с вашими username/credential).
//    3. Скопируйте ВЕСЬ этот массив и вставьте внутрь MY_TURN ниже.
//
//  Пока MY_TURN пуст — используется публичный запасной вариант (может не
//  работать). После вставки ключа не забудьте поднять версию ?v= в index.html
//  и js/*.js, затем git push, и обоим обновить страницу.
// ============================================================================
const MY_TURN = [
  // сюда вставьте массив iceServers из Metered, например:
  // { urls: 'stun:stun.relay.metered.ca:80' },
  // { urls: 'turn:global.relay.metered.ca:80', username: 'ВАШ_USERNAME', credential: 'ВАШ_CREDENTIAL' },
  // { urls: 'turn:global.relay.metered.ca:80?transport=tcp', username: 'ВАШ_USERNAME', credential: 'ВАШ_CREDENTIAL' },
  // { urls: 'turn:global.relay.metered.ca:443', username: 'ВАШ_USERNAME', credential: 'ВАШ_CREDENTIAL' },
  // { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: 'ВАШ_USERNAME', credential: 'ВАШ_CREDENTIAL' },
];

const FALLBACK_ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

const ICE_SERVERS = MY_TURN.length
  ? [{ urls: 'stun:stun.l.google.com:19302' }, ...MY_TURN]
  : FALLBACK_ICE;

export const USING_CUSTOM_TURN = MY_TURN.length > 0;

const PEER_OPTS = { debug: 1, config: { iceServers: ICE_SERVERS } };

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

  _newPeer(id) {
    // eslint-disable-next-line no-undef
    return new Peer(id, PEER_OPTS);
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
    let attempts = 0;
    const tryHost = () => {
      this.code = randomCode();
      const peer = this._newPeer(PREFIX + this.code);
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
    const peer = this._newPeer(undefined);
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
