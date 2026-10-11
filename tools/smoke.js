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
    focus() {}, blur() {}, select() {}, remove() {}, click() {}, scrollIntoView() {},
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
  createElement: () => { created++; const e = mkEl('_'); doc._slots.push(e); doc._all.push(e); return e; },
  addEventListener(ev, fn) { (doc._ls[ev] || (doc._ls[ev] = [])).push(fn); },
  activeElement: null, body: mkEl('body'), _slots: [], _all: [], _ls: {},
  title: (html.match(/<title>([^<]*)</) || [])[1],
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
const winLs = {};
sandbox.window.addEventListener = (ev, fn) => { (winLs[ev] || (winLs[ev] = [])).push(fn); };
let printed = 0;
sandbox.window.print = () => { printed++; };
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
  cache['#title'].value = 'ลาวดวงเดือน';
  btn('save').onclick();
  const saveName = doc._all.filter(e => e.download).pop();
  if (!saveName || saveName.download !== 'ลาวดวงเดือน.json') die('ชื่อไฟล์เซฟควรเป็นชื่อเพลง: ' + (saveName && saveName.download));
  if (!lastBlob) die('กดเซฟแล้วไม่ได้ไฟล์');
  const json = lastBlob.parts.join('');
  const parsed = JSON.parse(json);
  if (parsed.app !== 'noinoi' || typeof parsed.notes !== 'string') die('ไฟล์ที่เซฟผิดรูปแบบ');
  if (parsed.title !== 'ลาวดวงเดือน') die('ไฟล์ที่เซฟไม่มีชื่อเพลง');
  const nKeys = Object.keys(parsed.settings).length;
  ok('เซฟ — variant ' + parsed.variant + ' · ตั้งค่า ' + nKeys + ' รายการ · โน้ต ' + parsed.notes.length + ' ตัวอักษร');

  cache['#src'].value = 'ดดดด';
  cache['#tempo'].value = '999';
  cache['#title'].value = 'เพลงอื่น';
  cache['#file'].fire('change', { target: { files: [{ _text: json }], value: 'x' } });
  if (cache['#title'].value !== 'ลาวดวงเดือน') die('เปิดไฟล์แล้วชื่อเพลงไม่กลับมา: ' + cache['#title'].value);
  const old = JSON.parse(json); delete old.title;            // ไฟล์รุ่นก่อนไม่มีชื่อเพลง
  cache['#file'].fire('change', { target: { files: [{ _text: JSON.stringify(old) }], value: 'x' } });
  if (cache['#title'].value !== '') die('เปิดไฟล์ที่ไม่มีชื่อเพลงแล้วชื่อเดิมค้างอยู่');
  if (cache['#src'].value !== notesBefore) die('เปิดไฟล์แล้วโน้ตไม่กลับมาเหมือนเดิม');
  if (cache['#tempo'].value !== tempoBefore) die('เปิดไฟล์แล้วความเร็วไม่กลับมาเหมือนเดิม');
  ok('เปิดไฟล์ — โน้ต ชื่อเพลง และการตั้งค่ากลับมาครบ · ไฟล์เก่าไม่มีชื่อก็ล้างชื่อ · ชื่อไฟล์เซฟตามชื่อเพลง');

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

  // PDF — ปุ่มเรียกหน้าพิมพ์ · beforeprint เติมหัวกระดาษ ตั้งชื่อไฟล์ แล้ว afterprint คืนชื่อหน้าเดิม
  if (btn('pdf')) {
    const title = doc.title;
    btn('pdf').onclick();
    if (printed !== 1) die('กด PDF แล้วไม่เรียก window.print()');
    const song = doc.querySelector('#title'), keep = song.value;
    song.value = '';
    (winLs.beforeprint || []).forEach(fn => fn());
    const head = doc.querySelector('#printMeta').textContent;
    if (!/ห้อง\/นาที/.test(head)) die('หัวกระดาษไม่มีความเร็ว: ' + head);
    if (/ทาง/.test(head)) die('หัวกระดาษไม่ควรบอกทาง/คีย์: ' + head);
    if (!/^noinoi-\d{8}-\d{4}$/.test(doc.title)) die('ไม่มีชื่อเพลง ชื่อไฟล์ PDF ควรเป็นวันเวลา: ' + doc.title);
    song.value = 'ลาว/ดวง:เดือน';
    (winLs.beforeprint || []).forEach(fn => fn());
    if (doc.querySelector('#printTitle').textContent !== 'ลาว/ดวง:เดือน') die('หัวกระดาษไม่ใช่ชื่อเพลง');
    if (doc.title !== 'ลาว ดวง เดือน') die('ชื่อไฟล์ PDF ควรเป็นชื่อเพลงที่ตัดอักขระต้องห้าม: ' + doc.title);
    (winLs.afterprint || []).forEach(fn => fn());
    if (!title || doc.title !== title) die('พิมพ์เสร็จแล้วชื่อหน้าไม่กลับ: ' + doc.title);
    song.value = keep;
    ok('PDF — เรียกหน้าพิมพ์ · หัวกระดาษเป็นชื่อเพลง + "' + head + '" · ชื่อไฟล์ตามชื่อเพลง ไม่มีก็ตามวันเวลา');
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

  // โน้ตตัวเลข 1–7 = ด–ท (เลขไทยก็ได้) — เล่นได้เหมือนตัวอักษร ขยับคีย์/จัดระเบียบแล้วเป็นอักษรไทย
  {
    const src = cache['#src'], meta = () => doc.querySelector('#meta').textContent;
    src.value = 'ดรมฟ ซลทดํ ดฺ-0-'; src.fire('input');
    const thai = meta();
    src.value = '1234 567๑\' 1,-0-'; src.fire('input');
    if (meta() !== thai) die('โน้ตตัวเลขนับไม่เท่าตัวอักษร: "' + thai + '" → "' + meta() + '"');
    if (btn('trUp')) {
      btn('trUp').onclick();
      if (src.value !== 'รมฟซ ลทดํรํ รฺ-0-') die('ขยับคีย์โน้ตตัวเลขไม่ถูก: ' + src.value);
    }
    src.value = '1234 567๑\' 1,-0-'; src.fire('input');
    doc.querySelector('#perLine').value = '8';
    btn('tidy').onclick();
    if (src.value !== 'ดรมฟ ซลทดํ ดฺ-0-') die('จัดระเบียบโน้ตตัวเลขไม่เป็นอักษรไทย: ' + src.value);
    ok('โน้ตตัวเลข — 1–7 เล่นได้ · ขยับคีย์/จัดระเบียบแล้วเป็นอักษรไทย');
  }

  // กลับต้น — ท่อนเล่นสองรอบ (ท่อนเริ่มที่ต้นเพลงหรือถัดจากกลับต้นอันก่อน) · ล ในคำไม่ใช่โน้ต
  {
    const src = cache['#src'];
    const voices = t => { src.value = t; src.fire('input'); return +(doc.querySelector('#meta').textContent.match(/(\d+) เสียง/) || [])[1]; };
    if (voices('ดรมฟ ซลทด') !== 8) die('นับเสียงพื้นฐานผิด');
    if (voices('ดรมฟ ซลทด กลับต้น') !== 16) die('กลับต้นท้ายเพลงควรเล่นทั้งเพลงสองรอบ');
    if (voices('ดรมฟ\nกลับต้น\nซลทด') !== 12) die('กลับต้นบรรทัดเดี่ยวควรเกาะห้องท้ายบรรทัดก่อน');
    if (voices('ดรมฟ กลับต้น\nซลทด (กลับต้น)') !== 16) die('สองท่อนควรซ้ำท่อนละรอบ');
    doc._slots.length = 0;
    voices('ดรมฟ กลับต้น ซลทด');
    if (!doc._slots.some(e => e.className === 'foot' && /กลับต้น/.test(e.innerHTML))) die('ห้องที่มีกลับต้นไม่มีป้าย');
    const two = 'ดรมฟ กลับต้น\nซลทด (กลับต้น)';
    src.value = two; src.fire('input');
    if (btn('trUp')) {
      btn('trUp').onclick();
      if (src.value !== 'รมฟซ กลับต้น\nลทดํร (กลับต้น)') die('ขยับคีย์แล้วคำกลับต้นเพี้ยน: ' + src.value);
      btn('trDown').onclick();
      if (src.value !== two) die('ขยับคีย์ขึ้นลงแล้วไม่ได้เดิม: ' + src.value);
    }
    doc.querySelector('#perLine').value = '8';
    btn('tidy').onclick();
    if (src.value !== 'ดรมฟ กลับต้น ซลทด กลับต้น') die('จัดระเบียบแล้วกลับต้นหาย: ' + src.value);
    ok('กลับต้น — ท่อนเล่นสองรอบ · บรรทัดเดี่ยว/สองท่อน · มีป้ายบนตาราง · ขยับคีย์และจัดระเบียบไม่ทำคำเพี้ยน');

    // หัวท่อน — บรรทัดขึ้นต้นด้วย ท่อน ไม่ใช่โน้ต กลับต้นย้อนมาแค่ต้นท่อน
    if (voices('ดรมฟ\nซลทด กลับต้น') !== 16) die('ไม่มีหัวท่อน กลับต้นควรย้อนถึงต้นเพลง');
    if (voices('ดรมฟ\nท่อน 2\nซลทด กลับต้น') !== 12) die('มีหัวท่อน กลับต้นควรซ้ำแค่ท่อนนั้น');
    if (voices('ดรมฟ\nท่อนสอง\nซลทด กลับต้น') !== 12) die('ท่อนสอง (ไม่เว้นวรรค) ควรเป็นหัวท่อน');
    if (voices('ท่อน 1\nดรมฟ') !== 4) die('หัวท่อนถูกนับเป็นโน้ต');
    doc._slots.length = 0;
    voices('ดรมฟ\nท่อน 2\nซลทด');
    const heads = doc._slots.filter(e => e.className === 'sect').map(e => e.textContent);
    if (heads.join() !== 'ท่อน 2') die('หัวท่อนไม่ขึ้นบนตาราง: ' + heads.join());
    src.value = 'ท่อน 1\nดรมฟ'; src.fire('input');
    if (btn('trUp')) {
      btn('trUp').onclick();
      if (src.value !== 'ท่อน 1\nรมฟซ') die('ขยับคีย์แล้วหัวท่อนเพี้ยน: ' + src.value);
    }
    src.value = 'ท่อน 1 // นำ\nดรมฟ ซลทด\nท่อนสอง\nทลซฟ กลับต้น'; src.fire('input');
    btn('tidy').onclick();
    if (src.value !== 'ท่อน 1 // นำ\nดรมฟ ซลทด\nท่อนสอง\nทลซฟ กลับต้น') die('จัดระเบียบแล้วหัวท่อนไม่อยู่ที่เดิม:\n' + src.value);
    ok('หัวท่อน — ท่อน 1 / ท่อนสอง ไม่ใช่โน้ต · กลับต้นซ้ำแค่ท่อน · ขึ้นบนตาราง · ขยับคีย์ไม่แตะ · จัดระเบียบแล้วขึ้นบรรทัดใหม่ที่หัวท่อน');
  }

  // เนื้อร้อง — บรรทัด " ไม่ถูกเล่น ไม่ถูกขยับคีย์ จัดระเบียบแล้วตามห้องของมันไป
  {
    const src = cache['#src'], meta = () => doc.querySelector('#meta').textContent;
    src.value = 'ดรมฟ ซลทดํ ดํทลซ\nฟมรด ด---'; src.fire('input');
    const plain = meta();
    doc._slots.length = 0;
    const withLyr = 'ดรมฟ ซลทดํ ดํทลซ\n" ลมพัด - ดอกไม้\nฟมรด ด---\n“ร่วง โรย”';
    src.value = withLyr; src.fire('input');
    if (meta() !== plain) die('เนื้อร้องถูกนับเป็นโน้ต: "' + plain + '" → "' + meta() + '"');
    const shown = doc._slots.filter(e => e.className === 'lyr').map(e => e.textContent).join('|');
    if (shown !== 'ลมพัด||ดอกไม้|ร่วง|โรย') die('เนื้อร้องไม่ตรงห้อง: ' + shown);
    ok('เนื้อร้อง — ไม่ถูกเล่น · แสดงใต้ห้องถูกตัว (' + shown + ')');

    if (btn('trUp')) {
      btn('trUp').onclick();
      if (!src.value.includes('" ลมพัด - ดอกไม้')) die('ขยับคีย์แล้วเนื้อร้องเพี้ยน: ' + src.value);
      btn('trDown').onclick();
      if (src.value !== withLyr) die('ขยับคีย์ขึ้นลงแล้วโน้ตที่มีเนื้อร้องไม่กลับมาเดิม');
    }
    doc.querySelector('#perLine').value = '2';
    btn('tidy').onclick();
    const want = 'ดรมฟ ซลทดํ\n" ลมพัด\nดํทลซ ฟมรด\n" ดอกไม้ ร่วง\nด---\n" โรย';
    if (src.value !== want) die('จัดระเบียบแล้วเนื้อร้องไม่ตามห้อง:\n' + src.value);
    btn('tidy').onclick();
    if (src.value !== want) die('จัดระเบียบซ้ำแล้วเนื้อร้องเลื่อน:\n' + src.value);
    ok('เนื้อร้อง — ขยับคีย์ไม่โดน · จัดระเบียบแล้วตามห้องไป');

    // | คั่นห้อง — คำในห้องเว้นวรรคแยกลงใต้โน้ตในห้องนั้น _ = โน้ตไม่มีคำ - = ห้องว่าง
    // ห้องที่ยืดเสียงทั้งห้องคำไปอยู่ช่องแรก คำเกินโน้ตไปต่อท้ายโน้ตตัวสุดท้ายของห้อง
    doc.querySelector('#perLine').value = '8';
    doc._slots.length = 0;
    src.value = 'ดรมฟ ซ-ลท ---- ดํ---\n" | ลม พัด เย็น ฉ่ำ | ใจ _ ละ || ไกล แสน |'; src.fire('input');
    const bars = doc._slots.filter(e => e.className === 'lyr syl')
      .map(e => e.children.map(s => s.textContent).join(',')).join('|');
    if (bars !== 'ลม,พัด,เย็น,ฉ่ำ|ใจ,,,ละ|,,,|ไกล แสน,,,') die('คำในห้องที่คั่นด้วย | ไม่ลงใต้โน้ต: ' + bars);
    ok('คั่นห้องด้วย | — คำลงใต้โน้ตในห้องถูกตัว · || = ห้องว่าง · คำเกินไปรวมที่โน้ตตัวสุดท้าย');
    doc.querySelector('#perLine').value = '2';
    btn('tidy').onclick();
    const wantBar = 'ดรมฟ ซ-ลท\n" ลม พัด เย็น ฉ่ำ | ใจ _ ละ\n---- ดํ---\n" - | ไกล แสน';
    if (src.value !== wantBar) die('จัดระเบียบแล้วเนื้อแบบ | ไม่ตามโน้ต:\n' + src.value);
    btn('tidy').onclick();
    if (src.value !== wantBar) die('จัดระเบียบซ้ำแล้วเนื้อแบบ | เลื่อน:\n' + src.value);
    ok('คั่นห้องด้วย | — จัดระเบียบแล้วเขียนกลับเป็นแบบ | ตามห้องไปถูก');

    // "" พยางค์ละโน้ต — ข้ามช่องยืดเสียงกับหยุดเสียง _ = โน้ตไม่มีคำ
    doc.querySelector('#perLine').value = '8';
    src.value = 'ดรมฟ ซ--- -ล-ท 0ดํ--'; src.fire('input');
    const plain2 = meta();
    doc._slots.length = 0;
    const withSyl = 'ดรมฟ ซ--- -ล-ท 0ดํ--\n"" ลม พัด _ ฉ่ำ ใจ ละ มุน ไม';
    src.value = withSyl; src.fire('input');
    if (meta() !== plain2) die('พยางค์ถูกนับเป็นโน้ต');
    const rows = doc._slots.filter(e => e.className === 'lyr syl')
      .map(e => e.children.map(s => s.textContent).join(',')).join('|');
    if (rows !== 'ลม,พัด,,ฉ่ำ|ใจ,,,|,ละ,,มุน|,ไม,,') die('พยางค์ไม่ตรงโน้ต: ' + rows);
    ok('เนื้อตามโน้ต — พยางค์ลงใต้โน้ตถูกช่อง ข้าม - กับ 0');

    if (btn('trUp')) {
      btn('trUp').onclick(); btn('trDown').onclick();
      if (src.value !== withSyl) die('ขยับคีย์ขึ้นลงแล้วบรรทัดพยางค์เปลี่ยน: ' + src.value);
    }
    doc.querySelector('#perLine').value = '2';
    btn('tidy').onclick();
    const want2 = 'ดรมฟ ซ---\n"" ลม พัด _ ฉ่ำ ใจ\n-ล-ท 0ดํ--\n"" ละ มุน ไม';
    if (src.value !== want2) die('จัดระเบียบแล้วพยางค์ไม่ตามโน้ต:\n' + src.value);
    btn('tidy').onclick();
    if (src.value !== want2) die('จัดระเบียบซ้ำแล้วพยางค์เลื่อน:\n' + src.value);
    doc.querySelector('#perLine').value = '8';
    ok('เนื้อตามโน้ต — ขยับคีย์ไม่โดน · จัดระเบียบแล้วพยางค์ตามโน้ตไป');
  }

  // ---- แก้ในตาราง — พิมพ์โน้ตทับช่อง ต่อท้ายเพลง ย้อน แล้วพิมพ์เนื้อใต้โน้ต ----
  if (btn('editGrid')) {
    const src = cache['#src'];
    const kd = (key, o = {}) => (doc._ls.keydown || []).forEach(fn => fn(Object.assign(
      { key, code: '', target: { tagName: 'BODY' }, preventDefault() {}, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false }, o)));
    const fresh = fn => { doc._slots.length = 0; fn(); };
    const slots = () => doc._slots.filter(e => e.className === 'slot' && e.textContent !== '+');
    const ghost = () => doc._slots.find(e => e.className === 'slot' && e.textContent === '+');
    const lyrIn = doc._all.find(e => e.className === 'lyrin');
    if (!lyrIn) die('ไม่มีช่องพิมพ์เนื้อร้องในตาราง');

    fresh(() => { src.value = 'ดรมฟ ----'; src.fire('input'); btn('editGrid').onclick(); });
    if (!ghost()) die('เปิดแก้ในตารางแล้วไม่มีช่อง + ท้ายเพลง');
    slots()[1].onclick();
    kd('ซ'); kd('ํ'); kd('-'); kd('จ', { code: 'Digit0' });        // แป้นไทย: ปุ่ม 0 ให้ จ
    if (src.value !== 'ดซํ-0 ----') die('พิมพ์ทับในตารางไม่ตรง: ' + JSON.stringify(src.value));
    kd(' ');                                                         // เพิ่งพิมพ์ครบห้อง เว้นวรรคไม่ข้ามห้อง
    fresh(() => kd('ร'));
    if (src.value !== 'ดซํ-0 ร---') die('เว้นวรรคหลังพิมพ์ครบห้องไม่ควรข้ามห้อง: ' + JSON.stringify(src.value));
    ok('แก้ในตาราง — พิมพ์ทับแล้วเลื่อนเอง · ํ ใช้กับตัวที่เพิ่งพิมพ์ · ปุ่ม 0 บนแป้นไทยเป็นหยุดเสียง');

    // ปุ่มเลขบนแป้นไทยให้ ๅ / - … ดูจากตำแหน่งปุ่ม · Shift ค้างไม่นับเป็นเลข
    const keep = src.value;
    slots()[4].onclick();
    kd('5'); kd('-', { code: 'Digit3' }); kd('ๅ', { code: 'Digit1' }); kd('%', { code: 'Digit5', shiftKey: true });
    if (src.value !== 'ดซํ-0 ซมด-') die('พิมพ์เลขในตารางไม่ตรง: ' + JSON.stringify(src.value));
    fresh(() => { src.value = keep; src.fire('input'); });
    ok('แก้ในตาราง — พิมพ์เลข 1–7 เป็นโน้ต · ปุ่มเลขบนแป้นไทยดูจากตำแหน่งปุ่ม');

    ghost().onclick();
    fresh(() => kd('ล'));
    if (src.value !== 'ดซํ-0 ร--- ล---') die('พิมพ์ที่ช่อง + แล้วไม่ต่อห้องใหม่: ' + JSON.stringify(src.value));
    kd('Backspace');                                                  // ย้อนกลับไปล้างตัวที่เพิ่งพิมพ์
    if (src.value !== 'ดซํ-0 ร--- ----') die('Backspace ควรล้างช่องก่อนหน้าเป็น -: ' + JSON.stringify(src.value));
    kd('z', { ctrlKey: true }); kd('z', { ctrlKey: true });
    if (src.value !== 'ดซํ-0 ร---') die('Ctrl+Z ย้อนไม่ถูก: ' + JSON.stringify(src.value));
    const keyBtn = doc._all.find(e => e.className === 'key' && e.textContent === 'ม');
    slots()[0].onclick(); keyBtn.onclick();
    if (src.value !== 'มซํ-0 ร---') die('ปุ่มบนแป้นตอนแก้ในตารางควรเขียนลงช่องที่เลือก: ' + JSON.stringify(src.value));
    ok('แก้ในตาราง — ช่อง + ต่อห้องใหม่ · Backspace ล้างช่อง · Ctrl+Z ย้อน · ปุ่มบนแป้นเขียนลงตาราง');

    // ↺ กลับต้น บนแป้น — ใส่ท้ายห้องของช่องที่เลือก กดซ้ำเอาออก · ห้องสุดท้ายมีกลับต้นแล้ว ช่อง + ขึ้นบรรทัดใหม่หลังคำ
    const backBtn = doc._all.find(e => /^↺/.test(e.innerHTML || ''));
    if (!backBtn) die('แป้นไม่มีปุ่ม ↺ กลับต้น');
    const keep2 = src.value;
    slots()[1].onclick(); fresh(() => backBtn.onclick());
    if (src.value !== 'มซํ-0 กลับต้น ร---') die('ใส่กลับต้นในตารางไม่ตรง: ' + JSON.stringify(src.value));
    slots()[1].onclick(); fresh(() => backBtn.onclick());
    if (src.value !== keep2) die('กดกลับต้นซ้ำควรเอาออก: ' + JSON.stringify(src.value));
    slots()[4].onclick(); fresh(() => backBtn.onclick());
    ghost().onclick(); fresh(() => kd('ล'));
    if (src.value !== 'มซํ-0 ร--- กลับต้น\nล---') die('ต่อห้องหลังกลับต้นไม่ขึ้นบรรทัดใหม่: ' + JSON.stringify(src.value));
    fresh(() => { src.value = keep2; src.fire('input'); });
    ok('แก้ในตาราง — ปุ่ม ↺ ใส่/เอาออกกลับต้นท้ายห้อง · ต่อห้องหลังกลับต้นขึ้นบรรทัดใหม่');

    // § ท่อน บนแป้น — ใส่หัวท่อนเหนือบรรทัดของช่องที่เลือก (ต้นเพลงไม่มีหัวนับเป็นท่อน 1) กดซ้ำเอาออก
    const sectBtn = doc._all.find(e => /^§/.test(e.innerHTML || ''));
    if (!sectBtn) die('แป้นไม่มีปุ่ม § ท่อน');
    fresh(() => { src.value = 'ดรมฟ\nซลทด'; src.fire('input'); });
    slots()[6].onclick(); fresh(() => sectBtn.onclick());
    if (src.value !== 'ดรมฟ\nท่อน 2\nซลทด') die('ใส่หัวท่อนในตารางไม่ตรง: ' + JSON.stringify(src.value));
    slots()[6].onclick(); fresh(() => sectBtn.onclick());
    if (src.value !== 'ดรมฟ\nซลทด') die('กดหัวท่อนซ้ำควรเอาออก: ' + JSON.stringify(src.value));
    fresh(() => { src.value = keep2; src.fire('input'); });
    ok('แก้ในตาราง — ปุ่ม § ใส่/เอาออกหัวท่อน ตั้งชื่อตามลำดับ');

    // เนื้อร้อง: บรรทัดที่ยังไม่มีเนื้อมีแถวว่างให้แตะ พิมพ์แล้วเว้นวรรคไปโน้ตถัดไป
    fresh(() => { src.value = 'ดรมฟ ซ---'; src.fire('input'); });
    const ph = doc._slots.find(e => e.className === 'lyr syl ph');
    if (!ph) die('บรรทัดที่ยังไม่มีเนื้อควรมีแถวว่างให้แตะ');
    ph.children[0].onclick();
    lyrIn.value = 'ลม พัด '; lyrIn.fire('input');
    lyrIn.value = 'เย็น'; lyrIn.fire('keydown', { key: 'Enter', preventDefault() {} });
    lyrIn.fire('keydown', { key: 'Enter', preventDefault() {} });     // โน้ตตัวที่ 4 ไม่มีคำ
    lyrIn.value = 'ฉ่ำ'; lyrIn.fire('keydown', { key: 'Escape', preventDefault() {} });
    if (src.value !== 'ดรมฟ ซ---\n" ลม พัด เย็น | ฉ่ำ')
      die('พิมพ์เนื้อในตารางไม่ตรง: ' + JSON.stringify(src.value));
    ok('เนื้อในตาราง — แตะแถวว่าง พิมพ์ทีละคำ เว้นวรรค/Enter ไปโน้ตถัดไป ได้บรรทัด " … | …');

    fresh(() => { src.value = 'ดรมฟ\n"" ก ข ค ง\nซลทดํ\n" จ ฉ |   // ท่อนหนึ่ง'; src.fire('input'); });
    doc._slots.find(e => e.className === 'lyr syl').children[1].onclick();
    lyrIn.value = 'ขอ'; lyrIn.fire('keydown', { key: 'Escape', preventDefault() {} });
    fresh(() => {});
    src.fire('input');
    const bars = doc._slots.filter(e => e.className === 'lyr syl');
    bars[1].children[0].onclick();
    lyrIn.value = 'จา'; lyrIn.fire('keydown', { key: 'Escape', preventDefault() {} });
    if (src.value !== 'ดรมฟ\n"" ก ขอ ค ง\nซลทดํ\n" จา ฉ |   // ท่อนหนึ่ง')
      die('แก้คำในแถวที่มีอยู่แล้วไม่ตรง หรือคำอธิบายหาย: ' + JSON.stringify(src.value));
    ok('เนื้อในตาราง — แก้แถว "" กับแถว | ที่มีอยู่ได้ตามแบบเดิม คำอธิบายท้ายบรรทัดอยู่ครบ');

    btn('editGrid').onclick();
    const before = src.value;
    kd('ร');
    if (src.value !== before) die('ปิดแก้ในตารางแล้วพิมพ์ยังลงตาราง');
    ok('ปิดแก้ในตาราง — แป้นพิมพ์กลับไปเป็นปกติ');
    fresh(() => { src.value = 'ดรมฟ ซลทดํ ดํทลซ ฟมรด'; src.fire('input'); });
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
