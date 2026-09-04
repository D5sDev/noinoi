# -*- coding: utf-8 -*-
"""ฝังตัวอย่างเสียงขลุ่ยสองชุดลง khlui.html
   ชุดไหนถูกใช้ ขึ้นกับชนิดคีย์: ทางไทย -> เพียงออ, คีย์สากล -> คีย์ซี"""
import io, json, base64, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = os.path.join(ROOT, 'khlui.html')
os.chdir(os.path.join(ROOT, 'samples'))     # meta และไฟล์เสียงอยู่ที่นี่
s = io.open(p, encoding='utf-8').read()

SETS = [
    ('phiangor', 'ขลุ่ยเพียงออ', 'phiangor_meta.json'),
    ('ckey',     'ขลุ่ยคีย์ซี',  'ckey_meta.json'),
]

def rep(a, b, tag):
    global s
    assert s.count(a) == 1, tag + " -> " + str(s.count(a))
    s = s.replace(a, b)

# ---------- 1. ชุดตัวอย่างเสียง + ตัวเลือก/ตัวเล่น ----------
blocks, info = [], []
for sid, label, mf in SETS:
    meta = json.load(open(mf))
    lo, hi = meta[0]['f0'], meta[-1]['f0']
    ref = round(lo/2, 1)                       # ขลุ่ยดังสูงกว่าเสียงอ้างอิง 1 คู่แปด
    rows = []
    for m in meta:
        b64 = base64.b64encode(open(m['file'],'rb').read()).decode()
        rows.append("    {f0:%.2f, loopStart:%.6f, wav:'%s'}," % (m['f0'], m['loopStart'], b64))
    blocks.append("  %s: {name:'%s', ref:%.1f, samples:[\n%s\n  ]}," % (sid, label, ref, "\n".join(rows)))
    info.append((sid, label, len(meta), round(lo), round(hi), ref))

block = u"""/* ---- ตัวอย่างเสียงขลุ่ยจริง 22.05 kHz
        แต่ละไฟล์ = หัวเสียง + หนึ่งรอบ loop ที่ crossfade ปลายให้ต่อกับ loopStart ไว้แล้ว
        loopEnd = ท้ายไฟล์ จึงไม่ต้องเก็บ
        ทุกไฟล์ปรับความดังของตัวเสียง (RMS ช่วง loop) ให้เท่ากัน
        ref = เสียงอ้างอิงที่ทำให้ ด ตกตรงเสียงต่ำสุดของขลุ่ยตัวนั้นพอดี ---- */
const KHLUI_SETS = {
%s
};

// เลือกตัวอย่างที่ต้องยืด/หดน้อยที่สุด โดยคิดโทษการข้ามคู่แปดเพิ่มอีกหน่อย
function pickSample(list,freq){
  let best=null;
  for(const smp of list) for(let oc=-2;oc<=2;oc++){
    const cents = Math.abs(1200*Math.log2(freq/(smp.f0*Math.pow(2,oc))));
    const score = cents + Math.abs(oc)*80;
    if(!best || score<best.score) best={smp,oc,score,rate:freq/smp.f0};
  }
  return best;
}

function playSample(ctx,bus,freq,t0,dur,kh,list){
  const p = pickSample(list,freq);
  const buf = p.smp.buf, rel = .10, shift = Math.abs(p.oc);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = p.rate;
  // ตัวอย่างสั้นกว่าที่ต้องเล่น ก็วน loop เอา
  if((dur+rel)*p.rate > buf.duration){
    src.loop = true; src.loopStart = p.smp.loopStart; src.loopEnd = buf.duration;
  }
  const g = ctx.createGain();
  // ยืดข้ามคู่แปดทำให้เสียงสว่างและดังโผล่ออกมาจากตัวอื่น ลดระดับและกรองความสูงลงชดเชย
  const lvl = (kh ? .78 : .92)*Math.pow(.80, shift);
  const hold = Math.max(.008, dur - rel*.4);
  g.gain.setValueAtTime(.0001,t0);
  g.gain.linearRampToValueAtTime(lvl, t0+.008);      // กันเสียงกึกตอนเริ่ม
  g.gain.setValueAtTime(lvl, t0+hold);
  g.gain.exponentialRampToValueAtTime(.0008, t0+dur+rel);
  g.gain.linearRampToValueAtTime(0, t0+dur+rel+.02);
  let node = src;
  if(shift){
    const lp=ctx.createBiquadFilter(); lp.type='lowpass';
    lp.frequency.value=Math.min(freq*3.2, 11000); lp.Q.value=.5;
    node.connect(lp); node=lp;
  }
  if(kh){                     // เสียงควง — ยังไม่มีไฟล์อัดแยก ใช้กรองให้ทึบลงแทนไปก่อน
    const f=ctx.createBiquadFilter(); f.type='lowpass';
    f.frequency.value=Math.min(freq*2.6, 9000); f.Q.value=.6;
    node.connect(f); node=f;
  }
  node.connect(g); g.connect(bus);
  src.start(t0); src.stop(t0+dur+rel+.06);
}

""" % ("\n".join(blocks))
rep(u"/* ---- ตัวอย่างเสียงฉิ่ง–ฉับ (ฝังไว้ในไฟล์) ---- */",
    block + u"/* ---- ตัวอย่างเสียงฉิ่ง–ฉับ (ฝังไว้ในไฟล์) ---- */", "block")

