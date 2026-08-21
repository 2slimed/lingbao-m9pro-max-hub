import { LingbaoM9, M9_PRO_MAX, M9_ULTRA, setButtonDescriptor } from './driver/index.js';

const $ = (s) => document.querySelector(s);
const hex = (bytes) => [...bytes].map((v,i) => `${i % 16 === 0 ? (i ? '\n' : '') : ' '}${v.toString(16).padStart(2,'0').toUpperCase()}`).join('');
const same = (a,b) => a.length === b.length && a.every((v,i) => v === b[i]);

// Exact known-good two-macro global image exported from Lingbao's IndexedDB:
// macro 0 = "bhop" (Space down/up), macro 1 = "autoclick" (Left down/up).
// Command byte 3 is 0x12 even on the 63-byte/56-byte HID transport.
const KNOWN_GOOD_MACRO_IMAGE = Uint8Array.from([
  0x00,0x00,0x15,0x12,0x00,0x00,0x00,0xAA,0x55,0x34,0x00,0x02,
  0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,
  0x14,0x00,0x20,0x00,
  0x02,0x00,0x00,0x00,0x14,0x00,0x8A,0x2C,0x01,0x00,0x0A,0x2C,
  0x02,0x00,0x00,0x00,0x14,0x00,0x81,0x01,0x00,0x00,0x01,0x01,
]);

const state = {
  mouse:null,
  matrix:null,
  definition:M9_PRO_MAX,
  macroReplayPassed:false,
  preBindingMatrix:null,
};

function log(message) {
  const time = new Date().toLocaleTimeString();
  $('#log').textContent += `[${time}] ${message}\n`;
  $('#log').scrollTop = $('#log').scrollHeight;
}
function status(message, kind='') {
  const el = $('#status'); el.textContent = message; el.className = `inline-note ${kind}`;
}
function requireMouse() { if (!state.mouse) throw new Error('Connect the mouse first'); }
function renderMatrix(bytes) { state.matrix = bytes; $('#matrix').textContent = hex(bytes); }

async function connect() {
  try {
    state.definition = $('#variant').value === 'ultra' ? M9_ULTRA : M9_PRO_MAX;
    log(`Requesting ${state.definition.productName}…`);
    state.mouse = await LingbaoM9.connect(state.definition);
    const d = state.mouse.transport.device;
    renderMatrix(await state.mouse.readKeyMatrix(0));
    $('#device').textContent = `${d.productName || 'M9'} · VID 0x${d.vendorId.toString(16)} · PID 0x${d.productId.toString(16)} · ${state.matrix.length}-byte matrix`;
    $('#connected').textContent = 'Connected';
    $('#connected').className = 'status online';
    log('Connected and read live matrix through command 0x08');
    status('Ready. Run matrix validation, then the known-good macro replay.');
  } catch (error) { log(`Connect error: ${error.message}`); status(error.message,'validation-fail'); }
}

async function validateMatrix() {
  try {
    requireMouse();
    const before = Uint8Array.from(await state.mouse.readKeyMatrix(0));
    log('Writing the exact same 33-byte matrix through command 0x09…');
    await state.mouse.writeKeyMatrix(before);
    const after = await state.mouse.readKeyMatrix(0);
    renderMatrix(after);
    if (!same(before, after)) throw new Error('0x09 → 0x08 read-back differed');
    log('PASS: all 33 matrix bytes matched after write/read-back');
    status('PASS — button matrix write path is validated on this device.','validation-pass');
  } catch (error) { log(`Matrix validation error: ${error.message}`); status(`FAIL — ${error.message}`,'validation-fail'); }
}

