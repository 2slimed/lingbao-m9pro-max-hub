import { LingbaoM9, M9_PRO_MAX, M9_ULTRA, setButtonDescriptor } from './driver/index.js';
import { buildMacroBlob } from './driver/macro.js';

const $ = (s) => document.querySelector(s);
const hex = (bytes) => [...bytes].map((v,i) => `${i % 16 === 0 ? (i ? '\n' : '') : ' '}${v.toString(16).padStart(2,'0').toUpperCase()}`).join('');
const same = (a,b) => a.length === b.length && a.every((v,i) => v === b[i]);

const bhop = {
  data:[
    {key:'Space',action:'down',duration:20,unicode:32},
    {key:'Space',action:'up',duration:1,unicode:32},
  ],
  cmd:[0x00,0x00,0x15,0x12,0x00,0x00,0x00,0xAA,0x55,0x1A,0x00,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x12,0x00,0x02,0x00,0x00,0x00,0x14,0x00,0x8A,0x2C,0x01,0x00,0x0A,0x2C],
};
const autoclick = {
  data:[
    {key:'Left Button',action:'down',duration:20},
    {key:'Left Button',action:'up',duration:0},
  ],
  cmd:[0x00,0x00,0x15,0x12,0x00,0x00,0x00,0xAA,0x55,0x34,0x00,0x02,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x14,0x00,0x20,0x00,0x02,0x00,0x00,0x00,0x14,0x00,0x8A,0x2C,0x01,0x00,0x0A,0x2C,0x02,0x00,0x00,0x00,0x14,0x00,0x81,0x01,0x00,0x00,0x01,0x01],
};
const testMacro = {
  data:[
    {key:'a',action:'down',duration:20,unicode:65},
    {key:'a',action:'up',duration:0,unicode:65},
  ],
  cmd:[0x00,0x00,0x15,0x12,0x00,0x00,0x00,0xAA,0x55,0x4E,0x00,0x03,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x16,0x00,0x22,0x00,0x2E,0x00,0x02,0x00,0x00,0x00,0x14,0x00,0x8A,0x2C,0x01,0x00,0x0A,0x2C,0x02,0x00,0x00,0x00,0x14,0x00,0x81,0x01,0x00,0x00,0x01,0x01,0x02,0x00,0x00,0x00,0x14,0x00,0x8A,0x04,0x00,0x00,0x0A,0x04],
};
const THREE_MACRO_IMAGE = Uint8Array.from(testMacro.cmd);
const EXISTING_MACROS = [bhop, autoclick, testMacro];
const TEMP_B_EVENTS = [
  {key:'B',action:'down',duration:20,unicode:66},
  {key:'B',action:'up',duration:0,unicode:66},
];

const state = {
  mouse:null,
  matrix:null,
  definition:M9_PRO_MAX,
  preMacroMatrix:null,
  tempMacroActive:false,
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
    status('Ready. Keep the official Lingbao configurator closed during validation.');
  } catch (error) { log(`Connect error: ${error.message}`); status(error.message,'validation-fail'); }
}

async function validateMatrix() {
  try {
    requireMouse();
    const before = Uint8Array.from(await state.mouse.readKeyMatrix(0));
    log('Writing identical matrix with captured 24 + 9 byte command-0x09 framing…');
    await state.mouse.writeKeyMatrix(before);
    const after = await state.mouse.readKeyMatrix(0);
    renderMatrix(after);
    if (!same(before, after)) throw new Error('0x09 → 0x08 read-back differed');
    log('PASS: all 33 matrix bytes matched after committed write/read-back');
    status('PASS — button matrix path remains valid.','validation-pass');
  } catch (error) { log(`Matrix validation error: ${error.message}`); status(`FAIL — ${error.message}`,'validation-fail'); }
}

async function runMacroTest() {
  try {
    requireMouse();
    if (!$('#macroAck').checked) throw new Error('Confirm the macro test warning first');
    if (state.tempMacroActive) throw new Error('Temporary macro test is already active; clean it up first');

    state.preMacroMatrix = Uint8Array.from(await state.mouse.readKeyMatrix(0));
    log(`Saved pre-test matrix: ${hex(state.preMacroMatrix).replaceAll('\n',' ')}`);

    const fourMacroImage = buildMacroBlob(EXISTING_MACROS, TEMP_B_EVENTS);
    if (fourMacroImage.macroIndex !== 3) throw new Error(`Unexpected temporary macro index ${fourMacroImage.macroIndex}`);
    log(`Built temporary macro index 3 (${fourMacroImage.length} DB-image bytes): B down/up`);
    log('Uploading with captured official flow: 0x01 → fixed 24-byte 0x15 windows → 0x02…');
    await state.mouse.writeMacroImage(fourMacroImage);

    const binding = Uint8Array.of(0x70,0x03,0x00);
    const next = setButtonDescriptor(state.preMacroMatrix,'backward',binding);
    log('Binding physical Back to temporary macro 3 as 70 03 00…');
    await state.mouse.writeKeyMatrix(next);
    const verify = await state.mouse.readKeyMatrix(0);
    renderMatrix(verify);
    if (!same(next, verify)) throw new Error('Temporary macro binding did not survive 0x09 → 0x08 verification');

    state.tempMacroActive = true;
    $('#cleanupMacroTest').disabled = false;
    $('#capture').value = '';
    $('#capture').focus();
    log('PASS: macro index 3 uploaded and 70 03 00 is present in live Back slot.');
    status('ARMED — press physical Back in the focused field. Expected output: b','validation-pass');
  } catch (error) {
    log(`Macro test error: ${error.message}`);
    status(`FAIL — ${error.message}`,'validation-fail');
  }
}

async function cleanupMacroTest() {
  try {
    requireMouse();
    if (!state.preMacroMatrix) throw new Error('No pre-test matrix snapshot exists');

    log('Cleanup step 1/2: restoring exact pre-test 33-byte matrix…');
    await state.mouse.writeKeyMatrix(state.preMacroMatrix);
    const verify = await state.mouse.readKeyMatrix(0);
    renderMatrix(verify);
    if (!same(state.preMacroMatrix, verify)) throw new Error('Pre-test matrix did not restore byte-for-byte');

    log('Cleanup step 2/2: restoring exact three-macro Lingbao DB image…');
    await state.mouse.writeMacroImage(THREE_MACRO_IMAGE);

    state.preMacroMatrix = null;
    state.tempMacroActive = false;
    $('#cleanupMacroTest').disabled = true;
    log('PASS: original matrix restored; temporary macro 3 removed by three-macro image replay.');
    status('Cleanup complete — matrix and captured three-macro state restored.','validation-pass');
  } catch (error) {
    log(`Cleanup error: ${error.message}`);
    status(`CLEANUP FAILED — ${error.message}`,'validation-fail');
  }
}

$('#capture').addEventListener('input', () => {
  if (state.tempMacroActive && $('#capture').value.toLowerCase().includes('b')) {
    log('PASS: physical Back executed newly-created macro index 3 and produced B');
    status('PASS — macro compiler, 0x15 upload transport, and macro binding are behaviorally validated. Run cleanup now.','validation-pass');
  }
});

$('#connect').onclick = connect;
$('#validate').onclick = validateMatrix;
$('#runMacroTest').onclick = runMacroTest;
$('#cleanupMacroTest').onclick = cleanupMacroTest;
