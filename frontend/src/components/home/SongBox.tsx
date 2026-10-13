'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Meta, SectionHeader } from '@/components/games/ui';
import { appApi, BoxItem } from '@/lib/app-api';
import type { PlayableItem } from '@/utils/api';
import { RECO_CHANGED } from './RecoPanel';

/**
 * 曲置き場の「曲置き箱」。Discord とは別に、アプリから曲のリンクを置ける（YouTube・YouTube Music・ニコニコ・
 * Spotify・Apple Music。Spotify と Apple Music は YouTube Music で同じ曲を探して置く）。
 * 置いた曲はすぐ「ドデカのおすすめ」の材料になる（置くほど育つ）。自分が置いた曲は×で取り出せる。
 * データは `GET/POST/DELETE /reco/{guild}/box`（本人のトークン、メンバーのみ）
 */

const FIRST = 4;

function ago(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(min) || min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}時間前`;
  const d = Math.floor(min / 1440);
  return d < 30 ? `${d}日前` : `${Math.floor(d / 30)}か月前`;
}

export function SongBox({ guildId, onEnqueue }: { guildId: string; onEnqueue?: (item: PlayableItem) => void }) {
  const [items, setItems] = useState<BoxItem[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await appApi.recoBox(guildId)).items);
    } catch {
      setItems((v) => v ?? []);
    }
  }, [guildId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    if (text.trim().length < 8 || busy) return;
    setBusy(true);
    setNote(null);
    try {
      const { results } = await appApi.recoBoxAdd(guildId, text.trim());
      const ok = results.filter((r) => r.ok && r.item);
      const ng = results.filter((r) => !r.ok);
      if (ok.length) {
        setItems((v) => [...ok.map((r) => r.item!), ...(v ?? [])]);
        setText('');
        window.dispatchEvent(new Event(RECO_CHANGED));
      }
      setNote(
        ok.length
          ? { ok: true, text: ok.length === 1 ? `「${ok[0].item!.title}」を置きました` : `${ok.length}曲を置きました` + (ng.length ? `（${ng.length}件は置けませんでした）` : '') }
          : { ok: false, text: ng[0]?.error || '置けませんでした' }
      );
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : '置けませんでした' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (it: BoxItem) => {
    setItems((v) => (v ?? []).filter((x) => x.id !== it.id));
    try {
      await appApi.recoBoxRemove(guildId, it.id);
      window.dispatchEvent(new Event(RECO_CHANGED));
    } catch {
      void load();
    }
  };

  const list = items ?? [];
  const shown = expanded ? list : list.slice(0, FIRST);
  return (
    <section className="-mx-4 mb-10 sm:-mx-6" data-tour="song-box" aria-label="曲置き箱">
      <SectionHeader title="曲置き箱" caption="置くほどおすすめが育つ" />
      <div className="px-4 sm:px-6">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex items-center gap-2 rounded-2xl border border-border bg-card p-1.5 pl-4 focus-within:border-foreground/30"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            inputMode="url"
            autoComplete="off"
            placeholder="YouTube・ニコニコなどのリンク"
            aria-label="曲のリンク"
            className="h-10 min-w-0 flex-1 bg-transparent text-[15px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={busy || text.trim().length < 8}
            className="flex h-10 flex-shrink-0 items-center gap-1.5 rounded-xl bg-foreground px-4 text-[14px] font-semibold text-background disabled:opacity-40"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            置く
          </button>
        </form>
        {note && (
          <p className={`mt-2 text-[13px] ${note.ok ? 'text-foreground/80' : 'text-destructive'}`} role="status">
            {note.text}
          </p>
        )}
      </div>
      {list.length > 0 && (
        <div className="mt-2 px-4 sm:px-4">
          <div className="divide-y divide-border/60" role="list" aria-label="置かれた曲">
            {shown.map((it) => (
              <div key={it.id} className="flex min-h-[56px] items-center gap-1 sm:rounded-xl sm:hover:bg-secondary/50" role="listitem">
                <button
                  type="button"
                  onClick={() => onEnqueue?.({ title: it.title, artist: it.artist, thumbnail: it.thumb || '', url: it.url, type: 'song' })}
                  className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left sm:pl-2"
                  aria-label={`${it.title} をキューに追加`}
                >
                  <span className="relative h-[40px] flex-shrink-0 overflow-hidden rounded-md bg-secondary" style={{ aspectRatio: '16 / 9' }}>
                    {it.thumb && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.thumb} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold leading-snug text-foreground">{it.title}</span>
                    <Meta parts={[it.artist || null, it.platform === 'niconico' ? 'ニコニコ' : null, it.who.name || 'だれか', ago(it.added_at)]} className="block truncate leading-snug" />
                  </span>
                </button>
                {it.mine && (
                  <button
                    type="button"
                    onClick={() => void remove(it)}
                    className="flex h-10 w-9 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground/60 hover:bg-secondary hover:text-foreground"
                    aria-label={`${it.title} を取り出す`}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          {list.length > FIRST && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 h-10 w-full rounded-xl text-[13px] font-semibold text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
            >
              {expanded ? 'たたむ' : `あと ${list.length - FIRST} 曲`}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export default SongBox;