# ---------- 2. โหลดตัวอย่างเสียงเฉพาะชุดที่ใช้ ----------
rep(u"""  s={};
  for(const k of ['ching','chap']){
    try{ s[k]=await ctx.decodeAudioData(b64ToBuf(CHING_MP3[k])); }
    catch(e){ s[k]=null; console.warn('ถอดรหัสเสียง '+k+' ไม่สำเร็จ ใช้เสียงสังเคราะห์แทน',e); }
  }
  sampleCache.set(ctx,s);
  return s;
}""",
u"""  if(!s){
    s={sets:{}};
    for(const k of ['ching','chap']){
      try{ s[k]=await ctx.decodeAudioData(b64ToBuf(CHING_MP3[k])); }
      catch(e){ s[k]=null; console.warn('ถอดรหัสเสียง '+k+' ไม่สำเร็จ ใช้เสียงสังเคราะห์แทน',e); }
    }
    sampleCache.set(ctx,s);
  }
  if(setId && !s.sets[setId]){          // ถอดรหัสเฉพาะชุดที่กำลังใช้ ไม่ต้องรอทั้งสองชุด
    const list=[];
    for(const smp of ((KHLUI_SETS[setId]||{}).samples||[])){
      try{ list.push({f0:smp.f0, loopStart:smp.loopStart,
                      buf: await ctx.decodeAudioData(b64ToBuf(smp.wav))}); }
      catch(e){ console.warn('ถอดรหัสตัวอย่างเสียงขลุ่ยไม่สำเร็จ ใช้เสียงสังเคราะห์แทน',e); }
    }
    s.sets[setId]=list;
  }
  return s;
}""", "decode")
rep(u"async function ensureSamples(ctx){\n  let s=sampleCache.get(ctx);\n  if(s) return s;",
    u"async function ensureSamples(ctx,setId){\n  let s=sampleCache.get(ctx);", "sig")

# ---------- 3. playTone: key = <ชุด> หรือ <ชุด>_khuang ----------
rep(u"""function playTone(ctx,bus,freq,t0,dur,key){
  const P = INST[key] || INST.khlui;
  playSus(ctx,bus,freq*Math.pow(2,P.oct||0),t0,dur,P);
}""",
u"""function playTone(ctx,bus,freq,t0,dur,key){
  const kh = key.endsWith('_khuang');
  const setId = kh ? key.slice(0,-7) : key;
  const P = kh ? INST.khlui_khuang : INST.khlui;
  const f = freq*Math.pow(2,P.oct||0);
  const cached = sampleCache.get(ctx);
  const list = cached && cached.sets && cached.sets[setId];
  if(list && list.length) playSample(ctx,bus,f,t0,dur,kh,list);
  else playSus(ctx,bus,f,t0,dur,P);        // สำรอง ถ้าถอดรหัสไฟล์เสียงไม่ได้
}""", "playTone")

rep(u"    playTone(ctx,g.bus,freqOf(n.deg,n.oct,o),t0+n.t,n.dur, n.kh?'khlui_khuang':'khlui');",
    u"    playTone(ctx,g.bus,freqOf(n.deg,n.oct,o),t0+n.t,n.dur, o.inst+(n.kh?'_khuang':''));", "schedAll")
rep(u"      playTone(ac,graph.bus,freqOf(x.deg,x.oct,o),nextTime+x.dt,x.dur, x.kh?'khlui_khuang':'khlui');",
    u"      playTone(ac,graph.bus,freqOf(x.deg,x.oct,o),nextTime+x.dt,x.dur, o.inst+(x.kh?'_khuang':''));", "sched")

# ---------- 4. โหลดชุดที่กำลังใช้ ----------
rep(u"  if(o.ching) await ensureSamples(c);", u"  await ensureSamples(c, o.inst);", "start")
rep(u"    if(o.ching) await ensureSamples(off);", u"    await ensureSamples(off, o.inst);", "wav")
rep(u"""  const g = (graph && playing) ? graph : previewG;
  playTone(c,g.bus,freqOf(deg,oct,o),c.currentTime+.01,.5,o.inst);""",
u"""  const g = (graph && playing) ? graph : previewG;
  ensureSamples(c, o.inst).then(()=>playTone(c,g.bus,freqOf(deg,oct,o),c.currentTime+.02,.5,o.inst));""", "preview")

# ---------- 5. ชุดเสียงตามชนิดคีย์ ไม่ต้องมีช่องเลือก ----------
rep(u"    inst  : 'khlui',",
    u"    inst  : west ? 'ckey' : 'phiangor',   // คีย์สากลใช้ขลุ่ยคีย์ซี ทางไทยใช้เพียงออ", "opts")
rep(u"  const VARIANT = $('#inst') ? 'thai' : 'khlui';",
    u"  const VARIANT = 'khlui';\n  const SAMPLER_REV = 'sets-3';           // เปลี่ยนเมื่อชุดตัวอย่างเสียงเปลี่ยน", "variant")

