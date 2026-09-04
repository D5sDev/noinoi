# -*- coding: utf-8 -*-
"""แยกตัวอย่างเสียงขลุ่ยคีย์ซี 14 ขั้น — ล่าง 7 + สูง 7 (ฟํ ใช้เทคที่เป่าใหม่)"""
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

OUT_SR = 22050
NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
def nm(f):
    n = 12*np.log2(f/440.0); r = int(round(n))
    return '%-3s%d %+4.0f' % (NAMES[(r+9)%12], 4+((r+9)//12), (n-r)*100)

def load(f):
    sr, x = wav.read(f)
    return sr, x.astype(np.float64)/32768.0

def f0_hps(seg, sr, lo=380, hi=2600):
    n = 1 << 14; m = min(len(seg), n)
    S = np.abs(np.fft.rfft(seg[:m]*np.hanning(m), n)); H = S.copy()
    for k in (2,3,4):
        d = S[::k]; H[:len(d)] *= d
    a, b = int(lo*n/sr), int(hi*n/sr)
    f = (a + int(np.argmax(H[a:b])))*sr/n
    s = seg[:int(sr*0.06)] if len(seg) > int(sr*0.06) else seg
    s = s - s.mean(); w = s*np.hanning(len(s))
    c = sig.correlate(w, w, mode='full', method='fft')[len(w)-1:]; c /= c[0]
    k = int(round(sr/f))
    lo2, hi2 = max(2,int(k*0.9)), min(int(k*1.1), len(c)-2)
    k = lo2 + int(np.argmax(c[lo2:hi2]))
    p, q, r = c[k-1], c[k], c[k+1]
    return sr/(k + (p-r)/(2*(p-2*q+r)+1e-12))

def best_loop(seg, ls_cands, XF, lmin, lmax, limit):
    e2 = np.concatenate([[0.0], np.cumsum(seg**2)]); best = None
    for ls in ls_cands:
        pre = seg[ls-XF:ls]; pe = float((pre**2).sum())
        xc = sig.correlate(seg, pre, mode='valid', method='fft')
        we = e2[XF:] - e2[:-XF]; n = min(len(xc), len(we))
        le = np.arange(n) + XF
        ok = (le >= ls+lmin) & (le <= ls+lmax) & (le <= limit)
        if not ok.any(): continue
        d = np.sqrt(np.maximum(we[:n]-2*xc[:n]+pe,0))/(np.sqrt(np.maximum(we[:n],1e-18))+1e-9)
        d = np.where(ok, d, np.inf); j = int(np.argmin(d))
        if best is None or d[j] < best[0]: best = (float(d[j]), ls, int(le[j])-ls)
    return best

def grab(sr, x, t0, t1, outfile):
    seg = x[int(t0*sr):int(t1*sr)]
    H = int(sr*0.01); pk = np.abs(seg).max()
    env = np.array([np.abs(seg[i*H:(i+1)*H]).max() for i in range(len(seg)//H)])
    onset = max(0, int(np.argmax(env > pk*0.20))*H - int(sr*0.02))
    tail = len(seg)
    for i in range(len(env)-1, 0, -1):
        if env[i] > pk*0.30: tail = min(len(seg), (i+1)*H); break
    avail = (tail-onset)/sr
    core = seg[onset+int((tail-onset)*0.25) : onset+int((tail-onset)*0.85)]
    f0 = f0_hps(core, sr)
    W = int(sr*0.1)
    tr = [f0_hps(core[t:t+W], sr) for t in range(0, max(1,len(core)-W), int(sr*0.05))]
    tr = [v for v in tr if f0*0.9 < v < f0*1.1]
    spread = 1200*np.log2(max(tr)/min(tr)) if len(tr) > 1 else 0
    period = sr/f0

    XF   = int(round(period*min(6, max(3, avail*8))))
    z0   = onset + int(sr*min(0.30, avail*0.35))
    z1   = tail - int(sr*min(0.20, avail*0.10))
    span = min(0.22, avail*0.22)
    lmin = int(sr*min(0.14, avail*0.25)); lmax = int(sr*min(0.30, avail*0.45))
    cands = [int(t) for t in np.linspace(z0, z0+int(sr*span), 20) if t-XF > onset]
    d, ls, L = best_loop(seg, cands, XF, lmin, lmax, z1)
    le = ls + L

    clip = seg[onset:le].copy()
    lsr, ler = ls-onset, le-onset
    fade = np.linspace(0, 1, XF)
    clip[ler-XF:ler] = clip[ler-XF:ler]*(1-fade) + clip[lsr-XF:lsr]*fade
    clip = normalize(clip, lsr, sr)

    y = sig.resample_poly(clip, OUT_SR, sr)
    lsq = int(round(lsr*OUT_SR/sr))
    wav.write(outfile, OUT_SR, (np.clip(y,-1,1)*32767).astype(np.int16))
    return dict(file=outfile, f0=round(f0,2), loopStart=round(lsq/OUT_SR,6),
                dur=round(len(y)/OUT_SR,6)), spread, d, len(y)/OUT_SR

LOW  = [(4.27,7.02),(7.77,10.30),(11.14,13.79),(14.54,17.17),
        (17.97,20.47),(21.12,23.69),(24.39,27.39)]            # ด ร ม ฟ ซ ล ท
HIGH = [(1.55,2.14),(2.35,2.89),(3.03,3.53),None,
        (4.21,4.64),(4.72,5.10),(5.18,5.70)]                  # ดํ รํ มํ [ฟํ] ซํ ลํ ทํ
FA   = (1.18,2.60)                                            # ฟํ เทคที่เป่าใหม่
LBL  = ['ด','ร','ม','ฟ','ซ','ล','ท','ดํ','รํ','มํ','ฟํ','ซํ','ลํ','ทํ']

srL, xL = load(decode('ขลุ่ย.mp3'))
srH, xH = load(decode('เสียงสูงคีย์ซี.mp3'))
srF, xF = load(decode('ฟาสูง คีย์ซ๊.m4a'))

meta, total = [], 0
print('%-4s %-9s %-11s %-6s %-8s %-8s %s' % ('เสียง','Hz','สากล','ส่าย','ยาวไฟล์','loop','รอยต่อ'))
n = 0
for i, w in enumerate(LOW):
    n += 1; m, sp, d, dur = grab(srL, xL, w[0], w[1], 'ckey_%02d.wav' % n)
    meta.append(m); total += os.path.getsize(m['file'])
    print('%-4s %-9.2f %-11s %-6.0f %-8.3f %-8.3f %.3f' % (LBL[n-1], m['f0'], nm(m['f0']), sp, dur, dur-m['loopStart'], d))
for i, w in enumerate(HIGH):
    n += 1
    if w is None: m, sp, d, dur = grab(srF, xF, FA[0], FA[1], 'ckey_%02d.wav' % n)
    else:         m, sp, d, dur = grab(srH, xH, w[0], w[1], 'ckey_%02d.wav' % n)
    meta.append(m); total += os.path.getsize(m['file'])
    tag = ' (เทคใหม่)' if w is None else ''
    print('%-4s %-9.2f %-11s %-6.0f %-8.3f %-8.3f %.3f%s' % (LBL[n-1], m['f0'], nm(m['f0']), sp, dur, dur-m['loopStart'], d, tag))

json.dump(meta, open('ckey_meta.json','w'), indent=1)
print('\nรวม %d ไฟล์  %.0f KB  (base64 ~%.0f KB)' % (len(meta), total/1024, total*4/3/1024))
base = meta[0]['f0']
c = [1200*np.log2(m['f0']/base) for m in meta]
print('\nระยะขั้นจากเสียงต่ำสุด (เซนต์)')
print('  วัดได้     ' + ' '.join('%5.0f' % v for v in c))
print('  เมเจอร์สากล ' + ' '.join('%5.0f' % v for v in [0,200,400,500,700,900,1100,1200,1400,1600,1700,1900,2100,2300]))
print('  ขั้นต่อขั้น  ' + '   '.join('%3.0f' % (c[i+1]-c[i]) for i in range(len(c)-1)))
