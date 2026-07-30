// Сеть поверх PeerJS (публичный брокер, без своего сервера).
// Хост авторитетен: считает состояние, рассылает виды. Гость шлёт действия.
// PeerJS подключается глобально из CDN (window.Peer) в index.html.

const PREFIX = 'dicearena-v1-';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих символов

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
    this.handlers = { data: () => {}, open: () => {}, connected: () => {}, closed: () => {}, error: () => {} };
  }

  on(event, fn) { this.handlers[event] = fn; return this; }

  _newPeer(id) {
    // eslint-disable-next-line no-undef
    return id ? new Peer(id) : new Peer();
  }

  host() {
    this.isHost = true;
    let attempts = 0;
    const tryHost = () => {
      this.code = randomCode();
      const peer = this._newPeer(PREFIX + this.code);
      this.peer = peer;
      peer.on('open', () => this.handlers.open(this.code));
      peer.on('error', (e) => {
        // Код занят — пробуем другой (несколько раз).
        if (e && e.type === 'unavailable-id' && attempts < 5) {
          attempts++;
          try { peer.destroy(); } catch (_) {}
          tryHost();
          return;
        }
        this.handlers.error(e);
      });
      peer.on('connection', (conn) => {
        if (this.conn) { conn.close(); return; } // только один гость
        this.conn = conn;
        this._bindConn(conn);
      });
    };
    tryHost();
  }

  join(code) {
    this.isHost = false;
    this.code = code.trim().toUpperCase();
    const peer = this._newPeer();
    this.peer = peer;
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + this.code, { reliable: true });
      this.conn = conn;
      this._bindConn(conn);
    });
    peer.on('error', (e) => this.handlers.error(e));
  }

  _bindConn(conn) {
    conn.on('open', () => this.handlers.connected());
    conn.on('data', (msg) => this.handlers.data(msg));
    conn.on('close', () => this.handlers.closed());
    conn.on('error', (e) => this.handlers.error(e));
  }

  send(msg) {
    if (this.conn && this.conn.open) this.conn.send(msg);
  }

  destroy() {
    try { if (this.conn) this.conn.close(); } catch (_) {}
    try { if (this.peer) this.peer.destroy(); } catch (_) {}
    this.conn = null;
    this.peer = null;
  }
}
