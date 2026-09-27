export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0');
}

// Reassemble bounded ZCode V4 logical JSON frames, verifying their ownership.
export class WireDecoder {
  constructor() { this.pending = new Map(); }
  accept(wire) {
    if (wire.wireVersion !== 3) throw Error('Unsupported wire protocol');
    let frame;
    if (wire.kind === 'complete') {
      frame = wire.frame;
      if (Buffer.byteLength(JSON.stringify(frame) || '') > 16 * 1024 * 1024) throw Error('Logical frame too large');
    }
    else if (wire.kind === 'fragment') {
      if (!Number.isInteger(wire.fragmentCount) || wire.fragmentCount < 1 || wire.fragmentCount > 4096 || !Number.isInteger(wire.fragmentIndex) || wire.fragmentIndex < 0 || wire.fragmentIndex >= wire.fragmentCount || !Number.isSafeInteger(wire.logicalBytes) || wire.logicalBytes > 16 * 1024 * 1024 || wire.logicalBytes < 1 || typeof wire.dataBase64 !== 'string' || wire.dataBase64.length > Math.ceil(wire.logicalBytes / 3) * 4) throw Error('Invalid wire fragment');
      const key = `${wire.subscriptionId}:${wire.logicalFrameId}`;
      for (const [key, value] of this.pending) if (Date.now() - value.started > 30000) { this.pending.delete(key); throw Error('Wire assembly timed out'); }
      if (!this.pending.has(key)) { if (this.pending.size >= 8) throw Error('Wire assembly limit'); this.pending.set(key, { started: Date.now(), parts: new Map(), size: 0, count: wire.fragmentCount, bytes: wire.logicalBytes, checksum: wire.checksum?.value }); }
      const entry = this.pending.get(key);
      if (entry.count !== wire.fragmentCount || entry.bytes !== wire.logicalBytes || entry.checksum !== wire.checksum?.value) throw Error('Inconsistent wire fragments');
      if (!entry.parts.has(wire.fragmentIndex)) { const data = Buffer.from(wire.dataBase64, 'base64'); entry.parts.set(wire.fragmentIndex, data); entry.size += data.length; }
      if (entry.size > entry.bytes) throw Error('Wire assembly overflow');
      if (entry.parts.size !== entry.count) return null;
      this.pending.delete(key);
      const data = Buffer.concat(Array.from({ length: entry.count }, (_, i) => entry.parts.get(i)));
      if (data.length !== entry.bytes || wire.checksum?.algorithm !== 'crc32' || crc32(data) !== entry.checksum) throw Error('Wire checksum mismatch');
      frame = JSON.parse(data.toString());
    } else throw Error('Unknown wire frame');
    if (!frame || frame.subscriptionId !== wire.subscriptionId || frame.topic !== wire.topic || !['snapshot', 'deltas'].includes(frame.payload?.kind)) throw Error('Invalid logical frame');
    return frame;
  }
}
