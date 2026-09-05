// รันสคริปต์ของ listen.html บน DOM + Web Audio จำลอง แล้วป้อนไฟล์ MIDI จริงเข้าไป
// จับ ReferenceError / TypeError และตรวจว่าโน้ตที่แปลงได้ถูกต้องจริง
const fs = require('fs'), vm = require('vm');
const file = process.argv[2] || require('path').join(__dirname, '..', 'listen.html');
const html = fs.readFileSync(file, 'utf8');
const code = html.split('<script>')[1].split('</script>')[0];

/* ---------- สร้างไฟล์ MIDI สำหรับทดสอบ ---------- */
const PPQ = 480;
const vlq = n => { const o = [n & 0x7f]; n >>>= 7; while (n) { o.unshift((n & 0x7f) | 0x80); n >>>= 7; } return o; };
const be32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = n => [(n >>> 8) & 255, n & 255];
const chars = s => [...s].map(c => c.charCodeAt(0));
const meta = (t, d) => [0xFF, t, ...vlq(d.length), ...d];

function chunk(evs) {                       // evs: [[delta, ...bytes]]
  const body = [];
  for (const e of evs) body.push(...vlq(e[0]), ...e.slice(1));
  body.push(...vlq(0), 0xFF, 0x2F, 0x00);
  return [...chars('MTrk'), ...be32(body.length), ...body];
}

function seq(ch, prog, name, pitches, len) {
  const evs = [[0, ...meta(0x03, chars(name))], [0, 0xC0 | ch, prog]];
  for (const p of pitches) { evs.push([0, 0x90 | ch, p, 100]); evs.push([len, 0x80 | ch, p, 0]); }
  return chunk(evs);
}

const MELODY = [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60];   // ไล่ C เมเจอร์ขึ้นลง
const conductor = chunk([
  [0, ...meta(0x03, chars('Conductor'))],
  [0, ...meta(0x51, [0x09, 0x27, 0xC0])],          // 600000 us = 100 BPM ตั้งให้ต่างจากค่าตั้งต้น 120 ของหน้า
  [0, ...meta(0x58, [4, 2, 24, 8])],               // 4/4
]);
const bass = seq(0, 33, 'Bass', [36, 43, 36, 43], PPQ * 2);
const lead = seq(1, 73, 'Lead Vocal', MELODY, PPQ);
const drums = chunk([[0, ...meta(0x03, chars('Drums'))],
  ...[36, 38, 36, 38].flatMap(p => [[0, 0x99, p, 110], [PPQ, 0x89, p, 0]])]);

const bytes = Uint8Array.from([
  ...chars('MThd'), ...be32(6), ...be16(1), ...be16(4), ...be16(PPQ),
  ...conductor, ...bass, ...lead, ...drums,
]);
const MIDI_BUF = bytes.buffer.slice(0, bytes.length);

/* ---------- ค่าเริ่มต้นของ control อ่านจาก HTML จริง ---------- */
const defs = {};
for (const m of html.matchAll(/<input[^>]*id="(\w+)"[^>]*>/g)) {
  const tag = m[0], id = m[1];
  const type = (tag.match(/type="(\w+)"/) || [])[1] || 'text';
  defs[id] = type === 'checkbox'
    ? { type, checked: /\schecked/.test(tag), value: 'on' }
    : { type, value: (tag.match(/value="([^"]*)"/) || [])[1] ?? '' };
}
for (const m of html.matchAll(/<select[^>]*id="(\w+)"[\s\S]*?<\/select>/g)) {
  const blk = m[0], id = m[1];
  const o = blk.match(/<option value="([^"]*)"[^>]*selected[^>]*>([^<]*)</)
    || blk.match(/<option value="([^"]*)"[^>]*>([^<]*)</) || [, '', ''];
  defs[id] = { type: 'select-one', value: o[1] };
}
for (const m of html.matchAll(/<button[^>]*id="(\w+)"[^>]*>/g))
  defs[m[1]] = { disabled: /\sdisabled/.test(m[0]) };
for (const m of html.matchAll(/<table[^>]*id="(\w+)"[^>]*>/g))
  defs[m[1]] = { hidden: /\shidden/.test(m[0]) };
