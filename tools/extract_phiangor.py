# -*- coding: utf-8 -*-
"""แยกตัวอย่างเสียงขลุ่ยเพียงออ 12 ขั้น (ล่าง 7 จับนิ้ว + บน 5 เป่าทบ)"""
import numpy as np, scipy.io.wavfile as wav, scipy.signal as sig, json, os
from samplenorm import normalize

import os, subprocess, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT  = os.path.join(ROOT, 'samples')
os.makedirs(OUT, exist_ok=True)

def decode(name):
    """แปลงไฟล์อัดใน raw/ เป็น wav โมโน 44.1k เก็บไว้ในโฟลเดอร์ชั่วคราว"""
    src = os.path.join(ROOT, 'raw', name)
    dst = os.path.join(tempfile.gettempdir(), 'noinoi_' + os.path.splitext(name)[0] + '.wav')
    if not os.path.exists(dst) or os.path.getmtime(dst) < os.path.getmtime(src):
        subprocess.run(['ffmpeg','-v','error','-i',src,'-ac','1','-ar','44100','-f','wav',dst,'-y'],
                       check=True)
    return dst

os.chdir(OUT)          # ไฟล์ผลลัพธ์ทั้งหมดลงที่ samples/

sr, x = wav.read(decode('เพียงออ.mp3'))
x = x.astype(np.float64)/32768.0
OUT_SR = 22050
NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
def nm(f):
    n = 12*np.log2(f/440.0); r = int(round(n))
    return '%-3s%d %+4.0f' % (NAMES[(r+9)%12], 4+((r+9)//12), (n-r)*100)

def f0_hps(seg, sr):
    """สเปกตรัมคูณฮาร์มอนิกหาคู่แปดให้ถูก แล้วค่อยละเอียดด้วย autocorrelation"""
    n = 1 << 15
    m = min(len(seg), n)
    S = np.abs(np.fft.rfft(seg[:m]*np.hanning(m), n))
    H = S.copy()
    for k in (2,3,4):
        d = S[::k]; H[:len(d)] *= d
    lo, hi = int(380*n/sr), int(1800*n/sr)
    f = (lo + int(np.argmax(H[lo:hi])))*sr/n
    s = seg[:int(sr*0.06)] if len(seg) > int(sr*0.06) else seg   # autocorrelation สั้น ๆ พอ
    s = s - s.mean(); w = s*np.hanning(len(s))
    c = sig.correlate(w, w, mode='full', method='fft')[len(w)-1:]; c /= c[0]
    k = int(round(sr/f))
    lo2, hi2 = max(2,int(k*0.9)), min(int(k*1.1), len(c)-2)
    k = lo2 + int(np.argmax(c[lo2:hi2]))
    a, b, cc = c[k-1], c[k], c[k+1]
    return sr/(k + (a-cc)/(2*(a-2*b+cc)+1e-12))

def find(x, lo, hi, mindur, rel):
    H = int(sr*0.01)
    sub = x[lo:hi]
    env = np.array([np.abs(sub[i*H:(i+1)*H]).max() for i in range(len(sub)//H)])
    on = env > env.max()*rel
    out, i = [], 0
    while i < len(on):
        if on[i]:
            j = i
            while j < len(on) and (on[j] or (j+4 < len(on) and on[j:j+4].any())): j += 1
            if (j-i)*H/sr >= mindur: out.append((lo+i*H, lo+j*H))
            i = j
        else: i += 1
    return out

def best_loop(seg, ls_cands, XF, lmin, lmax, limit):
    e2 = np.concatenate([[0.0], np.cumsum(seg**2)])
    best = None
    for ls in ls_cands:
        pre = seg[ls-XF:ls]; pe = float((pre**2).sum())
        xc = sig.correlate(seg, pre, mode='valid', method='fft')
        we = e2[XF:] - e2[:-XF]
        n = min(len(xc), len(we))
        le = np.arange(n) + XF
        ok = (le >= ls+lmin) & (le <= ls+lmax) & (le <= limit)
        if not ok.any(): continue
        d = np.sqrt(np.maximum(we[:n]-2*xc[:n]+pe,0))/(np.sqrt(np.maximum(we[:n],1e-18))+1e-9)
        d = np.where(ok, d, np.inf); j = int(np.argmin(d))
        if best is None or d[j] < best[0]: best = (float(d[j]), ls, int(le[j])-ls)
    return best

# ล่าง 7 ตัวแรก (จับนิ้ว) + บน 5 ตัว (เป่าทบ) = 12 ขั้นเรียงต่อกัน
picks = find(x, 0, int(sr*36.0), 1.0, 0.10)[:7] + find(x, int(sr*36.4), int(sr*40.7), 0.25, 0.18)[:5]

meta, total = [], 0
print('%-3s %-6s %-6s %-9s %-11s %-6s %-8s %-9s %-8s %s' %
      ('#','เริ่ม','ยาว','Hz','สากล','ส่าย','ยาวไฟล์','loop เริ่ม','loop ยาว','รอยต่อ'))
for idx, (a, b) in enumerate(picks, 1):
    seg = x[a:b]
    H = int(sr*0.01)
    pk = np.abs(seg).max()
    env = np.array([np.abs(seg[i*H:(i+1)*H]).max() for i in range(len(seg)//H)])
    onset = max(0, int(np.argmax(env > pk*0.20))*H - int(sr*0.02))
    tail = len(seg)
    for i2 in range(len(env)-1, 0, -1):
        if env[i2] > pk*0.30: tail = min(len(seg), (i2+1)*H); break
    avail = (tail-onset)/sr

    core = seg[onset+int((tail-onset)*0.25) : onset+int((tail-onset)*0.85)]
    f0 = f0_hps(core, sr)
    W = int(sr*0.1)
    tr = [f0_hps(core[t:t+W], sr) for t in range(0, max(1,len(core)-W), int(sr*0.05))]
    tr = [v for v in tr if f0*0.9 < v < f0*1.1]
    spread = 1200*np.log2(max(tr)/min(tr)) if len(tr) > 1 else 0
    period = sr/f0

    # โน้ตสั้นต้องผ่อนพารามิเตอร์ลง
    XF   = int(round(period*min(6, max(3, avail*8))))
    head = min(0.30, avail*0.35)
    span = min(0.22, avail*0.22)
    lmin = int(sr*min(0.14, avail*0.25))
    lmax = int(sr*min(0.30, avail*0.45))
    z0   = onset + int(sr*head)
    z1   = tail - int(sr*min(0.20, avail*0.10))
    ls_cands = [int(t) for t in np.linspace(z0, z0+int(sr*span), 20) if t-XF > onset]
    got = best_loop(seg, ls_cands, XF, lmin, lmax, z1)
    if got is None:
        print('%-3d ข้ามเพราะสั้นเกินไป (%.2f วิ)' % (idx, avail)); continue
    d, ls, L = got
    le = ls + L

    clip = seg[onset:le].copy()
    lsr, ler = ls-onset, le-onset
    fade = np.linspace(0, 1, XF)
    clip[ler-XF:ler] = clip[ler-XF:ler]*(1-fade) + clip[lsr-XF:lsr]*fade
    clip = normalize(clip, lsr, sr)

    y = sig.resample_poly(clip, OUT_SR, sr)
    lsq = int(round(lsr*OUT_SR/sr))
    fn = 'phiangor_%02d.wav' % idx
    wav.write(fn, OUT_SR, (np.clip(y,-1,1)*32767).astype(np.int16))
    total += os.path.getsize(fn)
    meta.append(dict(file=fn, f0=round(f0,2), loopStart=round(lsq/OUT_SR,6),
                     dur=round(len(y)/OUT_SR,6)))
    print('%-3d %-6.2f %-6.2f %-9.2f %-11s %-6.0f %-8.3f %-9.3f %-8.3f %.3f' %
          (idx, a/sr, (b-a)/sr, f0, nm(f0), spread, len(y)/OUT_SR,
           lsq/OUT_SR, (len(y)-lsq)/OUT_SR, d))

json.dump(meta, open('phiangor_meta.json','w'), indent=1)
print('\nรวม %d ไฟล์  %.0f KB  (base64 ~%.0f KB)' % (len(meta), total/1024, total*4/3/1024))
base = meta[0]['f0']
print('\nระยะขั้นจากเสียงต่ำสุด (เซนต์)')
print('  วัดได้     ' + ' '.join('%5.0f' % (1200*np.log2(m['f0']/base)) for m in meta))
print('  7 เสียงเท่า ' + ' '.join('%5.0f' % (i*1200/7) for i in range(len(meta))))
print('  ต่างกัน    ' + ' '.join('%5.0f' % (1200*np.log2(m['f0']/base)-i*1200/7)
                                  for i, m in enumerate(meta)))
