import assert from 'node:assert/strict';
import { buildMacroBlob, encodeMacroEvent, macroBinding } from '../driver/macro.js';

const hex = bytes => [...bytes].map(x => x.toString(16).padStart(2,'0')).join(' ');

assert.deepEqual([...encodeMacroEvent({action:'down',duration:20,key:'A',unicode:0x41})],[0x14,0x00,0x8a,0x04]);
assert.deepEqual([...encodeMacroEvent({action:'up',duration:20,key:'A',unicode:0x41})],[0x14,0x00,0x0a,0x04]);
assert.deepEqual(macroBinding(0,{mode:1}),[0x70,0x00,0x01]);
assert.deepEqual(macroBinding(0,{mode:4,count:7}),[0x71,0x00,0x07]);

const blob = buildMacroBlob([], [
  {action:'down',duration:20,key:'A',unicode:0x41},
  {action:'up',duration:20,key:'A',unicode:0x41},
], {commandLength:0x26});

assert.equal(blob.length,37);
assert.equal(hex(blob),'00 00 15 26 00 00 00 aa 55 1a 00 01 00 00 00 00 00 00 00 00 00 00 00 12 00 02 00 00 00 14 00 8a 04 14 00 0a 04');
console.log('protocol tests passed');