for (const m of html.matchAll(/<p[^>]*id="(\w+)"[^>]*>/g))
  defs[m[1]] = { hidden: /\shidden/.test(m[0]) };

/* ---------- DOM จำลอง ---------- */
let created = 0;
function mkEl(id) {
  const d = defs[id] || {};
  const e = {
    id, type: d.type || '', value: d.value ?? '', checked: d.checked ?? false,
    textContent: '', className: '', title: '',
    disabled: d.disabled ?? false, hidden: d.hidden ?? false,
    href: '', download: '', files: [], dataset: {}, style: {}, children: [], _ls: {},
    classList: { add() { }, remove() { }, contains: () => false },
    appendChild(c) { this.children.push(c); },
    addEventListener(ev, fn) { (this._ls[ev] || (this._ls[ev] = [])).push(fn); },
    fire(ev, arg) { (this._ls[ev] || []).forEach(fn => fn(arg || { preventDefault() { }, stopPropagation() { } })); },
    dispatchEvent(ev) { this.fire(ev.type); return true; },
    querySelector: () => null, querySelectorAll: () => [],
    focus() { }, remove() { }, click() { }, select() { }, setSelectionRange() { },
  };
  let _h = '';
  Object.defineProperty(e, 'innerHTML', {
    get() { return _h; },
    set(v) { _h = v; if (v === '') this.children.length = 0; },
  });
  return e;
}
const cache = {};
const realIds = new Set([...html.matchAll(/id="([\w-]+)"/g)].map(m => m[1]));
const doc = {
  querySelector(sel) {
    const id = sel.replace('#', '');
    if (!realIds.has(id)) return null;
    return cache[sel] || (cache[sel] = mkEl(id));
  },
  createElement: () => { created++; const e = mkEl('_'); doc._made.push(e); return e; },
  addEventListener() { }, execCommand: () => true, body: mkEl('body'), _made: [],
};

/* ---------- Web Audio จำลอง ---------- */
let startedNodes = 0;
const chk = (v, w) => { if (typeof v !== 'number' || !isFinite(v)) throw new Error(w + ' ไม่ใช่ตัวเลข: ' + v); };
class Param {
  constructor(v) { this.value = v; }
  setValueAtTime(v, t) { chk(v, 'setValueAtTime ค่า'); chk(t, 'setValueAtTime เวลา'); return this; }
  linearRampToValueAtTime(v, t) { chk(v, 'linearRamp ค่า'); chk(t, 'linearRamp เวลา'); return this; }
  exponentialRampToValueAtTime(v, t) {
    chk(t, 'exponentialRamp เวลา');
    if (!(v > 0)) throw new Error('exponentialRamp ต้องเป็นบวก ได้ ' + v);
    return this;
  }
  setTargetAtTime() { return this; } cancelScheduledValues() { return this; }
}
const mkNode = () => ({
  connect() { }, disconnect() { }, type: '', buffer: null,
  gain: new Param(1), frequency: new Param(440), Q: new Param(1),
  threshold: new Param(0), ratio: new Param(1), release: new Param(0),
  start(t) { if (t !== undefined) chk(t, 'start() เวลา'); startedNodes++; }, stop() { },
});
// นาฬิกาเดินเมื่อ drain() ไล่ตัวจับเวลา จะได้ทดสอบตารางเวลาแบบมองล่วงหน้าได้ทั้งเพลง
let clock = 1, tid = 0;
const timers = new Map();
function drain(max) {
  let n = 0;
  while (timers.size && n++ < max) {
    const k = timers.keys().next().value;
    const t = timers.get(k); timers.delete(k);
    clock += t.ms / 1000;
    t.fn();
  }
  if (timers.size) die('ตัวจับเวลาไม่จบสักที เกิน ' + max + ' รอบ');
  return n;
}
class Ctx {
  constructor() { this.sampleRate = 44100; this.state = 'running'; this.destination = mkNode(); }
  get currentTime() { return clock; }
  resume() { }
  createGain() { return mkNode(); } createOscillator() { return mkNode(); }
  createBufferSource() { return mkNode(); } createBiquadFilter() { return mkNode(); }
  createDynamicsCompressor() { return mkNode(); }
  createBuffer(c, l, r) { return { getChannelData: () => new Float32Array(l) }; }
}

