// รันสคริปต์ในไฟล์จริง บน DOM + Web Audio จำลอง แล้วกดปุ่มจริง
// จับ ReferenceError / TypeError ที่ node --check มองไม่เห็น
const fs = require('fs'), vm = require('vm');
const file = process.argv[2];
const html = fs.readFileSync(file, 'utf8');
const code = html.split('<script>')[1].split('</script>')[0];

// ---- ค่าเริ่มต้นของ control อ่านจาก HTML จริง ----
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
  defs[id] = { type: 'select-one', value: o[1], selectedOptions: [{ text: o[2] }] };
}

// ---- DOM จำลอง ----
let created = 0;
function mkEl(id) {
  const d = defs[id] || {};
  const e = {
    id, type: d.type || '', value: d.value ?? '', checked: d.checked ?? false,
    selectedOptions: d.selectedOptions || [{ text: '' }],
    textContent: '', innerHTML: '', className: '', title: '', disabled: false,
    href: '', download: '', files: [],
    style: {}, selectionStart: 0, selectionEnd: 0, children: [], options: [], _ls: {},
    classList: { add() {}, remove() {}, contains: () => false },
    appendChild(c) { this.children.push(c); this.options.push(c); },
    addEventListener(ev, fn) { (this._ls[ev] || (this._ls[ev] = [])).push(fn); },
    fire(ev, arg) { (this._ls[ev] || []).forEach(fn => fn(arg)); },
    focus() {}, remove() {}, click() {}, scrollIntoView() {},
    closest() { return e; },
    getBoundingClientRect: () => ({ top: 120, bottom: 200, left: 0, right: 100 }),
    querySelector() { return mkEl('_'); },
  };
  return e;
}
const cache = {};
// id ที่มีอยู่จริงใน HTML — id อื่นต้องคืน null เหมือนเบราว์เซอร์
const realIds = new Set([...html.matchAll(/id="([\w-]+)"/g)].map(m => m[1]));
const doc = {
  querySelector(sel) {
    const id = sel.replace('#', '');
    if (!realIds.has(id)) return null;
    return cache[sel] || (cache[sel] = mkEl(id));
  },
  createElement: () => { created++; const e = mkEl('_'); doc._slots.push(e); return e; },
  addEventListener() {}, activeElement: null, body: mkEl('body'), _slots: [],
};

// ---- Web Audio จำลอง ----
let startedNodes = 0;
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
const chk = (v, what) => { if (typeof v !== 'number' || !isFinite(v)) throw new Error(what + ' ไม่ใช่ตัวเลข: ' + v); };
const mkNode = () => ({
  connect() {}, disconnect() {}, type: '', buffer: null,
  gain: new Param(1), frequency: new Param(440), Q: new Param(1),
  threshold: new Param(0), ratio: new Param(1), release: new Param(0),
  playbackRate: new Param(1), detune: new Param(0),
  loop: false, loopStart: 0, loopEnd: 0,
  start(t) { if (t !== undefined) chk(t, 'start() เวลา'); startedNodes++; }, stop() {},
});
class Ctx {
  constructor() { this.currentTime = 1; this.sampleRate = 44100; this.state = 'running'; this.destination = mkNode(); }
  resume() {}
  createGain() { return mkNode(); } createOscillator() { return mkNode(); }
  createBufferSource() { return mkNode(); } createBiquadFilter() { return mkNode(); }
  createConvolver() { return mkNode(); } createDynamicsCompressor() { return mkNode(); }
  createBuffer(c, l, r) { return { numberOfChannels: c, length: l, sampleRate: r, duration: l / r, getChannelData: () => new Float32Array(l) }; }
  decodeAudioData(b) {
    if (!b || !b.byteLength) return Promise.reject(new Error('decodeAudioData ได้ข้อมูลว่าง'));
    return Promise.resolve(this.createBuffer(2, 44100, 44100));
  }
}

let lastBlob = null;
class BlobStub { constructor(parts, opt) { this.parts = parts; this.opt = opt; lastBlob = this; } }
class FileReaderStub { readAsText(f) { this.result = f._text; if (this.onload) this.onload(); } }

const sandbox = {
  console, Math, Date, JSON, Promise, Object, Array, String, Number, Boolean, Error, isFinite, parseInt, parseFloat,
  Float32Array, Uint8Array, ArrayBuffer, DataView, WeakMap, Map, Set,
  Blob: BlobStub, FileReader: FileReaderStub,
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  document: doc, performance: { now: () => Date.now() },
  requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  setInterval: () => 1, clearInterval() {},
  setTimeout: fn => { fn(); return 1; }, clearTimeout() {},   // ให้ debounce ทำงานทันที
  localStorage: {
    _m: new Map(),
    getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
    setItem(k, v) { this._m.set(k, String(v)); },
    removeItem(k) { this._m.delete(k); },
  },
  atob: b => Buffer.from(b, 'base64').toString('binary'),
  alert: m => { throw new Error('เรียก alert: ' + m); },
  OfflineAudioContext: Ctx,
};
sandbox.window = sandbox;
sandbox.window.AudioContext = Ctx;
sandbox.window.innerHeight = 900;
sandbox.window.scrollY = 0;
sandbox.window.addEventListener = () => {};
sandbox.window.scrollTo = () => {};

const name = file.split(/[\\/]/).pop();
const ok = m => console.log('  ✓ ' + m);
const die = (m, e) => {
  console.log('  ✗ ' + name + ' — ' + m + (e ? ': ' + e.message : ''));
  if (e && e.stack) console.log(e.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
};

try {
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: name });
} catch (e) { die('พังตอนโหลด', e); }
ok('โหลดผ่าน · สร้าง DOM ' + created + ' โหนด');

