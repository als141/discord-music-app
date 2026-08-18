'use client';

import { useEffect } from 'react';

/**
 * 再生中アートワークから代表色を抽出し、--color-primary / --accent-glow を実行時に上書きする。
 * （iOS 27 Apple Music の「アートワークの色がページ全体を染める」流れの Web 実装）
 *
 * - canvas に縮小描画して、彩度の高い画素の加重平均を取る
 * - 白文字が読める明度・十分な彩度に正規化する（アクセシビリティ担保）
 * - CORS で読めない画像（tainted canvas）のときは既定色に戻す
 */

const DEFAULT_PRIMARY = '#33508C';
const DEFAULT_GLOW = '#C9D3EA';

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return [h, s, l];
}

function hslToCss(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
}

const cache = new Map<string, { primary: string; glow: string } | null>();

export function extractAccent(url: string): Promise<{ primary: string; glow: string } | null> {
  if (cache.has(url)) return Promise.resolve(cache.get(url) ?? null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    const done = (v: { primary: string; glow: string } | null) => { cache.set(url, v); resolve(v); };
    img.onerror = () => done(null);
    img.onload = () => {
      try {
        const size = 32;
        const canvas = document.createElement('canvas');
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return done(null);
        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);
        // 彩度・明度で重み付けした平均色（灰色や極端に暗い/明るい画素は効きにくくする）
        let wr = 0, wg = 0, wb = 0, wsum = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          if (a < 128) continue;
          const [, s, l] = rgbToHsl(r, g, b);
          const w = Math.pow(s, 1.5) * (1 - Math.abs(l - 0.5) * 1.6) + 0.02;
          if (w <= 0) continue;
          wr += r * w; wg += g * w; wb += b * w; wsum += w;
        }
        if (wsum === 0) return done(null);
        const [h, s0] = rgbToHsl(wr / wsum, wg / wsum, wb / wsum);
        // 白文字が乗る前提で明度は 0.42〜0.50、彩度は下限を持たせる
        const s = Math.min(0.85, Math.max(0.45, s0 * 1.15));
        const primary = hslToCss(h, s, 0.46);
        const glow = hslToCss(h, Math.min(0.7, s), 0.82);
        done({ primary, glow });
      } catch {
        // tainted canvas（CORS 不許可）など
        done(null);
      }
    };
    img.src = url;
  });
}

export function applyAccent(accent: { primary: string; glow: string } | null) {
  const root = document.documentElement;
  root.style.setProperty('--color-primary', accent?.primary ?? DEFAULT_PRIMARY);
  root.style.setProperty('--accent-glow', accent?.glow ?? DEFAULT_GLOW);
  root.style.setProperty('--color-ring', accent?.primary ?? DEFAULT_PRIMARY);
}

/** 再生中アートワークに追従してアクセント色を切り替える */
export function useArtworkAccent(thumbnailUrl: string | null | undefined) {
  useEffect(() => {
    let cancelled = false;
    if (!thumbnailUrl) { applyAccent(null); return; }
    extractAccent(thumbnailUrl).then((accent) => { if (!cancelled) applyAccent(accent); });
    return () => { cancelled = true; };
  }, [thumbnailUrl]);
}
