import {
  LingbaoM9, M9_PRO_MAX, M9_ULTRA, BUTTON_ASSIGNMENTS, BUTTON_SLOTS,
  decodeButtonMatrix, descriptorKey, setButtonDescriptor,
  buildMacroImage, macroBinding
} from './driver/index.js';
import { encodeMacroEvent } from './driver/macro.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const DEBOUNCE_VALUES = [1,2,4,6,8,10];
const DPI_ENABLE = [0x0e,0x17,0x20,0x29,0x32,0x3b];
const DPI_VALUE = [0x10,0x19,0x22,0x2b,0x34,0x3d];
const PAGE_META = {
  performance:['Performance','Sensor timing, polling and motion processing.'],
  dpi:['DPI','Six onboard DPI stages with independent X/Y values.'],
  buttons:['Buttons','Physical button assignments and raw key matrix.'],
  macros:['Macros','Create, edit, organize, persist and sync hardware macros.'],
  diagnostics:['Diagnostics','Raw WebHID, profile and protocol information.'],
};
const PLAYBACK_MODES = [
  { value:0, label:'Play once' },
  { value:1, label:'Repeat continuously' },
  { value:2, label:'Toggle repeat' },
  { value:3, label:'Repeat while held' },
  { value:4, label:'Repeat a fixed count' },
];
const STORAGE_VERSION = 2;

const state = {
  variant:'pro-max',
  definition:M9_PRO_MAX,
  mouse:null,
  profile:null,
  dirty:false,
  logs:[],
  matrix:null,
  matrixDefault:null,
  matrixDirty:false,
  macroEvents:[],
  macroLibrary:[],
  editingMacroId:null,
  macroLibraryDirty:false,
  syncedMacroIds:[],
};

