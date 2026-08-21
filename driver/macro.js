const MOUSE_BUTTON = {
  "Left Button": 0x01,
  "Right Button": 0x02,
  "Middle Button": 0x04,
  Forward: 0x10,
  Backward: 0x08,
};

const HID = {};
for (let i = 0; i < 26; i++) HID[0x41 + i] = 0x04 + i;
for (let i = 1; i <= 9; i++) HID[0x30 + i] = 0x1d + i;
HID[0x30] = 0x27;
Object.assign(HID, {
  0x20: 0x2c, 0xbd: 0x2d, 0xbb: 0x2e, 0xdb: 0x2f, 0xdd: 0x30, 0xdc: 0x31,
  0x3b: 0x33, 0xde: 0x34, 0xbc: 0x36, 0x2f: 0x38, 0xc0: 0x35,
  0x60: 0x62, 0x61: 0x59, 0x62: 0x5a, 0x63: 0x5b, 0x64: 0x5c, 0x65: 0x5d,
  0x66: 0x5e, 0x67: 0x5f, 0x68: 0x60, 0x69: 0x61, 0x6a: 0x55, 0x6b: 0x57,
  0x6d: 0x56, 0x6e: 0x63, 0x6f: 0x54, 0x90: 0x53, 0xaf: 0xe9, 0xae: 0xea,
  0xad: 0xe2, 0xac: 0x23, 0xb4: 0x8a, 0xaa: 0xad, 0xab: 0xae,
});

const SPECIAL_MODIFIER_UNICODE = new Set(["91a", "91b", "16a", "16b", "17a", "17b", "18a", "18b"]);
const SPECIAL_HID = {
  "16a": 0xe1, "16b": 0xe5, "17a": 0xe0, "17b": 0xe4,
  "18a": 0xe2, "18b": 0xe6, "91a": 0xe3, "91b": 0xe7,
};

const MACRO_COMMAND_LENGTH = 0x12;
const u16le = n => [n & 0xff, (n >>> 8) & 0xff];

export function encodeMacroEvent(event) {
  if (event.duration < 0 || event.duration > 0xffff) throw new RangeError("Macro duration must fit uint16");
  const [lo, hi] = u16le(event.duration);
  let sign = 0, type = 0, code = 0;

  if (event.action === "move") {
    if (event.key === "Move Mouse Up") { sign = 1; type = 5; }
    else if (event.key === "Move Mouse Down") { sign = 0; type = 5; }
    else if (event.key === "Move Mouse Left") { sign = 1; type = 4; }
    else { sign = 0; type = 4; }
    code = event.pxSize;
  } else if (event.key in MOUSE_BUTTON) {
    sign = event.action === "down" ? 1 : 0;
    type = 1;
    code = MOUSE_BUTTON[event.key];
  } else {
    if (!("unicode" in event)) throw new Error(`Unsupported macro event: ${event.key}`);
    sign = event.action === "down" ? 1 : 0;
    const u = String(event.unicode).toLowerCase();
    if (SPECIAL_MODIFIER_UNICODE.has(u)) {
      type = 9;
      code = SPECIAL_HID[u] ?? 0;
    } else {
      type = 10;
      const numeric = typeof event.unicode === "number" ? event.unicode : Number(event.unicode);
      code = HID[numeric] ?? 0;
    }
    if (!code) throw new Error(`No HID mapping for macro key ${event.key} (${event.unicode})`);
  }

  if (code < 0 || code > 0xff) throw new RangeError("Macro code/pxSize must fit a byte");
  return Uint8Array.of(lo, hi, (sign << 7) | (type & 0x7f), code);
}

export function macroBinding(macroIndex, playback) {
  if (!Number.isInteger(macroIndex) || macroIndex < 0 || macroIndex > 0xff) throw new RangeError("Macro index must fit a byte");
  if (playback.mode === 4) {
    const count = Math.max(1, Math.min(255, Number(playback.count) || 1));
    return [0x71, macroIndex, count];
  }
  return [0x70, macroIndex, playback.mode];
}

/**
 * Build Lingbao's complete command-0x15 macro image from an ordered library.
 * Each item only needs a `data` event array; prior Lingbao `cmd` snapshots are
 * not required. Reordering the array therefore reassigns device macro indexes.
 */
export function buildMacroImage(macros) {
  if (!Array.isArray(macros) || macros.length === 0) throw new Error("Macro library must contain at least one macro");
  if (macros.length > 255) throw new RangeError("Macro library cannot exceed 255 entries");

  const records = macros.map((macro, index) => {
    if (!Array.isArray(macro.data) || macro.data.length === 0) throw new Error(`Macro ${index} has no events`);
    if (macro.data.length > 0xffff) throw new RangeError(`Macro ${index} has too many events`);
    const encoded = macro.data.flatMap(event => Array.from(encodeMacroEvent(event)));
    return [...u16le(macro.data.length), 0x00, 0x00, ...encoded];
  });

  // This field and pointer formula are reproduced byte-for-byte from multiple
  // known-good Lingbao IndexedDB images.
  const tableEnd = macros.length * 0x1a;
  const header = [0, 0, 0x15, MACRO_COMMAND_LENGTH, 0, 0, 0, 0xaa, 0x55, ...u16le(tableEnd), macros.length];
  while (header.length < 23) header.push(0);

  const pointerTableBytes = macros.length * 2;
  let recordOffset = 0x10 + pointerTableBytes;
  const pointers = [];
  for (const record of records) {
    pointers.push(...u16le(recordOffset));
    recordOffset += record.length;
  }

  return Uint8Array.from([...header, ...pointers, ...records.flat()]);
}

/** Append one macro while preserving compatibility with the earlier API. */
export function buildMacroBlob(existing, newEvents) {
  const blob = buildMacroImage([...existing, { data: newEvents }]);
  Object.defineProperty(blob, "macroIndex", { value: existing.length, enumerable: false });
  return blob;
}

export { MACRO_COMMAND_LENGTH };
