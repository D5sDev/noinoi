# -*- coding: utf-8 -*-
import io
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(ROOT, 'thai.html')
dst = os.path.join(ROOT, 'khlui.html')
s = io.open(src, encoding='utf-8').read()

def rep(a, b, tag):
    global s
    assert s.count(a) == 1, tag + " -> " + str(s.count(a))
    s = s.replace(a, b)

def cut(a, b, tag):
    """ตัดตั้งแต่ a ถึงก่อน b"""
    global s
    i = s.find(a); j = s.find(b)
    assert i >= 0 and j > i, "cut " + tag
    s = s[:i] + s[j:]

# ═════ A. ชื่อและหัวเรื่อง ═════
rep(u"<title>NoiNoi — ระบบเล่นโน้ตดนตรีไทย</title>",
    u"<title>NoiNoi ขลุ่ย — ระบบเล่นโน้ตขลุ่ยไทย</title>", "title")
rep(u"      <h1>NoiNoi</h1>\n      <p>ระบบเล่นโน้ตดนตรีไทย · เสียงเท่า 7 เสียง</p>",
    u"      <h1>NoiNoi ขลุ่ย</h1>\n      <p>ขลุ่ยเพียงออ · ลูกสะบัด · เสียงควง</p>", "brand")

rep(u"""    <a href="thai.html" class="on">โน้ตไทย</a>
    <a href="khlui.html">ขลุ่ย</a>""",
u"""    <a href="thai.html">โน้ตไทย</a>
    <a href="khlui.html" class="on">ขลุ่ย</a>""", "nav")

# ═════ B. CSS เพิ่มเติมสำหรับลูกสะบัดและเสียงควง ═════
rep(u".slot.tie{color:#6b5c46;font-size:15px}",
u""".slot.tie{color:#6b5c46;font-size:15px}
.slot.grp{font-size:12.5px;letter-spacing:-.5px;color:var(--gold)}
.slot.on.grp{color:#1d1608}
.kh{font-style:normal;font-size:10px;color:var(--gold);vertical-align:super;margin-left:1px}
.slot.on .kh{color:#1d1608}""", "css")

# ═════ C. เอาช่องเลือกเครื่องดนตรีออก ═════
cut(u"""      <div class="field">
        <label>เครื่องดนตรี</label>""", u"""      <div class="row2">
        <div class="field">
          <label>ระบบเสียง</label>""", "instfield")

# ═════ D. parser: ลูกสะบัด ( ) และ เสียงควง * ═════
rep(u"""function tokenizeCell(str){
  const out=[];
  for(let i=0;i<str.length;i++){
    const ch=str[i];
    if(ch==='-'||ch==='–'||ch==='—'||ch==='.'){ out.push({type:'tie'}); continue; }
    if(ch==='0'||ch==='๐'||ch==='o'||ch==='O'){ out.push({type:'rest'}); continue; }
    let deg=NOTE.indexOf(ch);
    if(deg<0) deg=ASCII.indexOf(ch.toLowerCase());
    if(deg<0) continue;                     // ข้ามอักขระที่ไม่รู้จัก
    let oct=0;
    while(i+1<str.length){
      const n=str[i+1];
      if(n===UP||n==="'"||n==='^'){ oct++; i++; }
      else if(n===DOWN||n===','||n==='_'){ oct--; i++; }
      else break;
    }
    out.push({type:'note',deg,oct});
  }
  return out;
}""",
u"""function tokenizeCell(str){
  const out=[];
  for(let i=0;i<str.length;i++){
    const ch=str[i];
    if(ch==='('){                           // ลูกสะบัด — หลายเสียงซอยอยู่ในช่องเดียว
      const end=str.indexOf(')',i+1);
      const syms=tokenizeCell(end<0 ? str.slice(i+1) : str.slice(i+1,end));
      if(syms.length) out.push({type:'group',syms});
      i = end<0 ? str.length : end;
      continue;
    }
    if(ch===')') continue;
    if(ch==='-'||ch==='–'||ch==='—'||ch==='.'){ out.push({type:'tie'}); continue; }
    if(ch==='0'||ch==='๐'||ch==='o'||ch==='O'){ out.push({type:'rest'}); continue; }
    let deg=NOTE.indexOf(ch);
    if(deg<0) deg=ASCII.indexOf(ch.toLowerCase());
    if(deg<0) continue;                     // ข้ามอักขระที่ไม่รู้จัก
    let oct=0, kh=false;
    while(i+1<str.length){
      const n=str[i+1];
      if(n===UP||n==="'"||n==='^'){ oct++; i++; }
      else if(n===DOWN||n===','||n==='_'){ oct--; i++; }
      else if(n==='*'){ kh=true; i++; }     // เสียงควง — ความถี่เดิม สีเสียงต่าง
      else break;
    }
    out.push({type:'note',deg,oct,kh});
  }
  return out;
}""", "tokenize")