# ---------- 6. ป้ายบอกขลุ่ยและช่วงที่อัดไว้ ----------
rep(u"    const f=o.base*Math.pow(2, INST[o.inst].oct||0);   // ความถี่ที่ได้ยินจริง",
    u"    const f=o.base*Math.pow(2, INST.khlui.oct||0);     // ความถี่ที่ได้ยินจริง", "showkeyoct")
rep(u"    $('#keyNote').textContent = 'ด ของขลุ่ยเพียงออ ≈ '+noteName(f);",
u"""    const set = KHLUI_SETS[o.inst] || KHLUI_SETS.phiangor;
    const sl = set.samples[0].f0, sh = set.samples[set.samples.length-1].f0;
    $('#keyNote').textContent = set.name+' · ด ≈ '+noteName(f)
      + ((f < sl*0.94 || f > sh*1.06)
         ? ' · นอกช่วงที่อัดไว้ ('+sl.toFixed(0)+'–'+sh.toFixed(0)+' Hz)' : '');""", "keynote")

# ---------- 7. เปลี่ยนชนิดคีย์ -> เตรียมชุดเสียงของฝั่งนั้นไว้ล่วงหน้า ----------
rep(u"""  function onKeyChange(){
    const west = $('#key').value[0]==='w';
    if(west!==prevWest){""",
u"""  function onKeyChange(){
    const west = $('#key').value[0]==='w';
    if(ac) ensureSamples(ac, west ? 'ckey' : 'phiangor');   // เตรียมไว้ก่อนถึงคิวเล่น
    if(west!==prevWest){""", "keychange")

# ---------- 8. เสียงอ้างอิงเริ่มต้นฝั่งไทย = ของเพียงออ ----------
ref0 = info[0][5]
for a, b in [
    ('<input type="number" id="base" value="264" min="80" max="700" step="1">',
     '<input type="number" id="base" value="%.1f" min="80" max="700" step="0.5">' % ref0),
    ("const ref    = +$('#base').value || (west ? 440 : 264);",
     "const ref    = +$('#base').value || (west ? 440 : %.1f);" % ref0),
    ("let refThai=264, refWest=440, prevWest=false;",
     "let refThai=%.1f, refWest=440, prevWest=false;" % ref0),
]:
    rep(a, b, 'ref')
a4 = "else         refThai = +$('#base').value||264;"
assert s.count(a4) == 3, s.count(a4)
s = s.replace(a4, "else         refThai = +$('#base').value||%.1f;" % ref0)

# ---------- 9. ค่าที่จำไว้จากชุดเสียงเก่าต้องไม่ทับเสียงอ้างอิงใหม่ ----------
rep(u"    return { app:'noinoi', version:1, variant:VARIANT, notes:srcEl.value, settings };",
    u"    return { app:'noinoi', version:1, variant:VARIANT, rev:SAMPLER_REV, notes:srcEl.value, settings };", "snap")
rep(u"    const st = d.settings || {};",
u"""    const st = Object.assign({}, d.settings || {});
    // มาจากชุดตัวอย่างเสียงคนละรุ่น อย่าเอาเสียงอ้างอิงเก่ามาทับค่าที่จูนไว้กับชุดใหม่
    if(d.rev !== SAMPLER_REV) delete st.base;""", "applystate")

# ---------- 10. ข้อความ ----------
rep(u"      <p>ขลุ่ยเพียงออ · ลูกสะบัด · เสียงควง</p>\n", u"", "brand")
rep(u"""            <li><b>ความถี่ที่แสดง</b> คือเสียง <code>ด</code> ที่ได้ยินจริงของขลุ่ย ซึ่งสูงกว่าเสียงอ้างอิง 1 คู่แปด</li>""",
u"""            <li><b>ความถี่ที่แสดง</b> คือเสียง <code>ด</code> ที่ได้ยินจริงของขลุ่ย ซึ่งสูงกว่าเสียงอ้างอิง 1 คู่แปด</li>
            <li><b>เสียงขลุ่ยเลือกให้เองตามชนิดคีย์</b> — <i>ทางไทย</i> ใช้ %s · <i>คีย์สากล</i> ใช้ %s บรรทัดใต้ช่องคีย์บอกว่ากำลังใช้ตัวไหนอยู่</li>
            <li>โน้ตที่สูงเกินช่วงที่อัดไว้ ระบบต้องยืดตัวอย่างขึ้นเท่าตัว เสียงจะสว่างกว่าปกติ ระบบลดระดับและกรองความสูงลงชดเชยให้แล้ว แต่ยังไม่เท่าของจริง</li>""" %
    tuple('%s %d ขั้น (%d–%d Hz)' % (lb, n, lo, hi) for _, lb, n, lo, hi, _ in info), "help")

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('khlui.html -> %.0f KB' % (os.path.getsize(p)/1024))
for sid, lb, n, lo, hi, ref in info:
    print('  %-9s %-14s %2d ขั้น  %4d-%4d Hz  ref %.1f' % (sid, lb, n, lo, hi, ref))
