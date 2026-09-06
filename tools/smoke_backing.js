// รันสคริปต์ของ backing.html บน DOM + Web Audio จำลอง แล้วป้อนไฟล์ MIDI จริงเข้าไป
// ตรวจว่าแยกส่วนตามช่องถูก ปิดทำนองให้ เลื่อนคีย์ถูก และเล่นจนจบเพลงโดยไม่พัง
const fs = require('fs'), vm = require('vm');
const file = process.argv[2] || require('path').join(__dirname, '..', 'backing.html');
const html = fs.readFileSync(file, 'utf8');
const code = html.split('<script>')[1].split('</script>')[0];

/* ---------- สร้างไฟล์ MIDI สำหรับทดสอบ (format 0 — ทุกเครื่องอยู่แทร็กเดียว) ---------- */
const PPQ = 480;
const vlq = n => { const o = [n & 0x7f]; n >>>= 7; while (n) { o.unshift((n & 0x7f) | 0x80); n >>>= 7; } return o; };
const be32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const be16 = n => [(n >>> 8) & 255, n & 255];
const chars = s => [...s].map(c => c.charCodeAt(0));
const meta = (t, d) => [0xFF, t, ...vlq(d.length), ...d];

function chunk(evs) {
  const body = [];
  for (const e of evs) body.push(...vlq(e[0]), ...e.slice(1));
  body.push(...vlq(0), 0xFF, 0x2F, 0x00);
  return [...chars('MTrk'), ...be32(body.length), ...body];
}

// ทำนอง G เมเจอร์ ช่อง 4 · เบส ช่อง 1 · กลอง ช่อง 10 — เขียนเป็น absolute tick แล้วค่อยแปลงเป็น delta
const MELODY = [67, 69, 71, 72, 74, 76, 78, 79, 78, 76, 74, 72, 71, 69, 67];
const abs = [];
abs.push([0, ...meta(0x03, chars('Song'))]);
abs.push([0, ...meta(0x51, [0x09, 0x27, 0xC0])]);          // 100 BPM
abs.push([0, ...meta(0x58, [4, 2, 24, 8])]);
abs.push([0, 0xC0, 33]); abs.push([0, 0xB0, 7, 90]);        // เบส volume 90
abs.push([0, 0xC3, 73]); abs.push([0, 0xB3, 7, 110]);       // ฟลุตทำนอง volume 110
MELODY.forEach((p, i) => { abs.push([i * PPQ, 0x93, p, 100]); abs.push([(i + 1) * PPQ, 0x83, p, 0]); });
[43, 50, 43, 50, 43, 50, 43, 50].forEach((p, i) => { abs.push([i * PPQ * 2, 0x90, p, 100]); abs.push([(i + 1) * PPQ * 2, 0x80, p, 0]); });
for (let i = 0; i < 15; i++) { const d = i % 2 ? 38 : 36; abs.push([i * PPQ, 0x99, d, 110]); abs.push([i * PPQ + 60, 0x89, d, 0]); }
abs.sort((a, b) => a[0] - b[0]);
let last = 0;
const evs = abs.map(e => { const d = e[0] - last; last = e[0]; return [d, ...e.slice(1)]; });
const bytes = Uint8Array.from([...chars('MThd'), ...be32(6), ...be16(0), ...be16(1), ...be16(PPQ), ...chunk(evs)]);
const MIDI_BUF = bytes.buffer.slice(0, bytes.length);

