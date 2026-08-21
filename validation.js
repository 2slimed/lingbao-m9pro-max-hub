import { LingbaoM9, M9_PRO_MAX, M9_ULTRA, setButtonDescriptor } from './driver/index.js';

const $ = (s) => document.querySelector(s);
const hex = (bytes) => [...bytes].map((v,i) => `${i % 16 === 0 ? (i ? '\n' : '') : ' '}${v.toString(16).padStart(2,'0').toUpperCase()}`).join('');
const same = (a,b) => a.length === b.length && a.every((v,i) => v === b[i]);
const state = { mouse:null, matrix:null, originalMatrix:null, definition:M9_PRO_MAX, macroIndex:null };

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
    log(`Connected and read live matrix through command 0x08`);
    status('Ready. Run the no-op matrix validation first.');
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

async function uploadAndBindMacro() {
  try {
    requireMouse();
    if (!$('#replaceMacros').checked) throw new Error('Confirm the macro-memory warning first');
    state.originalMatrix = Uint8Array.from(await state.mouse.readKeyMatrix(0));
    const events = [
      { action:'down', duration:20, key:'A', unicode:0x41 },
      { action:'up', duration:20, key:'A', unicode:0x41 },
    ];
    log('Uploading command-0x15 image containing one macro (index 0): A down → A up');
    state.macroIndex = await state.mouse.uploadMacro([], events);
    if (state.macroIndex !== 0) throw new Error(`Driver returned macro index ${state.macroIndex}; expected zero-based index 0`);
    const binding = state.mouse.macroBinding(0,{mode:1});
    log(`Binding physical Back button to ${[...binding].map(v=>v.toString(16).padStart(2,'0').toUpperCase()).join(' ')}`);
    const next = setButtonDescriptor(state.originalMatrix,'backward',binding);
    await state.mouse.writeKeyMatrix(next);
    const verify = await state.mouse.readKeyMatrix(0);
    if (!same(next,verify)) throw new Error('Macro binding did not survive matrix read-back');
    state.matrix = verify; $('#matrix').textContent = hex(verify);
    $('#capture').value = ''; $('#capture').focus(); $('#restore').disabled = false;
    log('Macro upload was acknowledged and 70 00 01 binding verified in live matrix');
    status('ARMED — the Back button is now bound to macro 0. With the field focused, press Back; expected output is “a”.','validation-pass');
  } catch (error) { log(`Macro test error: ${error.message}`); status(`FAIL — ${error.message}`,'validation-fail'); }
}

async function restore() {
  try {
    requireMouse();
    if (!state.originalMatrix) throw new Error('No saved pre-test matrix exists');
    log('Restoring the exact pre-test 33-byte matrix…');
    await state.mouse.writeKeyMatrix(state.originalMatrix);
    const verify = await state.mouse.readKeyMatrix(0);
    if (!same(state.originalMatrix,verify)) throw new Error('Original matrix did not restore byte-for-byte');
    state.matrix = verify; $('#matrix').textContent = hex(verify);
    state.originalMatrix = null; $('#restore').disabled = true;
    log('PASS: original button matrix restored and verified');
    status('Original Back-button mapping restored. The test macro can remain in macro memory until macro enumeration/reset is implemented.');
  } catch (error) { log(`Restore error: ${error.message}`); status(`RESTORE FAILED — ${error.message}`,'validation-fail'); }
}

$('#capture').addEventListener('input', () => {
  if ($('#capture').value.toLowerCase().includes('a')) {
    log('PASS: physical Back button executed macro index 0 and produced A');
    status('PASS — command 0x15 upload + 70 00 01 macro binding are behaviorally validated. Restore the Back mapping now.','validation-pass');
  }
});
$('#connect').onclick = connect;
$('#validate').onclick = validateMatrix;
$('#macro').onclick = uploadAndBindMacro;
$('#restore').onclick = restore;
