import WebSocket from 'ws';

function integer(n) {
  const bytes = [];
  do { const b = n & 127; n >>>= 7; bytes.push(b | (n ? 128 : 0)); } while (n);
  return Buffer.from(bytes);
}
export function encode(value) {
  if (value === undefined) return Buffer.from([0]);
  if (typeof value === 'number' && (value | 0) === value) return Buffer.concat([Buffer.from([6]), integer(value)]);
  if (Array.isArray(value)) return Buffer.concat([Buffer.from([4]), integer(value.length), ...value.map(encode)]);
  const data = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  return Buffer.concat([Buffer.from([typeof value === 'string' ? 1 : 5]), integer(data.length), data]);
}
export function decodeMessage(buffer) {
  let pos = 0, remainingValues = 65536;
  function take(n) { if (pos + n > buffer.length) throw Error('Truncated RPC'); const b = buffer.subarray(pos, pos + n); pos += n; return b; }
  function int() { let n = 0; for (let shift = 0; shift < 35; shift += 7) { const b = take(1)[0]; if (shift === 28 && b > 15) throw Error('Invalid RPC integer'); n |= (b & 127) << shift; if (!(b & 128)) return n >>> 0; } throw Error('Invalid RPC integer'); }
  function read(depth = 0) {
    if (depth > 50) throw Error('RPC nesting limit');
    if (--remainingValues < 0) throw Error('RPC value limit');
    const type = take(1)[0];
    if (type === 0) return undefined;
    if (type === 6) return int() | 0;
    if (type === 4) {
      const length = int();
      if (length > remainingValues || length > buffer.length - pos) throw Error('Invalid RPC array');
      const values = [];
      for (let i = 0; i < length; i++) values.push(read(depth + 1));
      return values;
    }
    if (![1, 2, 3, 5].includes(type)) throw Error('Unknown RPC type');
    const data = take(int());
    return type === 5 ? JSON.parse(data.toString()) : type === 1 ? data.toString() : data;
  }
  return [read(), read()];
}
export function frame(header, body) {
  const data = Buffer.concat([encode(header), encode(body)]);
  const head = Buffer.alloc(13); head[0] = 1; head.writeUInt32BE(data.length, 9);
  return Buffer.concat([head, data]);
}

// ZCode SocketProtocol + Channel RPC. Only the monitor's read methods are used.
export class Rpc {
  constructor(url, token) {
    this.handlers = new Map(); this.nextId = 0; this.buffer = Buffer.alloc(0);
    this.ws = new WebSocket(url, { headers: { Cookie: `zcode_lite_token=${encodeURIComponent(token)}` }, maxPayload: 32 * 1024 * 1024, handshakeTimeout: 10000 });
    this.ready = new Promise((resolve, reject) => { this.resolve = resolve; this.reject = reject; });
    this.ready.catch(() => {});
    this.timer = setTimeout(() => this.ws.terminate(), 15000);
    this.ws.on('error', () => this.reject(Error('ZCode connection failed')));
    this.ws.on('close', () => {
      clearTimeout(this.timer); this.reject(Error('ZCode disconnected'));
      for (const handler of this.handlers.values()) handler.reject?.(Error('ZCode disconnected'));
      this.handlers.clear(); this.onClose?.();
    });
    this.ws.on('message', (data) => {
      try {
        this.buffer = Buffer.concat([this.buffer, data]);
        while (this.buffer.length >= 13) {
          const length = this.buffer.readUInt32BE(9);
          if (length > 32 * 1024 * 1024) throw Error('RPC frame too large');
          if (this.buffer.length < length + 13) break;
          const type = this.buffer[0], payload = this.buffer.subarray(13, 13 + length);
          this.buffer = this.buffer.subarray(13 + length);
          if (type !== 1 || !length) continue;
          const [header, body] = decodeMessage(payload);
          if (header[0] === 200) { clearTimeout(this.timer); this.resolve(); continue; }
          const handler = this.handlers.get(header[1]);
          if (!handler) continue;
          if (header[0] === 204) handler.event?.(body);
          else { this.handlers.delete(header[1]); if (header[0] === 201) handler.resolve(body); else handler.reject(Error(body?.message || 'RPC rejected')); }
        }
      } catch { this.ws.terminate(); }
    });
  }
  async call(channel, method, ...args) {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.handlers.delete(id); reject(Error('RPC timeout')); }, 15000);
      this.handlers.set(id, { resolve: (v) => { clearTimeout(timeout); resolve(v); }, reject: (e) => { clearTimeout(timeout); reject(e); } });
      this.ws.send(frame([100, id, channel, method], args));
    });
  }
  async listen(channel, event, arg, listener) {
    await this.ready;
    const id = this.nextId++;
    this.handlers.set(id, { event: listener });
    this.ws.send(frame([102, id, channel, event], arg));
    return () => { this.handlers.delete(id); if (this.ws.readyState === WebSocket.OPEN) this.ws.send(frame([103, id], undefined)); };
  }
  close() { this.ws.terminate(); }
}