/* ---------- ค่าเริ่มต้นของ control อ่านจาก HTML จริง ---------- */
const defs = {};
for (const m of html.matchAll(/<input[^>]*id="(\w+)"[^>]*>/g)) {
  const tag = m[0], id = m[1];
  const type = (tag.match(/type="(\w+)"/) || [])[1] || 'text';
  defs[id] = type === 'checkbox'
    ? { type, checked: /\schecked/.test(tag), value: 'on', disabled: /\sdisabled/.test(tag) }
    : { type, value: (tag.match(/value="([^"]*)"/) || [])[1] ?? '', disabled: /\sdisabled/.test(tag) };
}
for (const m of html.matchAll(/<select[^>]*id="(\w+)"[\s\S]*?<\/select>/g)) defs[m[1]] = { type: 'select-one', value: '' };
for (const m of html.matchAll(/<button[^>]*id="(\w+)"[^>]*>/g)) defs[m[1]] = { disabled: /\sdisabled/.test(m[0]) };
for (const m of html.matchAll(/<(?:table|p)[^>]*id="(\w+)"[^>]*>/g)) defs[m[1]] = { hidden: /\shidden/.test(m[0]) };

/* ---------- DOM จำลอง ---------- */
function mkEl(id) {
  const d = defs[id] || {};
  const e = {
    id, type: d.type || '', checked: d.checked ?? false, textContent: '', className: '', title: '',
    disabled: d.disabled ?? false, hidden: d.hidden ?? false, files: [], children: [], _ls: {}, _opts: [],
    classList: { add() { }, remove() { }, contains: () => false },
    appendChild(c) { this.children.push(c); },
    addEventListener(ev, fn) { (this._ls[ev] || (this._ls[ev] = [])).push(fn); },
    fire(ev, arg) { (this._ls[ev] || []).forEach(fn => fn(arg || { preventDefault() { }, stopPropagation() { } })); },
    dispatchEvent(ev) { this.fire(ev.type); return true; },
    click() { }, focus() { },
  };
  let _h = '', _v = d.value ?? '';
  Object.defineProperty(e, 'innerHTML', {
    get() { return _h; },
    set(v) {
      _h = v; if (v === '') this.children.length = 0;
      if (this.type === 'select-one') {                    // <select> จำตัวเลือกไว้ จะได้ปฏิเสธค่าที่ไม่มี
        this._opts = [...v.matchAll(/value="([^"]*)"/g)].map(m => m[1]);
        _v = this._opts[0] ?? '';
      }
    },
  });
  Object.defineProperty(e, 'value', {
    get() { return _v; },
    set(v) { v = String(v); if (this.type === 'select-one' && !this._opts.includes(v)) { _v = ''; return; } _v = v; },
  });
  return e;
}
const cache = {}, made = [];
const realIds = new Set([...html.matchAll(/id="([\w-]+)"/g)].map(m => m[1]));
const doc = {
  querySelector(sel) { const id = sel.replace('#', ''); if (!realIds.has(id)) return null; return cache[sel] || (cache[sel] = mkEl(id)); },
  createElement: tag => { const e = mkEl('_'); e.tag = tag; made.push(e); return e; },
  addEventListener() { }, body: mkEl('body'),
};

/* ---------- Web Audio จำลอง ---------- */
let started = 0, stopped = 0;
const chk = (v, w) => { if (typeof v !== 'number' || !isFinite(v)) throw new Error(w + ' ไม่ใช่ตัวเลข: ' + v); };
class Param {
  constructor(v) { this.value = v; }
  setValueAtTime(v, t) { chk(v, 'setValueAtTime ค่า'); chk(t, 'setValueAtTime เวลา'); return this; }
  linearRampToValueAtTime(v, t) { chk(v, 'linearRamp ค่า'); chk(t, 'linearRamp เวลา'); return this; }
  exponentialRampToValueAtTime(v, t) { chk(t, 'exponentialRamp เวลา'); if (!(v > 0)) throw new Error('exponentialRamp ต้องเป็นบวก ได้ ' + v); return this; }
  setTargetAtTime(v, t, c) { chk(v, 'setTarget ค่า'); chk(t, 'setTarget เวลา'); chk(c, 'setTarget ค่าคงที่'); return this; }
  cancelScheduledValues() { return this; }
}
const mkNode = () => ({
  connect() { }, disconnect() { }, type: '', buffer: null,
  gain: new Param(1), frequency: new Param(440), detune: new Param(0), Q: new Param(1),
  threshold: new Param(0), ratio: new Param(1), release: new Param(0),
  start(t) { if (t !== undefined) chk(t, 'start() เวลา'); started++; }, stop(t) { if (t !== undefined) chk(t, 'stop() เวลา'); stopped++; },
});
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
  createBuffer(c, l) { return { sampleRate: 44100, getChannelData: () => new Float32Array(l) }; }
}
class FileReaderStub { readAsArrayBuffer(f) { this.result = f._buf; if (this.onload) this.onload(); } }