const btn = id => cache['#' + id];
if (!btn('play') || typeof btn('play').onclick !== 'function') die('ไม่พบ handler ปุ่มเล่น');

Promise.resolve(btn('play').onclick()).then(() => {
  if (startedNodes === 0) die('กดเล่นแล้วไม่มีเสียงถูกตั้งคิวเลย');
  ok('กดเล่น — ตั้งคิวเสียง ' + startedNodes + ' โหนด');

  btn('tidy').onclick();
  ok('จัดระเบียบโน้ต — ไม่ error');

  // เซฟแล้วโหลดกลับ ต้องได้ค่าเดิม
  const notesBefore = cache['#src'].value;
  const tempoBefore = cache['#tempo'].value;
  btn('save').onclick();
  if (!lastBlob) die('กดเซฟแล้วไม่ได้ไฟล์');
  const json = lastBlob.parts.join('');
  const parsed = JSON.parse(json);
  if (parsed.app !== 'noinoi' || typeof parsed.notes !== 'string') die('ไฟล์ที่เซฟผิดรูปแบบ');
  const nKeys = Object.keys(parsed.settings).length;
  ok('เซฟ — variant ' + parsed.variant + ' · ตั้งค่า ' + nKeys + ' รายการ · โน้ต ' + parsed.notes.length + ' ตัวอักษร');

  cache['#src'].value = 'ดดดด';
  cache['#tempo'].value = '999';
  cache['#file'].fire('change', { target: { files: [{ _text: json }], value: 'x' } });
  if (cache['#src'].value !== notesBefore) die('เปิดไฟล์แล้วโน้ตไม่กลับมาเหมือนเดิม');
  if (cache['#tempo'].value !== tempoBefore) die('เปิดไฟล์แล้วความเร็วไม่กลับมาเหมือนเดิม');
  ok('เปิดไฟล์ — โน้ตและการตั้งค่ากลับมาครบ');

  // จำอัตโนมัติลง localStorage
  const lsKey = 'noinoi:' + parsed.variant;
  cache['#src'].value = 'ซซซซ';
  cache['#src'].fire('input');
  const stored = sandbox.localStorage.getItem(lsKey);
  if (!stored) die('แก้โน้ตแล้วไม่ถูกจำลง localStorage (key ' + lsKey + ')');
  if (JSON.parse(stored).notes !== 'ซซซซ') die('localStorage จำโน้ตไม่ตรง');
  if (cache['#lsNote'].textContent === '') die('ไม่ได้บอกสถานะการจำอัตโนมัติ');
  ok('จำอัตโนมัติ — key ' + lsKey + ' · "' + cache['#lsNote'].textContent + '"');

  // เปลี่ยนไปคีย์สากล — เสียงอ้างอิงต้องสลับตาม
  if (cache['#key']) {
    const before = cache['#base'].value;
    cache['#key'].value = 'w0';
    cache['#key'].fire('change');
    const after = cache['#base'].value;
    if (String(before) === String(after)) die('เปลี่ยนไปคีย์สากลแล้วเสียงอ้างอิงไม่สลับตาม');
    ok('คีย์สากล → เสียงอ้างอิง ' + before + ' → ' + after + ' Hz');
  }

  // ขยับคีย์ของโน้ต — ขึ้นแล้วลงต้องได้ข้อความเดิม
  if (btn('trUp') && btn('trDown')) {
    cache['#src'].value = notesBefore;
    cache['#src'].fire('input');
    btn('trUp').onclick();
    const up = cache['#src'].value;
    if (up === notesBefore) die('กด ▲ แล้วโน้ตไม่เปลี่ยน');
    btn('trDown').onclick();
    if (cache['#src'].value !== notesBefore) die('ขยับขึ้นแล้วลงไม่ได้โน้ตเดิมคืน');
    ok('ขยับคีย์โน้ต ▲▼ — ขึ้นแล้วลงได้เดิมคืนครบ');
  }

  // จุดเริ่มเล่น + พัก/เล่นต่อ
  const slot = doc._slots && doc._slots.find(e => typeof e.onclick === 'function');
  if (slot) {
    slot.onclick();
    ok('ตั้งจุดเริ่มเล่นจากการคลิกช่องโน้ต — ไม่ error');
  }
  Promise.resolve(btn('play').onclick()).then(() => {
    btn('pause').onclick();
    const lbl = () => (btn('playLbl') || btn('play')).textContent;
    if (lbl().indexOf('ต่อ') < 0) die('กดพักแล้วปุ่มไม่เปลี่ยนเป็นเล่นต่อ');
    if (btn('pause').disabled !== true) die('กดพักแล้วปุ่มพักยังกดได้อยู่');
    ok('พัก — ปุ่มเป็น "▶' + lbl() + '"');
    return Promise.resolve(btn('play').onclick());
  }).then(() => {
    if (btn('pause').disabled !== false) die('เล่นต่อแล้วปุ่มพักยังกดไม่ได้');
    ok('เล่นต่อ — ตั้งคิวเสียงรวม ' + startedNodes + ' โหนด');
    btn('stop').onclick();
    if (btn('stop').disabled !== true) die('กดหยุดแล้วปุ่มหยุดยังกดได้');
    ok('หยุด — ไม่ error');
  }).catch(e => die('พังตอนทดสอบพัก/เล่นต่อ', e));
  return;
  /* eslint-disable no-unreachable */
  btn('stop').onclick();
  ok('หยุด — ไม่ error');
}).catch(e => die('พังระหว่างทดสอบ', e));