let lastBlob = null;
class BlobStub { constructor(parts, opt) { this.parts = parts; this.opt = opt; lastBlob = this; } }
class FileReaderStub {
  readAsArrayBuffer(f) { this.result = f._buf; if (this.onload) this.onload(); }
}
const loc = { href: '' };

const sandbox = {
  console, Math, Date, JSON, Promise, Object, Array, String, Number, Boolean, Error,
  isFinite, parseInt, parseFloat, Infinity, NaN, TextDecoder, RegExp,
  Float32Array, Uint8Array, ArrayBuffer, DataView, Map, Set, WeakMap,
  Blob: BlobStub, FileReader: FileReaderStub, Event: class { constructor(t) { this.type = t; } },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() { } },
  document: doc, location: loc,
  setTimeout: (fn, ms) => { timers.set(++tid, { fn, ms: ms || 0 }); return tid; },
  clearTimeout: id => timers.delete(id),
  localStorage: {
    _m: new Map(),
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
    setItem(k, v) { this._m.set(k, String(v)); },
    removeItem(k) { this._m.delete(k); },
  },
  alert: m => { throw new Error('เรียก alert: ' + m); },
};
sandbox.window = sandbox;
sandbox.window.AudioContext = Ctx;
sandbox.window.addEventListener = () => { };

/* ---------- ทดสอบ ---------- */
const name = file.split(/[\\/]/).pop();
const ok = m => console.log('  ✓ ' + m);
const die = (m, e) => {
  console.log('  ✗ ' + name + ' — ' + m + (e ? ': ' + e.message : ''));
  if (e && e.stack) console.log(e.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
};
const el = id => cache['#' + id];

try {
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: name });
} catch (e) { die('พังตอนโหลด', e); }
ok('โหลดผ่าน · สร้าง DOM ' + created + ' โหนด');

for (const id of ['play', 'stop', 'send', 'save', 'copy'])
  if (!el(id) || !el(id).disabled) die('ตอนยังไม่มีไฟล์ ปุ่ม ' + id + ' ต้องกดไม่ได้');
ok('ยังไม่มีไฟล์ — ปุ่มทั้งหมดถูกปิดไว้');

// ---- ป้อนไฟล์ MIDI ----
try {
  el('file').files = [{ name: 'test.mid', _buf: MIDI_BUF }];
  el('file').fire('change');
} catch (e) { die('พังตอนอ่านไฟล์ MIDI', e); }

if (el('msg').className.indexOf('err') >= 0) die('อ่านไฟล์แล้วขึ้น error: ' + el('msg').textContent);
ok('อ่าน MIDI — ' + el('fileMeta').textContent);

// ---- เลือกแทร็กทำนองถูกตัวไหม ----
const rows = doc._made.filter(e => e.innerHTML.startsWith('<td class="num">'));
if (rows.length !== 4) die('ต้องได้ 4 แถวในตารางแทร็ก ได้ ' + rows.length);
if (rows.filter(e => e._ls.click).length !== 2)
  die('ควรคลิกได้แค่ 2 แถว (Bass, Lead) ได้ ' + rows.filter(e => e._ls.click).length);
if (el('trkTbl').hidden) die('ตารางแทร็กยังถูกซ่อนอยู่');
const onRow = doc._made.filter(e => e.className && e.className.indexOf('on') === 0);
if (!onRow.length) die('ไม่ได้เลือกแทร็กไหนเลย');
if (onRow[0].innerHTML.indexOf('Lead Vocal') < 0)
  die('เดาแทร็กทำนองผิด ได้ ' + onRow[0].innerHTML.slice(0, 90));
ok('เดาแทร็กทำนอง — เลือก "Lead Vocal" ถูกตัว (ข้าม Bass, Drums, Conductor)');

// ---- คีย์ ----
if (el('key').value !== '0') die('ควรได้ C เมเจอร์ ได้ค่า ' + el('key').value + ' (' + el('keyAuto').textContent + ')');
ok('หาคีย์ — ' + el('keyAuto').textContent);

