import { LingbaoM9, M9_PRO_MAX, M9_ULTRA } from './driver/index.js';

const $ = (s) => document.querySelector(s);
const hex = (bytes) => [...bytes].map((v,i) => `${i % 16 === 0 ? (i ? '\n' : '') : ' '}${v.toString(16).padStart(2,'0').toUpperCase()}`).join('');
const same = (a,b) => a.length === b.length && a.every((v,i) => v === b[i]);
const state = { mouse:null, matrix:null, definition:M9_PRO_MAX };

function log(message) {
  const time = new Date().toLocaleTimeString();
  $('#log').textContent += `[${time}] ${message}\n`;
  $('#log').scrollTop = $('#log').scrollHeight;
}
function status(message, kind='') {
  const el = $('#status'); el.textContent = message; el.className = `inline-note ${kind}`;
}
function requireMouse() { if (!state.mouse) throw new Error('Connect the mouse first'); }

async function connect() {
  try {
    state.definition = $('#variant').value === 'ultra' ? M9_ULTRA : M9_PRO_MAX;
    log(`Requesting ${state.definition.productName}…`);
    state.mouse = await LingbaoM9.connect(state.definition);
    const d = state.mouse.transport.device;
    state.matrix = await state.mouse.readKeyMatrix(0);
    $('#matrix').textContent = hex(state.matrix);
    $('#device').textContent = `${d.productName || 'M9'} · VID 0x${d.vendorId.toString(16)} · PID 0x${d.productId.toString(16)} · ${state.matrix.length}-byte matrix`;
    $('#connected').textContent = 'Connected';
    log('Connected and read live matrix through command 0x08');
    status('Ready. Macro writes are intentionally disabled while command 0x15 is re-traced.');
  } catch (error) { log(`Connect error: ${error.message}`); status(error.message,'validation-fail'); }
}

async function validateMatrix() {
  try {
    requireMouse();
    const before = Uint8Array.from(await state.mouse.readKeyMatrix(0));
    log('Writing the exact same 33-byte matrix through command 0x09…');
    await state.mouse.writeKeyMatrix(before);
    const after = await state.mouse.readKeyMatrix(0);
    state.matrix = after; $('#matrix').textContent = hex(after);
    if (!same(before, after)) throw new Error('0x09 → 0x08 read-back differed');
    log('PASS: all 33 matrix bytes matched after write/read-back');
    status('PASS — button matrix write path is validated on this device.','validation-pass');
  } catch (error) { log(`Matrix validation error: ${error.message}`); status(`FAIL — ${error.message}`,'validation-fail'); }
}

$('#connect').onclick = connect;
$('#validate').onclick = validateMatrix;