async function replayKnownGoodMacros() {
  let before = null;
  try {
    requireMouse();
    if (!$('#macroAck').checked) throw new Error('Confirm the known-good macro replay warning first');
    before = Uint8Array.from(await state.mouse.readKeyMatrix(0));
    log(`Snapshot matrix before macro replay: ${hex(before).replaceAll('\n',' ')}`);
    log(`Sending exact ${KNOWN_GOOD_MACRO_IMAGE.length}-byte Lingbao DB macro image (00 00 15 12 …), containing bhop + autoclick…`);
    await state.mouse.transport.sendMacroBlob(KNOWN_GOOD_MACRO_IMAGE);
    const after = await state.mouse.readKeyMatrix(0);
    renderMatrix(after);
    if (!same(before, after)) {
      log('FAIL: matrix changed after known-good 0x15 replay. Attempting immediate matrix restoration…');
      await state.mouse.writeKeyMatrix(before);
      const restored = await state.mouse.readKeyMatrix(0);
      renderMatrix(restored);
      if (!same(before, restored)) throw new Error('Macro replay changed matrix and automatic restoration also failed');
      throw new Error('Macro replay changed matrix; original matrix was restored automatically');
    }
    state.macroReplayPassed = true;
    $('#bindExisting').disabled = false;
    log('PASS: command 0x15 replay acknowledged; all 33 matrix bytes remained unchanged');
    status('PASS — corrected 0x15/0x12 macro-memory replay did not disturb the live button matrix. You may now test an existing macro binding.','validation-pass');
  } catch (error) {
    state.macroReplayPassed = false;
    $('#bindExisting').disabled = true;
    log(`Macro replay error: ${error.message}`);
    status(`FAIL — ${error.message}`,'validation-fail');
  }
}

async function bindExistingBhop() {
  try {
    requireMouse();
    if (!state.macroReplayPassed) throw new Error('Known-good macro replay must pass first');
    state.preBindingMatrix = Uint8Array.from(await state.mouse.readKeyMatrix(0));
    const binding = Uint8Array.of(0x70,0x00,0x03); // macro index 0, Lingbao playbackMode 3
    const next = setButtonDescriptor(state.preBindingMatrix,'backward',binding);
    log('Temporarily binding physical Back to existing bhop macro as 70 00 03…');
    await state.mouse.writeKeyMatrix(next);
    const verify = await state.mouse.readKeyMatrix(0);
    renderMatrix(verify);
    if (!same(next, verify)) throw new Error('70 00 03 binding did not survive 0x09 → 0x08 read-back');
    $('#restoreBinding').disabled = false;
    $('#capture').value = '';
    $('#capture').focus();
    log('PASS: 70 00 03 is present in the live matrix. Behavior test armed.');
    status('ARMED — press the physical Back button while the test field is focused. The existing bhop macro should type one Space character.','validation-pass');
  } catch (error) {
    log(`Binding test error: ${error.message}`);
    status(`FAIL — ${error.message}`,'validation-fail');
  }
}

async function restoreBinding() {
  try {
    requireMouse();
    if (!state.preBindingMatrix) throw new Error('No pre-binding matrix snapshot exists');
    log('Restoring exact pre-binding 33-byte matrix…');
    await state.mouse.writeKeyMatrix(state.preBindingMatrix);
    const verify = await state.mouse.readKeyMatrix(0);
    renderMatrix(verify);
    if (!same(state.preBindingMatrix, verify)) throw new Error('Pre-binding matrix did not restore byte-for-byte');
    state.preBindingMatrix = null;
    $('#restoreBinding').disabled = true;
    log('PASS: original button mapping restored byte-for-byte');
    status('Original button mapping restored.','validation-pass');
  } catch (error) {
    log(`Restore error: ${error.message}`);
    status(`RESTORE FAILED — ${error.message}`,'validation-fail');
  }
}

$('#capture').addEventListener('input', () => {
  if ($('#capture').value.includes(' ')) {
    log('PASS: physical Back executed macro index 0 and produced Space');
    status('PASS — existing macro index 0 + 70 00 03 binding are behaviorally validated. Restore the Back mapping now.','validation-pass');
  }
});

$('#connect').onclick = connect;
$('#validate').onclick = validateMatrix;
$('#replayMacros').onclick = replayKnownGoodMacros;
$('#bindExisting').onclick = bindExistingBhop;
$('#restoreBinding').onclick = restoreBinding;