// ---- ความเร็ว ----
if (el('tempo').value !== '100') die('ความเร็วควรเป็น 100 ตามไฟล์ ได้ ' + el('tempo').value);
if (el('tempoV').textContent !== '100') die('ป้ายความเร็วไม่ตามค่าที่โหลดมา ได้ ' + el('tempoV').textContent);
if (el('bpc').value !== '1') die('จังหวะต่อห้องควรเป็น 1 ได้ ' + el('bpc').value);
ok('ความเร็ว — ' + el('tempo').value + ' ห้อง/นาที · ' + el('bpc').value + ' จังหวะ/ห้อง');

// ---- โน้ตที่แปลงได้ ----
const out = el('out').value;
const want = 'ด--- ร--- ม--- ฟ--- ซ--- ล--- ท--- ดํ---\nท--- ล--- ซ--- ฟ--- ม--- ร--- ด---';
if (out !== want) die('โน้ตที่แปลงไม่ตรง\n    ได้   ' + JSON.stringify(out) + '\n    ต้องการ ' + JSON.stringify(want));
ok('แปลงโน้ต — ตรงเป๊ะ 15 ห้อง 2 บรรทัด');

const stat = el('stats').innerHTML;
if (stat.indexOf('warn') >= 0) die('ไม่ควรมีคำเตือน แต่ได้: ' + stat);
if (stat.indexOf('<b>15</b>') < 0) die('ควรนับได้ 15 ตัว: ' + stat);
ok('สถิติ — ไม่มีตัวนอกบันไดเสียง ไม่มีโน้ตชนกัน');

// ---- ปุ่มเปิดใช้ได้แล้ว ----
for (const id of ['play', 'send', 'save', 'copy'])
  if (el(id).disabled) die('มีโน้ตแล้ว ปุ่ม ' + id + ' ยังกดไม่ได้');
ok('มีโน้ตแล้ว — ปุ่มเปิดใช้ครบ');

// ---- เปลี่ยนความละเอียดกริด ----
el('spc').value = '2'; el('spc').fire('change');
const coarse = el('out').value;
if (coarse === out) die('เปลี่ยนช่องต่อห้องแล้วผลไม่เปลี่ยน');
if (coarse.split('\n')[0].split(' ')[0] !== 'ด-') die('2 ช่อง/ห้อง ควรได้ "ด-" ได้ ' + coarse.split(' ')[0]);
ok('ปรับช่องต่อห้อง 4 → 2 — แปลงใหม่ให้ทันที');
el('spc').value = '4'; el('spc').fire('change');

// ---- เปลี่ยนคีย์เอง — โน้ตต้องอ่านใหม่ตามคีย์ ----
// C4 ในคีย์ G คือขั้นที่ 4 = ฟ และช่วงเสียงต้องเลื่อนลงเป็น 3 เพื่อไม่ให้มีเครื่องหมายคู่แปดเกิน
el('key').value = '7'; el('key').fire('change');
if (!el('out').value.startsWith('ฟ--- ซ--- ล--- ท--- ดํ'))
  die('คีย์ G ควรเริ่มด้วย "ฟ--- ซ--- ล--- ท--- ดํ" ได้ ' + JSON.stringify(el('out').value.slice(0, 26)));
if (el('stats').innerHTML.indexOf('ช่วงเสียง <b>3</b>') < 0)
  die('คีย์ G ควรเลือกช่วงเสียง 3 · ' + el('stats').innerHTML);
ok('เปลี่ยนคีย์เป็น G — อ่านใหม่เป็น ฟ ซ ล ท ดํ และเลื่อนช่วงเสียงเป็น 3 ให้เอง');
el('key').value = '0'; el('key').fire('change');

// ---- ฟัง — กดหยุดกลางคัน ----
try { el('play').fire('click'); } catch (e) { die('พังตอนกดฟัง', e); }
if (startedNodes === 0) die('กดฟังแล้วไม่มีเสียงถูกตั้งคิวเลย');
if (el('stop').disabled) die('กำลังเล่นอยู่แต่ปุ่มหยุดกดไม่ได้');
if (!el('play').disabled) die('กำลังเล่นอยู่แต่ปุ่มฟังยังกดได้');
ok('กดฟัง — ตั้งคิวล่วงหน้า ' + startedNodes + ' โหนด แล้วรอรอบถัดไป');
el('stop').fire('click');
if (!el('stop').disabled) die('กดหยุดแล้วปุ่มหยุดยังกดได้');
if (el('play').disabled) die('กดหยุดแล้วปุ่มฟังยังกดไม่ได้');
drain(3000);
ok('กดหยุดกลางคัน — ไม่ error');