const sandbox = {
  console, Math, Date, JSON, Object, Array, String, Number, Boolean, Error, RegExp,
  isFinite, parseInt, parseFloat, Infinity, NaN, TextDecoder,
  Float32Array, Uint8Array, ArrayBuffer, DataView, Map, Set,
  FileReader: FileReaderStub, Event: class { constructor(t) { this.type = t; } },
  document: doc,
  setTimeout: (fn, ms) => { timers.set(++tid, { fn, ms: ms || 0 }); return tid; },
  clearTimeout: id => timers.delete(id),
  requestAnimationFrame: () => 0, cancelAnimationFrame() { },
  localStorage: { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); } },
};
sandbox.window = sandbox;
sandbox.window.AudioContext = Ctx;

/* ---------- ทดสอบ ---------- */
const name = file.split(/[\\/]/).pop();
const ok = m => console.log('  ✓ ' + m);
const die = (m, e) => {
  console.log('  ✗ ' + name + ' — ' + m + (e ? ': ' + e.message : ''));
  if (e && e.stack) console.log(e.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
};
const el = id => cache['#' + id];

try { vm.createContext(sandbox); vm.runInContext(code, sandbox, { filename: name }); }
catch (e) { die('พังตอนโหลด', e); }
ok('โหลดผ่าน');

for (const id of ['play', 'pause', 'stop', 'loop', 'seek'])
  if (!el(id) || !el(id).disabled) die('ตอนยังไม่มีไฟล์ ปุ่ม ' + id + ' ต้องกดไม่ได้');
if (el('khlui').value !== '10') die('ค่าตั้งต้นขลุ่ยต้องเป็นเพียงออ (10) ได้ ' + el('khlui').value);
ok('ยังไม่มีไฟล์ — ปุ่มถูกปิด · ขลุ่ยตั้งต้นเป็นเพียงออ');

try { el('file').files = [{ name: 'test.mid', _buf: MIDI_BUF }]; el('file').fire('change'); }
catch (e) { die('พังตอนอ่านไฟล์ MIDI', e); }
if (!/^อ่านไฟล์สำเร็จ/.test(el('msg').textContent)) die('ข้อความหลังอ่านไฟล์ผิด: ' + el('msg').textContent);
if (!/3 ส่วน/.test(el('fileMeta').textContent)) die('format 0 ต้องแยกได้ 3 ส่วนตามช่อง ได้ ' + el('fileMeta').textContent);
if (!/100 BPM/.test(el('fileMeta').textContent)) die('ต้องอ่านความเร็ว 100 BPM ได้ ' + el('fileMeta').textContent);
ok('อ่าน format 0 แยกได้ 3 ส่วน (เบส ทำนอง กลอง) · 100 BPM');

const rows = made.filter(e => e.tag === 'tr');
if (rows.length !== 3) die('ตารางต้องมี 3 แถว ได้ ' + rows.length);
const melRow = rows.find(r => /ช่อง 4/.test(r.innerHTML));
if (!melRow || !/ทำนอง/.test(melRow.innerHTML)) die('ช่อง 4 ต้องถูกทายว่าเป็นทำนอง');
const melCb = melRow.children[0].children[0];
if (melCb.checked !== false) die('แทร็กทำนองต้องถูกปิดเสียงไว้');
if (rows.filter(r => r !== melRow).some(r => r.children[0].children[0].checked !== true)) die('แทร็กอื่นต้องเปิดอยู่');
if (!/กลอง/.test(rows.find(r => /ช่อง 10/.test(r.innerHTML)).innerHTML)) die('ช่อง 10 ต้องติดป้ายกลอง');
ok('ทายทำนองถูก (ช่อง 4) และปิดเสียงให้ · กลองติดป้าย');

if (el('key').value !== '7') die('ต้องเดาคีย์ G (7) ได้ ' + el('key').value);
if (!/\+3/.test(el('trNote').innerHTML) || !/B♭/.test(el('trNote').innerHTML)) die('G → เพียงออ B♭ ต้องเลื่อน +3: ' + el('trNote').innerHTML);
el('khlui').value = '0'; el('khlui').fire('change');
if (!/\+5/.test(el('trNote').innerHTML)) die('G → คีย์ซี ต้องเลื่อน +5: ' + el('trNote').innerHTML);
el('offset').value = '12'; el('offset').fire('input');
if (!/\+17/.test(el('trNote').innerHTML)) die('ปรับเพิ่ม +12 ต้องได้ +17 รวม: ' + el('trNote').innerHTML);
el('offset').value = '0'; el('offset').fire('input');
el('khlui').value = 'none'; el('khlui').fire('change');
if (!/ไม่เลื่อนคีย์/.test(el('trNote').innerHTML)) die('เลือกไม่เลื่อนคีย์แล้วต้องบอกว่าไม่เลื่อน');
el('khlui').value = '10'; el('khlui').fire('change');
ok('เดาคีย์ G · เลื่อนไปเพียงออ +3 · คีย์ซี +5 · ปรับเพิ่มเองบวกทบ · ไม่เลื่อนคีย์ทำงาน');

// ---- เล่นจนจบ ----
try { el('play').fire('click'); } catch (e) { die('พังตอนกดเล่น', e); }
if (!el('pause') || el('pause').disabled) die('ระหว่างเล่น ปุ่มพักต้องกดได้');
if (!el('play').disabled) die('ระหว่างเล่น ปุ่มเล่นต้องกดไม่ได้');
const before = started;
let rounds;
try { rounds = drain(20000); } catch (e) { die('พังระหว่างเล่น', e); }
if (!el('play') || el('play').disabled) die('เล่นจบแล้วปุ่มเล่นต้องกลับมากดได้');
if (started - before < 40) die('เล่นแล้วแต่สร้างเสียงน้อยผิดปกติ: ' + (started - before));
// ทำนอง 15 ตัว ถูกปิดไว้ — โน้ตที่เล่นจริงต้องน้อยกว่าที่ควรถ้าเปิดทุกแทร็ก
ok('เล่นจนจบ ' + rounds + ' รอบ สร้างโหนดเสียง ' + (started - before) + ' โหนด · ปุ่มกลับสถานะ');

// ---- ปรับความเร็วและพักกลางเพลง ----
el('countIn').checked = false;
el('play').fire('click');
try { for (let i = 0; i < 5; i++) drainOne(); el('tempo').value = '70'; el('tempo').fire('input'); for (let i = 0; i < 5; i++) drainOne(); el('pause').fire('click'); }
catch (e) { die('พังตอนปรับความเร็ว/พัก', e); }
if (!/เล่นต่อ/.test(el('playLbl').textContent)) die('พักแล้วป้ายปุ่มต้องเป็น เล่นต่อ');
if (el('tNow').textContent === '0:00' && el('seek').value === '0') die('พักกลางเพลงแล้วตำแหน่งไม่ควรอยู่ที่ 0');
el('stop').fire('click');
if (el('seek').value !== '0') die('หยุดแล้วต้องกลับไป 0');
ok('ปรับความเร็วกลางเพลง · พักแล้วเล่นต่อได้ · หยุดกลับต้นเพลง');

// ---- วนช่วง ----
el('loop').fire('click');
el('loopA').fire('click');
el('seek').value = '500'; el('seek').fire('input'); el('seek').fire('change');
el('loopB').fire('click');
if (!/วน 0:00 – 0:0[0-9]/.test(el('loopInfo').textContent)) die('ข้อมูลช่วงวนผิด: ' + el('loopInfo').textContent);
el('play').fire('click');
let loops = 0;
try { for (let i = 0; i < 400 && timers.size; i++) { drainOne(); } } catch (e) { die('พังตอนเล่นวน', e); }
if (el('play').disabled !== true) die('เล่นวนอยู่ต้องไม่หยุดเอง');
el('stop').fire('click');
ok('เล่นวนช่วงไม่หยุดเอง · หยุดได้');

// ---- ไฟล์เสีย ----
el('file').files = [{ name: 'bad.mid', _buf: Uint8Array.from(chars('NOPE')).buffer }];
el('file').fire('change');
if (!/เปิดไฟล์ไม่ได้/.test(el('msg').textContent)) die('ไฟล์เสียต้องแจ้งว่าเปิดไม่ได้');
if (!el('play').disabled) die('ไฟล์เสียแล้วปุ่มเล่นต้องถูกปิด');
ok('ไฟล์เสียแจ้งเตือนและปิดปุ่ม');

// ---- ชุด NCN: .mid + .lyr + .cur พร้อมกัน ----
const tis = str => Uint8Array.from([...str].map(c => { const k = c.charCodeAt(0); return k < 0x80 ? k : 0xA0 + (k - 0x0E00); }));
const LYR_BUF = tis(['ทดสอบ', 'ศิลปิน', 'Am', '', 'ลาลา ลา', 'ทดสอบ'].join('\r\n')).buffer;
// หนึ่งค่าต่อตัวอักษร รวมตัวขึ้นบรรทัด หน่วย 1/24 จังหวะ — บรรทัดแรก 7 ตัว + ขึ้นบรรทัด, บรรทัดสอง 5 + 1
const CUR_VALS = [24, 24, 48, 48, 72, 96, 96, 120, 144, 144, 168, 168, 192, 216];
const CUR_BUF = Uint8Array.from(CUR_VALS.flatMap(v => [v & 255, v >> 8])).buffer;
made.length = 0;
try {
  el('file').files = [{ name: 'song.CUR', _buf: CUR_BUF }, { name: 'song.LYR', _buf: LYR_BUF }, { name: 'song.MID', _buf: MIDI_BUF }];
  el('file').fire('change');
} catch (e) { die('พังตอนอ่านชุด NCN', e); }
if (el('lyrPanel').hidden) die('มี .lyr แล้วแผงเนื้อร้องต้องโผล่');
if (el('key').value !== '0') die('คีย์จาก .lyr = Am ต้องตั้งเป็น C เมเจอร์ (0) ได้ ' + el('key').value);
if (!/Am/.test(el('keyAuto').textContent)) die('ป้ายคีย์ต้องบอกว่ามาจากไฟล์ .lyr: ' + el('keyAuto').textContent);
if (!/จับเวลาได้ 12\/12/.test(el('lyrMeta').textContent)) die('ต้องจับเวลาได้ครบ 12 ตัวอักษร: ' + el('lyrMeta').textContent);
const lns = el('lyrBox').children;                     // สร้างใหม่ทุกครั้งที่ไฟล์ใดไฟล์หนึ่งมาถึง ดูเฉพาะชุดล่าสุด
if (lns.length !== 2) die('เนื้อร้องต้องมี 2 บรรทัด ได้ ' + lns.length);
ok('ชุด NCN — อ่าน TIS-620 · คีย์ Am → C เมเจอร์ · จับเวลาครบ · 2 บรรทัด');

lns[1].fire('click');                                  // บรรทัดสองเริ่มที่ 144/24 = 6 จังหวะ = 3.6 วิ ถอยให้ .5
if (el('tNow').textContent !== '0:03') die('คลิกบรรทัดสองต้องกระโดดไป 0:03 ได้ ' + el('tNow').textContent);
el('seek').value = '1000'; el('seek').fire('input'); el('seek').fire('change');
const onCh = made.filter(e => e.tag === 'span' && e.className === 'ch on').length;
if (onCh !== 12) die('เลื่อนไปท้ายเพลงแล้วตัวอักษรต้องติดสีทองครบ 12 ได้ ' + onCh);
el('seek').value = '0'; el('seek').fire('input'); el('seek').fire('change');
if (made.filter(e => e.tag === 'span' && e.className === 'ch on').length !== 0) die('กลับต้นเพลงแล้วสีทองต้องหาย');
lns[1].children[1].fire('click', { stopPropagation() { } });
if (!/วน 0:03 – 0:05/.test(el('loopInfo').textContent)) die('วนบรรทัดสองต้องได้ 0:03 – 0:05 (ตัวสุดท้าย 192/24 = 8 จังหวะ + 1 วิ): ' + el('loopInfo').textContent);
el('countIn').checked = false;
el('play').fire('click');
try { for (let i = 0; i < 300 && timers.size; i++) drainOne(); } catch (e) { die('พังตอนเล่นพร้อมเนื้อร้อง', e); }
if (!el('play').disabled) die('วนท่อนอยู่ต้องยังเล่นต่อ');
el('stop').fire('click');
ok('คลิกบรรทัดกระโดด · ไฮไลต์ตามตำแหน่ง · วนเฉพาะท่อน · เล่นพร้อมเนื้อร้องไม่พัง');

// .mid ใหม่โดยไม่มี .lyr ต้องล้างเนื้อร้องเก่า
el('file').files = [{ name: 'other.mid', _buf: MIDI_BUF }];
el('file').fire('change');
if (!el('lyrPanel').hidden) die('เปิด .mid ใหม่โดยไม่มี .lyr ต้องล้างเนื้อร้อง');
ok('เปิด .mid ใหม่แล้วเนื้อร้องเก่าถูกล้าง');

console.log('  ผ่านทั้งหมด — ' + name);

function drainOne() {
  const k = timers.keys().next().value;
  if (k === undefined) return;
  const t = timers.get(k); timers.delete(k);
  clock += t.ms / 1000;
  t.fn();
}
