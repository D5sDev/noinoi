# -*- coding: utf-8 -*-
"""ปรับระดับเสียงตัวอย่างให้ 'ตัวเสียง' ดังเท่ากัน ไม่ใช่ปรับตามยอดคลื่น

ปรับตามยอดคลื่นทำให้ไฟล์ที่หัวเสียงกระแทกแรงถูกกดตัวเสียงลงไปด้วย
พอเล่นเรียงกันจะมีบางเสียงเบาโผล่ออกมาจากพวก
"""
import numpy as np
from scipy.ndimage import minimum_filter1d

TARGET_RMS = 0.32          # ความดังของตัวเสียง ใช้ค่าเดียวกันทุกไฟล์ทุกชุด
HEAD_ROOM  = 1.8           # หัวเสียงสูงกว่าตัวเสียงได้กี่เท่า ก่อนจะโดนกด

def normalize(clip, loop_start, sr):
    """clip = หัวเสียง + หนึ่งรอบ loop (crossfade มาแล้ว), loop_start = ดัชนีเริ่ม loop

    เกนในช่วง loop ต้องคงที่ ไม่งั้นรอยต่อตอนวนจะเพี้ยน จึงกดเฉพาะหัวเสียง
    """
    clip = clip.astype(np.float64).copy()
    body = clip[loop_start:]
    rms = float(np.sqrt((body**2).mean()))
    clip *= TARGET_RMS/max(rms, 1e-9)

    body_peak = float(np.abs(clip[loop_start:]).max())
    cap = min(0.97, body_peak*HEAD_ROOM)
    head = clip[:loop_start]
    if len(head) and np.abs(head).max() > cap:
        w = max(3, int(sr*0.004))
        env = np.convolve(np.abs(head), np.ones(w)/w, 'same')
        env = np.maximum(env, np.abs(head))
        g = np.minimum(1.0, cap/np.maximum(env, 1e-9))
        k = max(3, int(sr*0.006))
        g = minimum_filter1d(g, size=k)                       # อย่าให้ยอดไหนหลุด
        win = np.hanning(k); g = np.convolve(g, win/win.sum(), 'same')
        g = np.minimum(g, 1.0)
        # ค่อย ๆ คืนเกนเป็น 1 ก่อนถึงจุดเริ่ม loop
        t = min(len(g), max(1, int(sr*0.03)))
        g[len(g)-t:] = g[len(g)-t:]*(1-np.linspace(0,1,t)) + np.linspace(0,1,t)
        clip[:loop_start] = head*g

    pk = float(np.abs(clip).max())
    if pk > 0.99: clip *= 0.99/pk                             # กันล้นแบบสุดท้าย
    return clip