# ═════ E. notesOfStep — ช่องหนึ่งอาจมีหลายเสียง ═════
rep(u"""// สแนปช็อตทั้งเพลง — ใช้ตอนบันทึก .wav และคำนวณความยาว""",
u"""// เสียงที่ต้องเล่นในช่องนี้ — ช่องปกติได้ 1 เสียง, ลูกสะบัดได้หลายเสียงซอยเท่า ๆ กัน
function notesOfStep(o,i){
  const st=steps[i], d=slotDur(o,st), tail=noteDur(o,i)-d;   // tail = ช่องยืดเสียงที่ตามมา
  const out=[];
  if(st.sym.type==='note'){
    out.push({dt:0,dur:d+tail,deg:st.sym.deg,oct:st.sym.oct,kh:st.sym.kh});
  } else if(st.sym.type==='group'){
    const ns=st.sym.syms, sd=d/ns.length;
    let prev=null;
    ns.forEach((x,j)=>{
      if(x.type==='note'){ prev={dt:j*sd,dur:sd,deg:x.deg,oct:x.oct,kh:x.kh}; out.push(prev); }
      else if(x.type==='rest') prev=null;
      else if(prev) prev.dur += sd;
    });
    if(prev) prev.dur += tail;               // เสียงยืดหลังวงเล็บ ต่อให้ตัวสุดท้าย
  }
  return out;
}

// สแนปช็อตทั้งเพลง — ใช้ตอนบันทึก .wav และคำนวณความยาว""", "notesOfStep")

rep(u"    if(st.sym.type==='note') notes.push({t,dur:noteDur(o,i),deg:st.sym.deg,oct:st.sym.oct});",
    u"    for(const x of notesOfStep(o,i)) notes.push({t:t+x.dt,dur:x.dur,deg:x.deg,oct:x.oct,kh:x.kh});", "build")

rep(u"  for(const n of ev.notes) playTone(ctx,g.bus,freqOf(n.deg,n.oct,o),t0+n.t,n.dur,o.inst);",
    u"  for(const n of ev.notes)\n"
    u"    playTone(ctx,g.bus,freqOf(n.deg,n.oct,o),t0+n.t,n.dur, n.kh?'khlui_khuang':'khlui');", "schedAll")

rep(u"""    if(st.sym.type==='note')
      playTone(ac,graph.bus,freqOf(st.sym.deg,st.sym.oct,o),nextTime,noteDur(o,stepIdx),o.inst);""",
u"""    for(const x of notesOfStep(o,stepIdx))
      playTone(ac,graph.bus,freqOf(x.deg,x.oct,o),nextTime+x.dt,x.dur, x.kh?'khlui_khuang':'khlui');""", "sched")

# ═════ F. เสียง: เหลือขลุ่ยสองสีเสียง ═════
i = s.find(u"const INST = {"); j = s.find(u"/* ---- ตัวอย่างเสียง")
assert i > 0 and j > i, "INST region"
s = s[:i] + u"""const INST = {
  // ขลุ่ยเพียงออ — จับปกติ
  khlui       :{oct:1, wave:'triangle', attack:.055, release:.10,
                vib:4.6, vibDepth:.005, breath:.055, filter:6},
  // เสียงควง — ความถี่เดียวกัน แต่จับอีกแบบ เสียงทึบกว่า ลมน้อยกว่า ปลายเสียงนุ่มกว่า
  khlui_khuang:{oct:1, wave:'sine',     attack:.075, release:.13,
                vib:4.0, vibDepth:.004, breath:.016, filter:2.6},
};

""" + s[j:]

# ตัด playPerc ที่ไม่ได้ใช้แล้ว และให้ playTone เรียก playSus ตรง ๆ
cut(u"function playPerc(ctx,bus,freq,t0,dur,P){", u"function playSus(ctx,bus,freq,t0,dur,P){", "playPerc")
rep(u"""function playTone(ctx,bus,freq,t0,dur,key){
  const P = INST[key] || INST.ranat_ek;
  const f = freq*Math.pow(2,P.oct||0);
  (P.type==='perc' ? playPerc : playSus)(ctx,bus,f,t0,dur,P);
}""",
u"""function playTone(ctx,bus,freq,t0,dur,key){
  const P = INST[key] || INST.khlui;
  playSus(ctx,bus,freq*Math.pow(2,P.oct||0),t0,dur,P);
}""", "playTone")

