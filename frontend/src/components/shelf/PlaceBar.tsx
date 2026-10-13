'use client';

import React, { useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ClipboardPaste, Link2, Loader2, Play, X } from 'lucide-react';
import { appApi, BoxItem } from '@/lib/app-api';
import type { PlayableItem } from '@/utils/api';

/**
 * 曲置き場のいちばん上の「曲を置く」。リンクを貼るだけで置ける（貼った瞬間に置く。ボタンでも置ける）。
 * 置いた曲は下の「いまのおすすめ」の起点になり（置いた「○○」に合わせて）、「みんなの置き場」にも並ぶ。
 * YouTube・YouTube Music・ニコニコはそのまま、Spotify・Apple Music は YouTube Music で同じ曲を探して置く
 */

export const SHELF_CHANGED = 'irina-shelf-changed';
const SUPPORTED = /(youtube\.com|youtu\.be|music\.youtube\.com|nicovideo\.jp|nico\.ms|open\.spotify\.com|music\.apple\.com)\//i;

export function PlaceBar({ guildId, onEnqueue }: { guildId: string; onEnqueue?: (item: PlayableItem) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState<BoxItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async (value: string) => {
    const v = value.trim();
    if (v.length < 8 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { results } = await appApi.recoBoxAdd(guildId, v);
      const ok = results.filter((r) => r.ok && r.item).map((r) => r.item!);
      if (ok.length) {
        setPlaced(ok);
        setText('');
        window.dispatchEvent(new Event(SHELF_CHANGED));
      }
      const ng = results.find((r) => !r.ok);
      if (ng && !ok.length) setError(ng.error || '置けませんでした');
    } catch (e) {
      setError(e instanceof Error ? e.message : '置けませんでした');
    } finally {
      setBusy(false);
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const t = await navigator.clipboard.readText();
      if (t && SUPPORTED.test(t)) {
        setText(t);
        void submit(t);
        return;
      }
    } catch {
      /* 読めない環境は入力欄へ */
    }
    inputRef.current?.focus();
  };

  const takeOut = async (it: BoxItem) => {
    setPlaced((xs) => xs.filter((x) => x.id !== it.id));
    try {
      await appApi.recoBoxRemove(guildId, it.id);
      window.dispatchEvent(new Event(SHELF_CHANGED));
    } catch {
      /* 次の読み込みで戻る */
    }
  };

  return (
    <div className="mb-8" data-tour="place-bar">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(text);
        }}
        className="flex h-14 items-center gap-2 rounded-2xl border border-border bg-card pl-4 pr-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors focus-within:border-foreground/30"
      >
        {busy ? <Loader2 className="h-5 w-5 flex-shrink-0 animate-spin text-muted-foreground" /> : <Link2 className="h-5 w-5 flex-shrink-0 text-muted-foreground" />}
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          onPaste={(e) => {
            const t = e.clipboardData.getData('text');
            if (t && SUPPORTED.test(t)) {
              e.preventDefault();
              setText(t);
              void submit(t);
            }
          }}
          inputMode="url"
          autoComplete="off"
          disabled={busy}
          placeholder="曲のリンクを貼って置く"
          aria-label="曲のリンク"
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        {text.trim() ? (
          <button type="submit" disabled={busy} className="h-10 flex-shrink-0 rounded-xl bg-foreground px-4 text-[14px] font-semibold text-background disabled:opacity-40">
            置く
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void pasteFromClipboard()}
            className="flex h-10 flex-shrink-0 items-center gap-1.5 rounded-xl px-3 text-[14px] font-semibold text-foreground/70 hover:bg-secondary hover:text-foreground"
          >
            <ClipboardPaste className="h-4 w-4" />
            貼り付け
          </button>
        )}
      </form>
      <p className="mt-1.5 px-1 text-[12px] text-muted-foreground" role={error ? 'alert' : undefined}>
        {error ? <span className="text-destructive">{error}</span> : 'YouTube・YouTube Music・ニコニコ・Spotify・Apple Music'}
      </p>
      <AnimatePresence initial={false}>
        {placed.map((it) => (
          <motion.div
            key={it.id}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-2 flex items-center gap-3 rounded-xl bg-secondary/60 p-2"
            role="status"
          >
            <span className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-md bg-secondary">
              {it.thumb && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.thumb} alt="" className="absolute inset-0 h-full w-full object-cover" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold text-primary">置きました</span>
              <span className="block truncate text-[14px] font-semibold text-foreground">{it.title}</span>
            </span>
            <button
              type="button"
              onClick={() => onEnqueue?.({ title: it.title, artist: it.artist, thumbnail: it.thumb || '', url: it.url, type: 'song' })}
              className="flex h-9 flex-shrink-0 items-center gap-1 rounded-full bg-foreground px-3 text-[13px] font-semibold text-background"
            >
              <Play className="h-3.5 w-3.5 fill-current" />
              流す
            </button>
            <button type="button" onClick={() => void takeOut(it)} className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary" aria-label={`${it.title} を取り出す`}>
              <X className="h-4 w-4" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export default PlaceBar;
