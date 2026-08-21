import { CONFIG_REPORT_ID, M9_IDENTITY } from './constants.js';

export const LARGE_LAYOUT = { reportLength: 63, payloadLength: 56, commandLength: 0x26 };
export const SMALL_LAYOUT = { reportLength: 31, payloadLength: 24, commandLength: 0x12 };

// The M9 uses a 24-byte logical flash/write window for matrix and macro memory
// even when the HID interface itself exposes a 63-byte output report.
export const MEMORY_WRITE_CHUNK = 24;

const u16le = n => [n & 0xff, (n >>> 8) & 0xff];

export class M9Transport {
  constructor(device, layout) {
    this.device = device;
    this.layout = layout;
    this.transactionDepth = 0;
  }

  static async request() {
    const devices = await navigator.hid.requestDevice({
      filters: M9_IDENTITY.productIds.map(productId => ({
        vendorId: M9_IDENTITY.vendorId,
        productId,
        usagePage: M9_IDENTITY.usagePage,
        usage: M9_IDENTITY.usage,
      })),
    });
    if (!devices[0]) throw new Error('No Lingbao M9 device selected');
    if (!devices[0].opened) await devices[0].open();
    return devices[0];
  }

  static detectLayout(device) {
    for (const collection of device.collections) {
      for (const report of collection.outputReports ?? []) {
        if (report.reportId !== CONFIG_REPORT_ID) continue;
        let bits = 0;
        for (const item of report.items ?? []) bits += item.reportSize * item.reportCount;
        const bytes = Math.ceil(bits / 8);
        if (bytes && bytes <= 31) return SMALL_LAYOUT;
      }
    }
    return LARGE_LAYOUT;
  }

  waitInput(timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.device.removeEventListener('inputreport', handler);
        reject(new Error('Timed out waiting for M9 input report'));
      }, timeoutMs);
      const handler = event => {
        clearTimeout(timer);
        this.device.removeEventListener('inputreport', handler);
        resolve(event);
      };
      this.device.addEventListener('inputreport', handler);
    });
  }

  async sendPacket(bytes) {
    const packet = new Uint8Array(this.layout.reportLength);
    packet.set(bytes.subarray(0, packet.length));
    const response = this.waitInput();
    await this.device.sendReport(CONFIG_REPORT_ID, packet);
    const evt = await response;
    return new Uint8Array(evt.data.buffer, evt.data.byteOffset, evt.data.byteLength);
  }

  async control(command) {
    if (command !== 0x01 && command !== 0x02) throw new Error(`Unsupported M9 control command ${command}`);
    return this.sendPacket(Uint8Array.of(0x00, 0x00, command, 0x18, 0x00, 0x00, 0x00));
  }

  // Observed immediately before a working official ordinary matrix write.
  async prepareWrite() {
    return this.sendPacket(Uint8Array.of(0x00, 0x00, 0x1a, 0x06, 0x00, 0x00, 0x00));
  }

  async transaction(operation) {
    if (this.transactionDepth > 0) return operation();
    this.transactionDepth++;
    await this.control(0x01);
    try {
      const result = await operation();
      await this.control(0x02);
      return result;
    } catch (error) {
      try { await this.control(0x02); } catch {}
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }

  async readBlock(command, length) {
    const out = [], chunks = Math.ceil(length / this.layout.payloadLength);
    for (let i = 0; i < chunks; i++) {
      const remaining = length - i * this.layout.payloadLength;
      const chunkLength = Math.min(this.layout.payloadLength, remaining);
      const [lo, hi] = u16le(i * this.layout.payloadLength);
      const response = await this.sendPacket(Uint8Array.of(0, 0, command, chunkLength, lo, hi, 0));
      const take = Math.min(chunkLength, Math.max(0, response.length - 7));
      for (let j = 0; j < take; j++) out.push(response[7 + j]);
    }
    return Uint8Array.from(out).subarray(0, length);
  }

  async writeBlock(command, data, baseIndex = 0, stride = 0, chunkSize = this.layout.payloadLength) {
    const responses = [], chunks = Math.ceil(data.length / chunkSize);
    for (let i = 0; i < chunks; i++) {
      const start = i * chunkSize;
      const chunk = data.subarray(start, start + chunkSize);
      const address = start + stride * baseIndex;
      const [lo, hi] = u16le(address);
      const header = Uint8Array.of(0, 0, command, chunk.length, lo, hi, 0);
      const packet = new Uint8Array(header.length + chunk.length);
      packet.set(header);
      packet.set(chunk, 7);
      const response = await this.sendPacket(packet);
      const take = Math.min(chunk.length, Math.max(0, response.length - 7));
      for (let j = 0; j < take; j++) responses.push(response[7 + j]);
    }
    return Uint8Array.from(responses);
  }

  // Captured from the official configurator: 33-byte matrices are always
  // 0x09/0x18 @ 0x0000 followed by 0x09/0x09 @ 0x0018.
  async writeMatrix(data, baseIndex = 0, stride = 0) {
    await this.prepareWrite();
    return this.transaction(() => this.writeBlock(0x09, data, baseIndex, stride, MEMORY_WRITE_CHUNK));
  }

  // `blob` is Lingbao's IndexedDB representation. Its first seven bytes are a
  // template header and are NOT sent verbatim. The device receives blob[7:]
  // in fixed 24-byte windows, each with a freshly generated command header:
  //   00 00 15 18 <address LE16> 00 <24 payload bytes>
  // The final window still advertises 0x18 and is zero-padded by sendPacket.
  async sendMacroBlob(blob) {
    if (blob.length < 8 || blob[2] !== 0x15) throw new Error('Invalid Lingbao macro blob');
    const memory = blob.subarray(7);
    for (let address = 0; address < memory.length; address += MEMORY_WRITE_CHUNK) {
      const chunk = memory.subarray(address, address + MEMORY_WRITE_CHUNK);
      const [lo, hi] = u16le(address);
      const packet = new Uint8Array(7 + MEMORY_WRITE_CHUNK);
      packet.set([0, 0, 0x15, MEMORY_WRITE_CHUNK, lo, hi, 0]);
      packet.set(chunk, 7);
      await this.sendPacket(packet);
    }
  }
}