function storageKey(kind='library') {
  return `lingbao-m9:${state.variant}:macros:${kind}:v${STORAGE_VERSION}`;
}
function newMacroId() {
  return crypto.randomUUID?.() ?? `macro-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function normalizeEvent(e) { return {...e}; }
function normalizeMacro(m, i=0) {
  return {
    id: m.id || newMacroId(),
    name: String(m.name || `Macro ${i + 1}`),
    data: Array.isArray(m.data) ? m.data.map(normalizeEvent) : [],
    playbackMode: Number.isInteger(Number(m.playbackMode)) ? Number(m.playbackMode) : 0,
    playbackCount: Math.max(1, Math.min(255, Number(m.playbackCount) || 1)),
  };
}
function loadMacroStorage() {
  try {
    const raw = localStorage.getItem(storageKey());
    state.macroLibrary = raw ? JSON.parse(raw).map(normalizeMacro) : [];
    const syncRaw = localStorage.getItem(storageKey('sync'));
    const sync = syncRaw ? JSON.parse(syncRaw) : {};
    state.syncedMacroIds = Array.isArray(sync.ids) ? sync.ids : [];
    state.macroLibraryDirty = state.syncedMacroIds.join('|') !== state.macroLibrary.map(m => m.id).join('|');
  } catch (error) {
    state.macroLibrary = [];
    state.syncedMacroIds = [];
    state.macroLibraryDirty = false;
    console.warn('Failed to load macro localStorage', error);
  }
}
function saveMacroStorage() {
  localStorage.setItem(storageKey(), JSON.stringify(state.macroLibrary));
}
function saveSyncState() {
  localStorage.setItem(storageKey('sync'), JSON.stringify({ids:state.syncedMacroIds, savedAt:Date.now()}));
}
function markMacroLibraryDirty() {
  state.macroLibraryDirty = true;
  saveMacroStorage();
  renderMacroLibrary();
}
function playbackLabel(mode) {
  return PLAYBACK_MODES.find(x => x.value === Number(mode))?.label ?? `Unknown playback (${mode})`;
}
function log(msg) {
  const stamp = new Date().toLocaleTimeString();
  state.logs.push(`[${stamp}] ${msg}`);
  $('#eventLog').textContent = state.logs.join('\n');
}
function toast(msg,error=false) {
  const el=$('#toast');
  el.textContent=msg;
  el.classList.toggle('error',error);
  el.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer=setTimeout(()=>el.classList.remove('show'),2800);
}
const definitionForVariant=v=>v==='ultra'?M9_ULTRA:M9_PRO_MAX;
const u16le=(b,a)=>b[a]|(b[a+1]<<8);
function hex(bytes){return[...bytes].map((v,i)=>`${i%16===0?(i?'\n':''):' '}${v.toString(16).padStart(2,'0').toUpperCase()}`).join('')}
const rgbHex=(b,a)=>'#'+[b[a],b[a+1],b[a+2]].map(v=>v.toString(16).padStart(2,'0')).join('');

function setDirty(v=true){
  state.dirty=v;
  $('#saveBtn').disabled=!v||!state.profile;
  $('#dirtyStatus').textContent=state.profile?(v?'Unsaved changes':'Profile synced'):'No profile loaded';
}
function renderOptions(container,options,currentRaw,onPick){
  container.innerHTML='';
  for(const option of options){
    const b=document.createElement('button');
    b.textContent=option.name;
    b.classList.toggle('selected',option.value===currentRaw);
    b.onclick=()=>{onPick(option);renderAll();setDirty()};
    container.appendChild(b);
  }
}
function renderPerformance(){
  if(!state.profile)return;
  const p=state.profile;
  renderOptions($('#pollingWired'),state.definition.pollingRates,p.getPollingRaw('wired'),o=>p.setPollingRaw('wired',o.value));
  renderOptions($('#polling24g'),state.definition.pollingRates,p.getPollingRaw('2.4g'),o=>p.setPollingRaw('2.4g',o.value));
  renderOptions($('#lodOptions'),state.definition.liftOffDistances,p.liftOffDistanceRaw,o=>p.liftOffDistanceRaw=o.value);
  $('#highPollingWarning').classList.toggle('hidden',!(p.getPollingRaw('wired')===6||p.getPollingRaw('2.4g')===6));
  const db=p.bytes[0x46],dbIndex=Math.max(0,DEBOUNCE_VALUES.indexOf(db));
  $('#debounceRange').value=String(dbIndex);
  $('#debounceOutput').textContent=`${DEBOUNCE_VALUES[dbIndex]} ms`;
  $('#motionSync').checked=!!p.bytes[0x47];
  $('#linearCalibration').checked=!!p.bytes[0x48];
  const sleep=u16le(p.bytes,0x44),select=$('#sleepSelect');
  select.value=[...select.options].some(o=>+o.value===sleep)?String(sleep):'0';
}
function renderDpi(){
  if(!state.profile)return;
  const bytes=state.profile.bytes,list=$('#dpiList');
  list.innerHTML='';
  $('#dpiMaxLabel').textContent=state.definition.dpiMax.toLocaleString();
  for(let stage=0;stage<6;stage++){
    const base=DPI_VALUE[stage],enableBase=DPI_ENABLE[stage],row=document.createElement('div');
    row.className='dpi-row'+(state.profile.activeDpi===stage?' active':'');
    row.innerHTML=`<button class="dpi-index" title="Make active">${stage+1}</button><label class="dpi-enabled"><input type="checkbox" ${bytes[enableBase]?'checked':''}></label><label class="dpi-input"><span>X DPI</span><input type="number" min="${state.definition.dpiMin}" max="${state.definition.dpiMax}" step="${state.definition.dpiStep}" value="${u16le(bytes,base)}"></label><label class="dpi-input"><span>Y DPI</span><input type="number" min="${state.definition.dpiMin}" max="${state.definition.dpiMax}" step="${state.definition.dpiStep}" value="${u16le(bytes,base+2)}"></label><div class="color-dot" style="--dot:${rgbHex(bytes,enableBase+6)}" title="DPI color"></div>`;
    const [activeBtn,enabled,x,y]=[row.querySelector('.dpi-index'),row.querySelector('input[type=checkbox]'),...row.querySelectorAll('input[type=number]')];
    activeBtn.onclick=()=>{state.profile.activeDpi=stage;setDirty();renderDpi()};
    enabled.onchange=()=>{state.profile.setDpiEnabled(stage,enabled.checked);setDirty()};
    const update=()=>{state.profile.setDpi(stage,+x.value,+y.value);setDirty();renderDiagnostics()};
    x.onchange=update;y.onchange=update;list.appendChild(row);
  }
}
function renderButtons(){
  const host=$('#buttonList');
  if(!state.matrix){host.innerHTML='<div class="inline-note">Connect the mouse to load the current button matrix.</div>';return}
  const decoded=decodeButtonMatrix(state.matrix);
  host.innerHTML='';
  for(const slot of decoded){
    const row=document.createElement('div');
    row.className='button-edit-row';
    const select=document.createElement('select');
    select.className='control-select';
    const currentKey=descriptorKey(slot.descriptor),groups=new Map();
    for(const a of BUTTON_ASSIGNMENTS){if(!groups.has(a.group))groups.set(a.group,[]);groups.get(a.group).push(a)}
    if(!slot.assignment){
      const o=document.createElement('option');
      o.value=currentKey;
      const macro = (slot.descriptor[0]===0x70||slot.descriptor[0]===0x71) ? state.macroLibrary[slot.descriptor[1]] : null;
      o.textContent=macro?`Macro: ${macro.name}`:`Unknown / raw (${currentKey.toUpperCase()})`;
      select.appendChild(o);
    }
    for(const[group,items]of groups){
      const og=document.createElement('optgroup');og.label=group;
      for(const a of items){
        const o=document.createElement('option');o.value=descriptorKey(a.code);o.textContent=a.label;
        if(o.value===currentKey)o.selected=true;
        og.appendChild(o);
      }
      select.appendChild(og);
    }
    select.onchange=()=>{
      const chosen=BUTTON_ASSIGNMENTS.find(a=>descriptorKey(a.code)===select.value);
      if(!chosen)return;
      state.matrix=setButtonDescriptor(state.matrix,slot.id,chosen.code);
      state.matrixDirty=true;
      $('#writeMatrixBtn').disabled=false;
      renderButtons();renderMatrixHex();
    };
    row.innerHTML=`<strong>${slot.name}</strong>`;
    row.appendChild(select);
    const code=document.createElement('code');code.textContent=currentKey.toUpperCase();row.appendChild(code);
    host.appendChild(row);
  }
}
function renderMatrixHex(){
  if(!state.matrix)return;
  $('#matrixHex').textContent=hex(state.matrix);
  const tail=state.matrix.slice(15);
  $('#matrixTailNote').classList.remove('hidden');
  $('#matrixTailNote').textContent=`Preserved opaque tail (bytes 15–32): ${[...tail].map(v=>v.toString(16).padStart(2,'0').toUpperCase()).join(' ')}`;
}
function renderDiagnostics(){
  if(!state.profile||!state.mouse)return;
  const d=state.mouse.transport.device,pairs=[
    ['Product',d.productName||'Unknown'],
    ['VID',`0x${d.vendorId.toString(16).padStart(4,'0')}`],
    ['PID',`0x${d.productId.toString(16).padStart(4,'0')}`],
    ['Variant',state.definition.variant],
    ['Profile size',`${state.definition.profileSize} bytes`],
    ['Matrix size',`${state.definition.matrixSize} bytes`],
    ['Report length',`${state.mouse.transport.layout.reportLength} bytes`],
    ['Macro/matrix chunk','24 bytes (validated)'],
    ['Local macros',String(state.macroLibrary.length)],
  ];
  $('#deviceDiagnostics').innerHTML=pairs.map(([k,v])=>`<dt>${k}</dt><dd>${v}</dd>`).join('');
  $('#profileHex').textContent=hex(state.profile.bytes);
}

function renderMacro(){
  $('#macroSummary').textContent=`${state.macroEvents.length} event${state.macroEvents.length===1?'':'s'}`;
  $('#macroEvents').innerHTML=state.macroEvents.map((e,i)=>{
    let encoded;
    try{encoded=[...encodeMacroEvent(e)].map(x=>x.toString(16).padStart(2,'0').toUpperCase()).join(' ')}catch{encoded='encode error'}
    return `<div class="macro-event">
      <div class="macro-event-index">${i+1}</div>
      <div><strong>${e.action} · ${e.key}</strong><br><small>${e.duration} ms · ${encoded}</small></div>
      <div class="save-actions">
        <button class="text-button macro-event-up" data-i="${i}" ${i===0?'disabled':''}>↑</button>
        <button class="text-button macro-event-down" data-i="${i}" ${i===state.macroEvents.length-1?'disabled':''}>↓</button>
        <button class="text-button macro-event-delete" data-i="${i}">Delete</button>
      </div>
    </div>`;
  }).join('')||'<div class="inline-note">No events yet.</div>';
  $$('.macro-event-up').forEach(b=>b.onclick=()=>moveEvent(+b.dataset.i,-1));
  $$('.macro-event-down').forEach(b=>b.onclick=()=>moveEvent(+b.dataset.i,1));
  $$('.macro-event-delete').forEach(b=>b.onclick=()=>{state.macroEvents.splice(+b.dataset.i,1);renderMacro()});
  $('#saveMacroBtn').disabled=state.macroEvents.length===0;
  $('#saveSyncBindMacroBtn').disabled=!state.mouse||state.macroEvents.length===0;
  $('#macroEditorMode').textContent=state.editingMacroId?'Editing existing macro':'Creating new macro';
  const mode=Number($('#macroPlayback').value);
  $('#macroCountRow').classList.toggle('hidden',mode!==4);
  renderMacroLibrary();
}
function renderMacroLibrary(){
  const host=$('#macroLibrary'),note=$('#macroLibraryStatus');
  const syncState=state.macroLibraryDirty?'Local changes not synced to mouse.':'Local order matches the last successful sync from this browser.';
  note.textContent=state.macroLibrary.length
    ? `${state.macroLibrary.length} saved macro${state.macroLibrary.length===1?'':'s'}. ${syncState}`
    : 'No saved macros. Macros are stored locally in this browser until you sync them to the mouse.';
  $('#syncMacroLibraryBtn').disabled=!state.mouse||state.macroLibrary.length===0||!state.macroLibraryDirty;
  host.innerHTML=state.macroLibrary.map((m,i)=>{
    const count=m.playbackMode===4?` × ${m.playbackCount}`:'';
    return `<div class="macro-event">
      <div class="macro-event-index">${i}</div>
      <div><strong>${m.name}</strong><br><small>${m.data.length} event${m.data.length===1?'':'s'} · ${playbackLabel(m.playbackMode)}${count}</small></div>
      <div class="save-actions">
        <button class="text-button macro-edit" data-id="${m.id}">Edit</button>
        <button class="text-button macro-bind" data-id="${m.id}" ${state.mouse?'':'disabled'}>Bind</button>
        <button class="text-button macro-up" data-id="${m.id}" ${i===0?'disabled':''}>↑</button>
        <button class="text-button macro-down" data-id="${m.id}" ${i===state.macroLibrary.length-1?'disabled':''}>↓</button>
        <button class="text-button macro-delete" data-id="${m.id}">Delete</button>
      </div>
    </div>`;
  }).join('')||'<div class="inline-note">Library is empty.</div>';
  $$('.macro-edit').forEach(b=>b.onclick=()=>editMacro(b.dataset.id));
  $$('.macro-bind').forEach(b=>b.onclick=()=>bindSavedMacro(b.dataset.id));
  $$('.macro-up').forEach(b=>b.onclick=()=>moveMacro(b.dataset.id,-1));
  $$('.macro-down').forEach(b=>b.onclick=()=>moveMacro(b.dataset.id,1));
  $$('.macro-delete').forEach(b=>b.onclick=()=>deleteMacro(b.dataset.id));
}
function renderAll(){renderPerformance();renderDpi();renderButtons();renderMatrixHex();renderDiagnostics();renderMacro()}

async function connect(){
  if(!('hid'in navigator)){toast('WebHID is not available in this browser.',true);return}
  try{
    $('#connectBtn').disabled=true;$('#emptyConnectBtn').disabled=true;
    log(`Requesting ${state.definition.variant} HID device…`);
    state.mouse=await LingbaoM9.connect(state.definition);
    const d=state.mouse.transport.device;
    log(`Opened ${d.productName||'M9'} (VID ${d.vendorId.toString(16)}, PID ${d.productId.toString(16)})`);
    state.profile=await state.mouse.readProfile(0);
    state.matrix=await state.mouse.readKeyMatrix(0);
    state.matrixDefault=await state.mouse.readDefaultKeyMatrix();
    state.matrixDirty=false;
    $('#emptyState').classList.add('hidden');$('#configArea').classList.remove('hidden');
    $('#connectionStatus').textContent='Connected';$('#connectionStatus').className='status online';
    $('#connectBtn').textContent='Connected';
    $('#deviceName').textContent=state.definition.productName||(state.variant==='ultra'?'M9 Ultra':'M9 Pro Max');
    setDirty(false);renderAll();
    toast('Mouse connected and profile loaded.');
  }catch(err){
    console.error(err);log(`Connection error: ${err.message}`);
    $('#connectionStatus').textContent='Connection failed';$('#connectionStatus').className='status error';
    toast(err.message||String(err),true);
  }finally{$('#connectBtn').disabled=false;$('#emptyConnectBtn').disabled=false}
}
async function reloadProfile(){
  if(!state.mouse)return;
  try{state.profile=await state.mouse.readProfile(0);setDirty(false);renderAll();log('Reloaded profile from device');toast('Profile reloaded.')}
  catch(err){log(`Reload error: ${err.message}`);toast(err.message,true)}
}
async function saveProfile(){
  if(!state.mouse||!state.profile||!state.dirty)return;
  try{$('#saveBtn').disabled=true;state.profile=await state.mouse.writeProfile(0,state.profile);setDirty(false);renderAll();log('Wrote profile with command 0x06');toast('Changes applied to mouse.')}
  catch(err){log(`Write error: ${err.message}`);toast(err.message,true);$('#saveBtn').disabled=false}
}
async function readMatrix(){
  if(!state.mouse)return;
  try{state.matrix=await state.mouse.readKeyMatrix(0);state.matrixDirty=false;$('#writeMatrixBtn').disabled=true;renderButtons();renderMatrixHex();log('Read current key matrix with command 0x08');toast('Current key matrix reloaded.')}
  catch(err){log(`Matrix read error: ${err.message}`);toast(err.message,true)}
}
async function restoreMatrixDefaults(){
  if(!state.mouse)return;
  try{state.matrixDefault=await state.mouse.readDefaultKeyMatrix();state.matrix=Uint8Array.from(state.matrixDefault);state.matrixDirty=true;$('#writeMatrixBtn').disabled=false;renderButtons();renderMatrixHex();log('Loaded factory/default matrix from command 0x07');toast('Factory mappings loaded. Click Apply button mappings to write them.')}
  catch(err){log(`Default matrix error: ${err.message}`);toast(err.message,true)}
}
async function writeMatrix(){
  if(!state.mouse||!state.matrix||!state.matrixDirty)return;
  try{
    $('#writeMatrixBtn').disabled=true;
    const before=Uint8Array.from(state.matrix);
    await state.mouse.writeKeyMatrix(before);
    const verify=await state.mouse.readKeyMatrix(0),ok=verify.length===before.length&&verify.every((v,i)=>v===before[i]);
    state.matrix=verify;state.matrixDirty=!ok;$('#writeMatrixBtn').disabled=!state.matrixDirty;renderButtons();renderMatrixHex();
    if(!ok)throw new Error('Matrix write completed but read-back did not match');
    log('Wrote hardware-validated 24+9 byte key matrix and verified via 0x08');toast('Button mappings applied and verified.');
  }catch(err){$('#writeMatrixBtn').disabled=false;log(`Matrix write error: ${err.message}`);toast(err.message,true)}
}

function moveEvent(index,delta){
  const to=index+delta;if(to<0||to>=state.macroEvents.length)return;
  [state.macroEvents[index],state.macroEvents[to]]=[state.macroEvents[to],state.macroEvents[index]];
  renderMacro();
}
function resetMacroEditor(){
  state.editingMacroId=null;
  state.macroEvents=[];
  $('#macroName').value='Macro';
  $('#macroPlayback').value='0';
  $('#macroCount').value='1';
  renderMacro();
}
function editMacro(id){
  const m=state.macroLibrary.find(x=>x.id===id);if(!m)return;
  state.editingMacroId=id;
  state.macroEvents=m.data.map(normalizeEvent);
  $('#macroName').value=m.name;
  $('#macroPlayback').value=String(m.playbackMode);
  $('#macroCount').value=String(m.playbackCount||1);
  renderMacro();
  $('#macroName').focus();
}
function macroFromEditor(){
  if(!state.macroEvents.length)throw new Error('Add at least one macro event');
  const mode=Number($('#macroPlayback').value);
  return {
    id:state.editingMacroId||newMacroId(),
    name:$('#macroName').value.trim()||'Macro',
    data:state.macroEvents.map(normalizeEvent),
    playbackMode:mode,
    playbackCount:mode===4?Math.max(1,Math.min(255,Number($('#macroCount').value)||1)):1,
  };
}
function saveMacroLocal(){
  try{
    const macro=macroFromEditor();
    const index=state.macroLibrary.findIndex(x=>x.id===macro.id);
    if(index>=0)state.macroLibrary[index]=macro;else state.macroLibrary.push(macro);
    state.editingMacroId=macro.id;
    markMacroLibraryDirty();
    log(`${index>=0?'Updated':'Created'} local macro "${macro.name}"`);
    toast(`${macro.name} saved locally.`);
    renderMacro();
    return macro;
  }catch(err){toast(err.message,true);return null}
}
function moveMacro(id,delta){
  const from=state.macroLibrary.findIndex(x=>x.id===id),to=from+delta;
  if(from<0||to<0||to>=state.macroLibrary.length)return;
  [state.macroLibrary[from],state.macroLibrary[to]]=[state.macroLibrary[to],state.macroLibrary[from]];
  markMacroLibraryDirty();
  log(`Moved macro "${state.macroLibrary[to].name}" to index ${to}`);
}
function deleteMacro(id){
  const index=state.macroLibrary.findIndex(x=>x.id===id);if(index<0)return;
  const [removed]=state.macroLibrary.splice(index,1);
  if(state.editingMacroId===id)resetMacroEditor();
  markMacroLibraryDirty();
  log(`Deleted local macro "${removed.name}". Device is unchanged until sync.`);
  toast(`${removed.name} deleted locally.`);
}
function remapExistingMacroBindings(matrix, oldIds, newIds){
  if(!oldIds.length)return {bytes:Uint8Array.from(matrix),changed:false};
  let next=Uint8Array.from(matrix),changed=false;
  for(const slot of BUTTON_SLOTS){
    const d=next.slice(slot.offset,slot.offset+3);
    if(d[0]!==0x70&&d[0]!==0x71)continue;
    const oldId=oldIds[d[1]];
    if(!oldId)continue;
    const newIndex=newIds.indexOf(oldId);
    if(newIndex>=0){
      if(newIndex!==d[1]){next[slot.offset+1]=newIndex;changed=true}
    }else if(state.matrixDefault){
      next.set(state.matrixDefault.slice(slot.offset,slot.offset+3),slot.offset);changed=true;
    }
  }
  return {bytes:next,changed};
}
async function syncMacroLibrary(){
  if(!state.mouse)throw new Error('Connect the mouse first');
  if(!state.macroLibrary.length)throw new Error('Refusing to write an empty macro image');
  const newIds=state.macroLibrary.map(m=>m.id);
  const blob=buildMacroImage(state.macroLibrary);
  log(`Syncing ${state.macroLibrary.length}-macro library (${blob.length} image bytes)…`);
  await state.mouse.writeMacroImage(blob);
  const live=Uint8Array.from(await state.mouse.readKeyMatrix(0));
  const remap=remapExistingMacroBindings(live,state.syncedMacroIds,newIds);
  if(remap.changed){
    log('Macro indexes changed; remapping existing macro button bindings…');
    await state.mouse.writeKeyMatrix(remap.bytes);
    state.matrix=await state.mouse.readKeyMatrix(0);
  }else state.matrix=live;
  state.syncedMacroIds=[...newIds];
  state.macroLibraryDirty=false;
  saveMacroStorage();saveSyncState();
  renderAll();
  log('Macro library sync committed successfully');
  toast('Macro library synced to mouse.');
}
async function bindSavedMacro(id,targetOverride=null){
  try{
    if(!state.mouse)throw new Error('Connect the mouse first');
    const index=state.macroLibrary.findIndex(m=>m.id===id);
    if(index<0)throw new Error('Macro no longer exists');
    if(state.macroLibraryDirty||state.syncedMacroIds.join('|')!==state.macroLibrary.map(m=>m.id).join('|'))await syncMacroLibrary();
    const macro=state.macroLibrary[index];
    const target=targetOverride||$('#macroTarget').value;
    const binding=Uint8Array.from(macroBinding(index,{mode:macro.playbackMode,count:macro.playbackCount}));
    const current=Uint8Array.from(await state.mouse.readKeyMatrix(0));
    const next=setButtonDescriptor(current,target,binding);
    await state.mouse.writeKeyMatrix(next);
    const verify=await state.mouse.readKeyMatrix(0);
    if(!verify.every((v,i)=>v===next[i]))throw new Error('Macro binding matrix did not verify byte-for-byte');
    state.matrix=verify;state.matrixDirty=false;renderAll();
    log(`Bound ${target} to "${macro.name}" (index ${index}, ${playbackLabel(macro.playbackMode)})`);
    toast(`${macro.name} bound to ${target}.`);
  }catch(err){log(`Macro bind error: ${err.message}`);toast(err.message,true)}
}
async function saveSyncBindMacro(){
  const macro=saveMacroLocal();if(!macro)return;
  try{await syncMacroLibrary();await bindSavedMacro(macro.id,$('#macroTarget').value)}
  catch(err){log(`Macro save/sync error: ${err.message}`);toast(err.message,true)}
}
async function importMacroDb(file){
  try{
    const parsed=JSON.parse(await file.text()),records=parsed?.stores?.store;
    if(!Array.isArray(records))throw new Error('No stores.store array found in Lingbao DB export');
    state.macroLibrary=records.filter(r=>Array.isArray(r.data)).map((r,i)=>normalizeMacro({
      name:r.name||`Imported macro ${i+1}`,
      data:r.data,
      playbackMode:r.playbackMode,
      playbackCount:r.playbackCount,
    },i));
    state.syncedMacroIds=[...state.macroLibrary.map(m=>m.id)];
    state.macroLibraryDirty=false;
    saveMacroStorage();saveSyncState();renderMacroLibrary();
    log(`Migrated ${state.macroLibrary.length} macros from Lingbao browser DB JSON into localStorage`);
    toast(`Migrated ${state.macroLibrary.length} macros.`);
  }catch(err){log(`Macro DB import error: ${err.message}`);toast(err.message,true)}
}

$('#variantSelect').onchange=e=>{
  if(state.mouse){e.target.value=state.variant;toast('Disconnect/reload the page before changing variant.',true);return}
  state.variant=e.target.value;state.definition=definitionForVariant(state.variant);
  $('#deviceName').textContent=state.variant==='ultra'?'M9 Ultra':'M9 Pro Max';
  $('#dpiMaxLabel').textContent=state.definition.dpiMax.toLocaleString();
  loadMacroStorage();resetMacroEditor();renderMacroLibrary();
};
$('#connectBtn').onclick=connect;$('#emptyConnectBtn').onclick=connect;$('#reloadBtn').onclick=reloadProfile;$('#saveBtn').onclick=saveProfile;
$('#readMatrixBtn').onclick=readMatrix;$('#restoreMatrixBtn').onclick=restoreMatrixDefaults;$('#writeMatrixBtn').onclick=writeMatrix;
$('#debounceRange').oninput=e=>{const ms=DEBOUNCE_VALUES[+e.target.value];$('#debounceOutput').textContent=`${ms} ms`;state.profile?.setDebounce(ms);setDirty();renderDiagnostics()};
$('#motionSync').onchange=e=>{state.profile?.setMotionSync(e.target.checked);setDirty();renderDiagnostics()};
$('#linearCalibration').onchange=e=>{state.profile?.setLinearCalibration(e.target.checked);setDirty();renderDiagnostics()};
$('#sleepSelect').onchange=e=>{state.profile?.setSleepSeconds(+e.target.value);setDirty();renderDiagnostics()};
$$('.nav-item').forEach(btn=>btn.onclick=()=>{
  $$('.nav-item').forEach(b=>b.classList.toggle('active',b===btn));
  $$('.page').forEach(p=>p.classList.toggle('active',p.dataset.pagePanel===btn.dataset.page));
  const[title,desc]=PAGE_META[btn.dataset.page];$('#pageTitle').textContent=title;$('#pageDescription').textContent=desc;
});
$('#macroType').onchange=e=>{$('#macroKeyRow').classList.toggle('hidden',e.target.value!=='key');$('#macroMouseRow').classList.toggle('hidden',e.target.value!=='mouse')};
$('#macroPlayback').onchange=renderMacro;
$('#addMacroEventBtn').onclick=()=>{
  const type=$('#macroType').value,action=$('#macroAction').value,duration=Math.max(0,Math.min(65535,+$('#macroDelay').value||0));
  if(type==='mouse')state.macroEvents.push({action,duration,key:$('#macroMouse').value});
  else{
    const key=$('#macroKey').value.trim().toUpperCase();
    if(!key||key.length!==1){toast('This macro editor currently accepts single A–Z / 0–9 keys.',true);return}
    state.macroEvents.push({action,duration,key,unicode:key.charCodeAt(0)});
  }
  renderMacro();
};
$('#newMacroBtn').onclick=resetMacroEditor;
$('#clearMacroBtn').onclick=()=>{state.macroEvents=[];renderMacro()};
$('#saveMacroBtn').onclick=saveMacroLocal;
$('#saveSyncBindMacroBtn').onclick=saveSyncBindMacro;
$('#syncMacroLibraryBtn').onclick=()=>syncMacroLibrary().catch(err=>{log(`Macro sync error: ${err.message}`);toast(err.message,true)});
$('#macroDbFile').onchange=e=>{const f=e.target.files?.[0];if(f)importMacroDb(f);e.target.value=''};
$('#clearMacroLibraryBtn').onclick=()=>{
  state.macroLibrary=[];state.editingMacroId=null;state.macroEvents=[];markMacroLibraryDirty();renderMacro();
  log('Cleared local macro library. Device macro memory is unchanged until a non-empty library is synced.');
  toast('Local macro library cleared.');
};
$('#clearLogBtn').onclick=()=>{state.logs=[];$('#eventLog').textContent=''};
window.addEventListener('beforeunload',e=>{if(state.dirty){e.preventDefault();e.returnValue=''}});

for(const mode of PLAYBACK_MODES){
  const option=document.createElement('option');
  option.value=String(mode.value);option.textContent=mode.label;
  $('#macroPlayback').appendChild(option);
}
loadMacroStorage();
renderButtons();
renderMacro();