// ---- ฟังจนจบเพลง — โน้ตทุกตัวต้องถูกตั้งคิวพอดี ----
startedNodes = 0;
el('play').fire('click');
const rounds = drain(3000);
if (startedNodes !== 45) die('15 ตัวต้องได้ 45 โหนด (3 ต่อตัว) ได้ ' + startedNodes);
if (!el('stop').disabled) die('เล่นจบแล้วปุ่มหยุดยังกดได้');
ok('ฟังจนจบ — ตั้งคิวครบ 15 ตัวพอดี · ตารางเวลาเดิน ' + rounds + ' รอบ');

// ---- ฟังแทร็กต้นฉบับ ----
const hear = doc._made.filter(e => e.className === 'hear');
if (hear.length !== 2) die('ควรมีปุ่มฟัง 2 อัน (Bass, Lead) ได้ ' + hear.length);
startedNodes = 0;
hear[1].fire('click');
if (startedNodes !== 45) die('ฟังแทร็ก Lead ควรได้ 45 โหนด ได้ ' + startedNodes);
drain(3000);
ok('ฟังแทร็กต้นฉบับ — ตั้งคิว 15 ตัวจาก MIDI ตรง ๆ');

// ---- เซฟ ----
el('save').fire('click');
if (!lastBlob) die('กดเซฟแล้วไม่ได้ไฟล์');
const saved = JSON.parse(lastBlob.parts.join(''));
if (saved.app !== 'noinoi') die('ไฟล์ที่เซฟไม่ใช่รูปแบบ noinoi');
if (saved.notes !== want) die('ไฟล์ที่เซฟมีโน้ตไม่ตรงกับที่แสดง');
if (saved.settings.tuning !== '12tet') die('ต้องตั้งระบบเสียงเป็น 12tet ได้ ' + saved.settings.tuning);
if (saved.settings.key !== 'w0') die('ต้องตั้งคีย์เป็น w0 ได้ ' + saved.settings.key);
if (saved.settings.oct !== '4') die('ช่วงเสียงควรเป็น 4 ได้ ' + saved.settings.oct);
if (saved.settings.tempo !== '100') die('ความเร็วในไฟล์ควรเป็น 100 ได้ ' + saved.settings.tempo);
if (saved.settings.ching !== false) die('ฉิ่งควรถูกปิดสำหรับเพลงสากล');
ok('เซฟ — variant ' + saved.variant + ' · ' + Object.keys(saved.settings).length + ' ค่า · key ' + saved.settings.key + ' · 12tet');

// ---- ส่งต่อ ----
el('send').fire('click');
const stored = sandbox.localStorage.getItem('noinoi:thai');
if (!stored) die('กดส่งต่อแล้วไม่ได้เขียนลง localStorage');
if (JSON.parse(stored).notes !== want) die('โน้ตที่ส่งต่อไม่ตรง');
if (loc.href !== 'thai.html') die('ควรพาไป thai.html ได้ ' + loc.href);
ok('ส่งต่อ — เขียน noinoi:thai แล้วพาไป ' + loc.href);

el('dest').value = 'khlui';
el('send').fire('click');
if (!sandbox.localStorage.getItem('noinoi:khlui')) die('ส่งไปหน้าขลุ่ยแล้วไม่ได้เขียน noinoi:khlui');
if (loc.href !== 'khlui.html') die('ควรพาไป khlui.html ได้ ' + loc.href);
ok('ส่งต่อหน้าขลุ่ย — เขียน noinoi:khlui แล้วพาไป ' + loc.href);

// ---- ไฟล์เสีย ----
el('file').files = [{ name: 'bad.mid', _buf: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]).buffer }];
el('file').fire('change');
if (el('msg').className.indexOf('err') < 0) die('ไฟล์เสียแล้วไม่ขึ้น error');
if (!el('play').disabled) die('ไฟล์เสียแล้วปุ่มฟังยังกดได้');
ok('ไฟล์ที่ไม่ใช่ MIDI — บอก "' + el('msg').textContent + '"');

console.log('  ✓ ผ่านทั้งหมด');
