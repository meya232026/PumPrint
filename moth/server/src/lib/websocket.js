// A small RFC 6455 WebSocket server: text and binary messages, fragmentation,
// ping/pong and the close handshake. No compression extensions. It exists so the
// server has zero npm dependencies; browsers and Node's built-in client both
// speak plain RFC 6455.

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const KEY_RE = /^[+/0-9A-Za-z]{22}==$/;
const utf8 = new TextDecoder('utf-8', { fatal: true });

export const OPEN = 1;
export const CLOSING = 2;
export const CLOSED = 3;

export class WebSocketConnection extends EventEmitter {
  constructor(socket, { maxPayload = 64 * 1024 } = {}) {
    super();
    this.socket = socket;
    this.maxPayload = maxPayload;
    this.readyState = OPEN;
    this.lastSeen = Date.now();
    this._buf = null;
    this._fragments = null;
    this._fragmentOpcode = 0;
    this._fragmentSize = 0;

    socket.setNoDelay(true);
    socket.setTimeout(0);
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('end', () => socket.end());
    socket.on('error', () => socket.destroy());
    socket.on('close', () => this._finish(1006));
  }

  get bufferedAmount() {
    return this.socket.writableLength;
  }

  send(data) {
    if (this.readyState !== OPEN) return false;
    const binary = typeof data !== 'string';
    this.socket.write(encodeFrame(binary ? 0x2 : 0x1, binary ? Buffer.from(data) : Buffer.from(data, 'utf8')));
    return true;
  }

  ping() {
    if (this.readyState === OPEN) this.socket.write(encodeFrame(0x9, Buffer.alloc(0)));
  }

  close(code = 1000, reason = '') {
    if (this.readyState !== OPEN) return;
    this.readyState = CLOSING;
    const reasonBuf = Buffer.from(String(reason).slice(0, 120), 'utf8');
    const payload = Buffer.alloc(2 + reasonBuf.length);
    payload.writeUInt16BE(code, 0);
    reasonBuf.copy(payload, 2);
    this.socket.write(encodeFrame(0x8, payload));
    this.socket.end();
    setTimeout(() => this.socket.destroy(), 3000).unref();
  }

  terminate() {
    this.socket.destroy();
  }

  _onData(chunk) {
    this.lastSeen = Date.now();
    this._buf = this._buf ? Buffer.concat([this._buf, chunk]) : chunk;
    while (this._buf && this.readyState !== CLOSED) {
      const frame = parseFrame(this._buf, this.maxPayload);
      if (frame === null) return;
      if (frame.error) {
        this._buf = null;
        this.close(frame.error, frame.reason);
        return;
      }
      this._buf = frame.consumed < this._buf.length ? this._buf.subarray(frame.consumed) : null;
      this._handleFrame(frame);
    }
  }

  _handleFrame({ fin, opcode, payload }) {
    if (opcode === 0x8) {
      if (this.readyState === OPEN) {
        this.readyState = CLOSING;
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
        const echo = Buffer.alloc(2);
        echo.writeUInt16BE(code === 1005 || code === 1006 ? 1000 : code, 0);
        this.socket.write(encodeFrame(0x8, echo));
        this.socket.end();
      }
      return;
    }
    if (opcode === 0x9) {
      if (this.readyState === OPEN) this.socket.write(encodeFrame(0xa, payload));
      return;
    }
    if (opcode === 0xa) {
      this.emit('pong');
      return;
    }
    if (this.readyState !== OPEN) return;

    if (opcode === 0x0) {
      if (!this._fragments) return this.close(1002, 'Unexpected continuation frame');
      this._fragmentSize += payload.length;
      if (this._fragmentSize > this.maxPayload) return this.close(1009, 'Message too big');
      this._fragments.push(payload);
      if (fin) {
        const whole = Buffer.concat(this._fragments);
        const op = this._fragmentOpcode;
        this._fragments = null;
        this._emitMessage(op, whole);
      }
      return;
    }
    if (opcode === 0x1 || opcode === 0x2) {
      if (this._fragments) return this.close(1002, 'Expected continuation frame');
      if (fin) return this._emitMessage(opcode, payload);
      this._fragments = [payload];
      this._fragmentOpcode = opcode;
      this._fragmentSize = payload.length;
      return;
    }
    this.close(1002, 'Unknown opcode');
  }