# ═════ G. render: แสดงลูกสะบัดและเสียงควง ═════
rep(u"""        const b=document.createElement('div'); b.className='slot';
        if(sym.type==='note') b.textContent = glyph(sym.deg,sym.oct);
        else if(sym.type==='rest'){ b.classList.add('rest'); b.textContent='๐'; }
        else { b.classList.add('tie'); b.textContent='–'; }""",
u"""        const b=document.createElement('div'); b.className='slot';
        const one = x => glyph(x.deg,x.oct) + (x.kh ? '<i class="kh">*</i>' : '');
        if(sym.type==='note') b.innerHTML = one(sym);
        else if(sym.type==='group'){
          b.classList.add('grp');
          b.innerHTML = sym.syms.map(x => x.type==='note' ? one(x)
                                        : x.type==='rest' ? '๐' : '–').join('');
        }
        else if(sym.type==='rest'){ b.classList.add('rest'); b.textContent='๐'; }
        else { b.classList.add('tie'); b.textContent='–'; }""", "render")

# ═════ H. cellText รองรับวงเล็บและดอกจัน ═════
rep(u"""function cellText(syms){
  const g = s => s.type==='note' ? glyph(s.deg,s.oct) : (s.type==='rest' ? '0' : '-');
  let a = syms;
  if(syms.length===1 || syms.length===2){""",
u"""function cellText(syms){
  const g = s => s.type==='note'  ? glyph(s.deg,s.oct)+(s.kh?'*':'')
               : s.type==='rest'  ? '0'
               : s.type==='group' ? '('+s.syms.map(g).join('')+')'
               : '-';
  let a = syms;
  // ห้องที่มีลูกสะบัดห้ามขยาย เพราะจะเปลี่ยนการซอยเสียงในวงเล็บ
  if((syms.length===1 || syms.length===2) && !syms.some(x=>x.type==='group')){""", "cellText")

# ═════ I. แป้นโน้ต: ปุ่มสะบัด / ควง + วางเคอร์เซอร์ ═════
rep(u"""function insert(txt){
  const el=srcEl, s=el.selectionStart, e=el.selectionEnd;
  el.value = el.value.slice(0,s) + txt + el.value.slice(e);
  el.selectionStart = el.selectionEnd = s + txt.length;
  el.focus(); render();
}""",
u"""function insert(txt,back){
  const el=srcEl, s=el.selectionStart, e=el.selectionEnd;
  el.value = el.value.slice(0,s) + txt + el.value.slice(e);
  el.selectionStart = el.selectionEnd = s + txt.length - (back||0);
  el.focus(); render();
}""", "insert")

rep(u"""  [['–','-','ยืดเสียง'],['๐','0','หยุดเสียง'],['ห้องใหม่',' ',''],['บรรทัดใหม่','\\n','']].forEach(k=>{
    const b=document.createElement('button');
    b.className = k[0].length>1 ? 'key util' : 'key';
    b.textContent=k[0]; if(k[2]) b.title=k[2];
    b.onclick=()=>insert(k[1]);
    row.appendChild(b);
  });""",
u"""  [['–','-','ยืดเสียง',0],
   ['๐','0','หยุดเสียง',0],
   ['สะบัด ( )','()','ลูกสะบัด — พิมพ์โน้ตหลายตัวไว้ในวงเล็บ ซอยอยู่ในช่องเดียว',1],
   ['ควง *','*','เสียงควง — ความถี่เดิม แต่สีเสียงทึบกว่า',0],
   ['ห้องใหม่',' ','',0],
   ['บรรทัดใหม่','\\n','',0]].forEach(k=>{
    const b=document.createElement('button');
    b.className = k[0].length>1 ? 'key util' : 'key';
    b.textContent=k[0]; if(k[2]) b.title=k[2];
    b.onclick=()=>insert(k[1],k[3]);
    row.appendChild(b);
  });""", "keypad")

# ═════ J. readOpts / showKey ไม่มีช่องเลือกเครื่องแล้ว ═════
rep(u"    inst  : $('#inst').value,", u"    inst  : 'khlui',", "opts")
rep(u"    $('#keyNote').textContent = 'ด ของ'+$('#inst').selectedOptions[0].text+' ≈ '+noteName(f);",
    u"    $('#keyNote').textContent = 'ด ของขลุ่ยเพียงออ ≈ '+noteName(f);", "showkey")
