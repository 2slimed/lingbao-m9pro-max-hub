import assert from 'node:assert/strict';
import { buildMacroBlob, encodeMacroEvent, macroBinding, MACRO_COMMAND_LENGTH } from '../driver/macro.js';

const hex = bytes => [...bytes].map(x => x.toString(16).padStart(2,'0')).join(' ');
const numericCmd = cmd => cmd.map(v => typeof v === 'string' ? parseInt(v,16) : v);

assert.equal(MACRO_COMMAND_LENGTH,0x12);
assert.deepEqual([...encodeMacroEvent({action:'down',duration:20,key:'A',unicode:0x41})],[0x14,0x00,0x8a,0x04]);
assert.deepEqual([...encodeMacroEvent({action:'up',duration:20,key:'A',unicode:0x41})],[0x14,0x00,0x0a,0x04]);
assert.deepEqual(macroBinding(0,{mode:1}),[0x70,0x00,0x01]);
assert.deepEqual(macroBinding(0,{mode:4,count:7}),[0x71,0x00,0x07]);

// Known-good Lingbao IndexedDB snapshot: macro 0, "bhop" (Space down/up).
const bhop = {
  data:[
    {key:'Space',action:'down',duration:20,unicode:32},
    {key:'Space',action:'up',duration:1,unicode:32},
  ],
  cmd:['00','00','15',18,'00','00','00','aa','55','1a','00',1,'00','00','00','00','00','00','00','00','00','00','00','12','00','02','00','00','00','14','00','8A','2C','01','00','0A','2C'],
};
const builtBhop = buildMacroBlob([],bhop.data);
assert.deepEqual([...builtBhop],numericCmd(bhop.cmd));

// Known-good next Lingbao snapshot: append macro 1, "autoclick" (Left down/up).
const autoclick = {
  data:[
    {key:'Left Button',action:'down',duration:20},
    {key:'Left Button',action:'up',duration:0},
  ],
  cmd:['00','00','15',18,'00','00','00','aa','55','34','00',2,'00','00','00','00','00','00','00','00','00','00','00','14','00','20','00','02','00','00','00','14','00','8A','2C','01','00','0A','2C','02','00','00','00','14','00','81','01','00','00','01','01'],
};
const builtAuto = buildMacroBlob([bhop],autoclick.data);
assert.deepEqual([...builtAuto],numericCmd(autoclick.cmd));
assert.equal(hex(builtAuto),'00 00 15 12 00 00 00 aa 55 34 00 02 00 00 00 00 00 00 00 00 00 00 00 14 00 20 00 02 00 00 00 14 00 8a 2c 01 00 0a 2c 02 00 00 00 14 00 81 01 00 00 01 01');

console.log('protocol tests passed');