  _emitMessage(opcode, buf) {
    if (opcode === 0x2) {
      this.emit('message', buf, true);
      return;
    }
    let text;
    try {
      text = utf8.decode(buf);
    } catch {
      this.close(1007, 'Invalid UTF-8');
      return;
    }
    this.emit('message', text, false);
  }

  _finish(code) {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.emit('close', code);
  }
}

export function parseFrame(buf, maxPayload) {
  if (buf.length < 2) return null;
  const b0 = buf[0];
  const b1 = buf[1];
  const fin = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0f;
  if (b0 & 0x70) return { error: 1002, reason: 'Reserved bits set' };
  if ((b1 & 0x80) === 0) return { error: 1002, reason: 'Client frames must be masked' };
  let len = b1 & 0x7f;
  let offset = 2;
  if (opcode >= 0x8 && (!fin || len > 125)) return { error: 1002, reason: 'Invalid control frame' };
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    if (buf.readUInt32BE(2) !== 0) return { error: 1009, reason: 'Message too big' };
    len = buf.readUInt32BE(6);
    offset = 10;
  }
  if (len > maxPayload) return { error: 1009, reason: 'Message too big' };
  if (buf.length < offset + 4 + len) return null;
  const mask = buf.subarray(offset, offset + 4);
  offset += 4;
  const payload = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) payload[i] = buf[offset + i] ^ mask[i & 3];
  return { fin, opcode, payload, consumed: offset + len };
}

export function encodeFrame(opcode, payload) {
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeUInt32BE(Math.floor(len / 2 ** 32), 2);
    header.writeUInt32BE(len >>> 0, 6);
  }
  header[0] = 0x80 | opcode;
  return Buffer.concat([header, payload]);
}

export class WebSocketServer extends EventEmitter {
  constructor({ server, path = '/ws', maxPayload = 64 * 1024, heartbeatMs = 30_000 }) {
    super();
    this.path = path;
    this.maxPayload = maxPayload;
    this.clients = new Set();
    this._onUpgrade = (req, socket, head) => this.handleUpgrade(req, socket, head);
    server.on('upgrade', this._onUpgrade);
    this.server = server;
    // Browsers answer pings automatically; anything silent for two rounds is gone.
    this._heartbeat = setInterval(() => {
      const cutoff = Date.now() - heartbeatMs * 2.5;
      for (const ws of this.clients) {
        if (ws.lastSeen < cutoff) ws.terminate();
        else ws.ping();
      }
    }, heartbeatMs);
    this._heartbeat.unref();
  }

  handleUpgrade(req, socket, head) {
    const pathname = (req.url || '/').split('?')[0];
    if (pathname !== this.path) return reject(socket, 404, 'Not Found');
    const key = req.headers['sec-websocket-key'];
    const upgrade = String(req.headers.upgrade || '').toLowerCase();
    if (req.method !== 'GET' || upgrade !== 'websocket' || !KEY_RE.test(key || '')) {
      return reject(socket, 400, 'Bad Request');
    }
    if (req.headers['sec-websocket-version'] !== '13') {
      socket.write('HTTP/1.1 426 Upgrade Required\r\nSec-WebSocket-Version: 13\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    const ws = new WebSocketConnection(socket, { maxPayload: this.maxPayload });
    this.clients.add(ws);
    ws.on('close', () => this.clients.delete(ws));
    this.emit('connection', ws, req);
    if (head && head.length) ws._onData(head);
  }

  close() {
    clearInterval(this._heartbeat);
    this.server.off('upgrade', this._onUpgrade);
    for (const ws of this.clients) ws.close(1001, 'Server shutting down');
  }
}

function reject(socket, status, text) {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}
