const MOUSE_BUTTON = {
    "Left Button": 0x01, "Right Button": 0x02, "Middle Button": 0x04, Forward: 0x10, Backward: 0x08
};
// Standard keyboard USB HID usages used by Lingbao's table. Extend if needed.
const HID = {};
for (let i = 0; i < 26; i++)
    HID[0x41 + i] = 0x04 + i;
for (let i = 1; i <= 9; i++)
    HID[0x30 + i] = 0x1d + i;
HID[0x30] = 0x27;
Object.assign(HID, { 0x20: 0x2c, 0xbd: 0x2d, 0xbb: 0x2e, 0xdb: 0x2f, 0xdd: 0x30, 0xdc: 0x31,
    0x3b: 0x33, 0xde: 0x34, 0xbc: 0x36, 0x2f: 0x38, 0xc0: 0x35,
    0x60: 0x62, 0x61: 0x59, 0x62: 0x5a, 0x63: 0x5b, 0x64: 0x5c, 0x65: 0x5d,
    0x66: 0x5e, 0x67: 0x5f, 0x68: 0x60, 0x69: 0x61, 0x6a: 0x55, 0x6b: 0x57,
    0x6d: 0x56, 0x6e: 0x63, 0x6f: 0x54, 0x90: 0x53, 0xaf: 0xe9, 0xae: 0xea,
    0xad: 0xe2, 0xac: 0x23, 0xb4: 0x8a, 0xaa: 0xad, 0xab: 0xae });
const SPECIAL_MODIFIER_UNICODE = new Set(["91a", "91b", "16a", "16b", "17a", "17b", "18a", "18b"]);
const SPECIAL_HID = {
    "16a": 0xe1, "16b": 0xe5, "17a": 0xe0, "17b": 0xe4, "18a": 0xe2, "18b": 0xe6,
    "91a": 0xe3, "91b": 0xe7
};
function u16le(n) { return [n & 0xff, (n >>> 8) & 0xff]; }
export function encodeMacroEvent(event) {
    if (event.duration < 0 || event.duration > 0xffff)
        throw new RangeError("Macro duration must fit uint16");
    const [lo, hi] = u16le(event.duration);
    let sign = 0, type = 0, code = 0;
    if (event.action === "move") {
        if (event.key === "Move Mouse Up") {
            sign = 1;
            type = 5;
        }
        else if (event.key === "Move Mouse Down") {
            sign = 0;
            type = 5;
        }
        else if (event.key === "Move Mouse Left") {
            sign = 1;
            type = 4;
        }
        else {
            sign = 0;
            type = 4;
        }
        code = event.pxSize;
    }
    else if (event.key in MOUSE_BUTTON) {
        sign = event.action === "down" ? 1 : 0;
        type = 1;
        code = MOUSE_BUTTON[event.key];
    }
    else {
        if (!("unicode" in event))
            throw new Error(`Unsupported macro event: ${event.key}`);
        sign = event.action === "down" ? 1 : 0;
        const u = String(event.unicode).toLowerCase();
        if (SPECIAL_MODIFIER_UNICODE.has(u)) {
            type = 9;
            code = SPECIAL_HID[u] ?? 0;
        }
        else {
            type = 10;
            const numeric = typeof event.unicode === "number" ? event.unicode : Number(event.unicode);
            code = HID[numeric] ?? 0;
        }
        if (!code)
            throw new Error(`No HID mapping for macro key ${event.key} (${event.unicode})`);
    }
    if (code < 0 || code > 0xff)
        throw new RangeError("Macro code/pxSize must fit a byte");
    return Uint8Array.of(lo, hi, (sign << 7) | (type & 0x7f), code);
}
export function macroBinding(macroIndex, playback) {
    if (playback.mode === 4)
        return [0x71, macroIndex, playback.count ?? 1];
    return [0x70, macroIndex, playback.mode];
}
/**
 * Rebuild Lingbao's global macro-memory image. Lingbao uses zero-based macro
 * indices in button bindings, while the header stores the total macro count.
 * `existing` is the already-known macro list in device/index order.
 */
export function buildMacroBlob(existing, newEvents, layout) {
    const macroCount = existing.length;
    const newIndex = macroCount;
    const totalCount = macroCount + 1;
    const commandLength = layout.commandLength;
    const eventBytes = Array.from(newEvents, encodeMacroEvent);
    const tableEnd = totalCount * 0x1a;
    const header = [0, 0, 0x15, commandLength, 0, 0, 0, 0xaa, 0x55, ...u16le(tableEnd), totalCount];
    while (header.length < 23)
        header.push(0);
    const oldEventTails = existing.flatMap(m => {
        const needed = (m.data.length + 1) * 4;
        return m.cmd.slice(-needed);
    });
    const pointers = [];
    for (let i = 0; i < totalCount; i++) {
        const prior = existing.slice(0, i).reduce((n, m) => n + (m.data.length + 1) * 4, 0);
        pointers.push(...u16le(0x10 + totalCount * 2 + prior));
    }
    const sizeField = u16le(newEvents.length);
    const recordPrefix = [sizeField[0], sizeField[1], 0, 0];
    const flattenedNewEvents = eventBytes.flatMap(x => Array.from(x));
    const blob = Uint8Array.from([...header, ...pointers, ...oldEventTails, ...recordPrefix, ...flattenedNewEvents]);
    Object.defineProperty(blob, "macroIndex", { value: newIndex, enumerable: false });
    return blob;
}