rep(u"  $('#inst').addEventListener('change',showKey);\n", u"", "instbind")

# ═════ K. ตัวอย่างโน้ต ═════
i = s.find(u"const PRESETS = ["); j = s.find(u"/* ══════════ 5. UI ══════════ */")
assert i > 0 and j > i, "presets region"
s = s[:i] + u"""const PRESETS = [
  {id:'scale', name:'แบบฝึกหัด — ไล่เสียงขึ้นลง', chan:'2', tempo:52, text:
`ดรมฟ ซลทดํ รํมํฟํซํ ลํทํ-- ทํลํซํฟํ มํรํดํท ลซฟม รด--`},

  {id:'sabat', name:'ลูกสะบัด — 3 เสียงในช่องเดียว', chan:'2', tempo:52, text:
`-ด-- (ดรม)--- -ร-- (รมฟ)--- -ม-- (มฟซ)--- -ฟ-- (ฟซล)---
-ซ-- (ซลท)--- -ล-- (ลทดํ)--- -ท-- (ทดํรํ)--- ดํ--- ----`},

  {id:'khuang', name:'เสียงควง — สลับสีเสียง', chan:'2', tempo:48, text:
`ซ--- ซ*--- ซ--- ซ*--- ล--- ล*--- ล--- ล*---
ดํ--- ดํ*--- ท--- ท*--- ล--- ล*--- ซ--- ซ*---`},

  {id:'mix', name:'สะบัด + ควง', chan:'2', tempo:50, text:
`-ซ-ล (ซลท)--- -ท*-- ท--- -ล-ซ (ลซฟ)--- -ม*-- ม---`},

  {id:'blank', name:'— เริ่มใหม่ (ว่าง) —', chan:'2', tempo:56, text:
`---- ---- ---- ---- ---- ---- ---- ----`},
];

""" + s[j:]

# ═════ L. คำอธิบาย ═════
rep(u"""            <li><code>-</code> ยืดเสียงตัวก่อนหน้าออกไป</li>""",
u"""            <li><code>-</code> ยืดเสียงตัวก่อนหน้าออกไป</li>
            <li><code>(ดรม)</code> <b>ลูกสะบัด</b> — โน้ตในวงเล็บซอยเวลากันเองอยู่ใน <u>ช่องเดียว</u> ใส่กี่ตัวก็ได้ ห้ามเว้นวรรคในวงเล็บ</li>
            <li><code>ซ*</code> <b>เสียงควง</b> — ความถี่เดิม แต่จับอีกแบบ เสียงทึบกว่าและลมน้อยกว่า ใช้เก็บเสียงหรือเชื่อมเสียงให้นุ่ม</li>""", "help1")

rep(u"""            <li><b>ความถี่ที่แสดง</b> คือเสียง <code>ด</code> ที่ได้ยินจริง รวมช่วงเสียงของเครื่องแล้ว — ระนาดเอก ขลุ่ย ซอ สูงขึ้น 1 คู่แปด, ระนาดทุ้ม ต่ำลง 1 คู่แปด, ฆ้องวงใหญ่ และจะเข้ อยู่ระดับเดียวกับเสียงอ้างอิง</li>""",
u"""            <li><b>ความถี่ที่แสดง</b> คือเสียง <code>ด</code> ที่ได้ยินจริงของขลุ่ย ซึ่งสูงกว่าเสียงอ้างอิง 1 คู่แปด</li>""", "help2")

rep(u"""            <li>1 ห้องกินเวลาเท่ากันเสมอ ใส่ 2 หรือ 4 ตัวก็ได้ ระบบจะแบ่งเวลาให้เอง</li>""",
u"""            <li>1 ห้องกินเวลาเท่ากันเสมอ ใส่ 2 หรือ 4 ตัวก็ได้ ระบบจะแบ่งเวลาให้เอง</li>
            <li>ปุ่ม <b>จัดระเบียบโน้ต</b> จัดห้องใหม่ตามจำนวนที่ตั้ง และขยายห้องให้ครบ 4 ช่องเมื่อทำได้โดยเสียงไม่เปลี่ยน (ห้องที่มีลูกสะบัดจะไม่ถูกขยาย)</li>""", "help3")

io.open(dst, 'w', encoding='utf-8', newline='').write(s)
print("khlui.html ->", len(s), "chars")
