'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { useToast } from '@/hooks/use-toast';
import { appApi, ResearchFeed, ResearchReport } from '@/lib/app-api';
import { Meta, SectionHeader } from '@/components/games/ui';
import { onResearchOpen, takeResearchOpen } from '@/lib/research-open';

/**
 * 「調査」タブ（主役）。Claude（Opus 5.5）がウェブで調べた「今日の調査」（毎日 17:30）・「今週の新作」（月曜）・
 * 「今週の新曲」（金曜）と、メンバーの質問への答え。ゲーム置き場・曲置き場と同じ部品（../games/ui）で組む。
 * - いちばん上に最新の「今日の調査」。イリーナの一言を吹き出し、見出しごとにカード（「今夜」だけローズ）
 * - 質問: 1 人 1 日 3 回まで。調べ中はフィードを 8 秒ごとに取り直す
 * データは `GET /research/{guild}/feed`（本人のトークン、メンバーのみ）
 */

const KIND_LABEL: Record<string, string> = {
  daily: '今日の調査',
  weekly_new: '今週の新作',
  weekly_music: '今週の新曲',
  question: '質問',
};
const EXAMPLES = ['4人でできる安い協力ホラー', 'スト6 の次の大会いつ？', 'いま VALORANT で強いエージェントは？', '今週安くなってる協力ゲーム'];
const IRINA = /^\*\*イリーナ\*\*\s*[「『]?([\s\S]*?)[」』]?\s*$/m;

function when(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const min = Math.floor((Date.now() - d.getTime()) / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}時間前`;
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 本文を「イリーナの一言」「見出しごとの節」「注記」に分ける */
function parse(md: string): { irina: string | null; lead: string; sections: { title: string; body: string }[]; notes: string } {
  const m = md.match(IRINA);
  let rest = m ? md.replace(m[0], '') : md;
  const notes = rest
    .split('\n')
    .filter((l) => l.trim().startsWith('※'))
    .join('\n');
  rest = rest
    .split('\n')
    .filter((l) => !l.trim().startsWith('※') && l.trim() !== '---')
    .join('\n');
  const parts = rest.split(/^## /m);
  const lead = parts.shift()?.trim() ?? '';
  const sections = parts.map((p) => {
    const [title, ...body] = p.split('\n');
    return { title: title.trim(), body: body.join('\n').trim() };
  });
  return { irina: m ? m[1].trim() : null, lead, sections, notes };
}

/** 'claude-opus-5-5' → 'Opus 5.5' */
function modelLabel(m: string | null): string | null {
  if (!m) return null;
  const [name, ...ver] = m.replace(/^claude-/, '').split('-');
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${ver.join('.')}`.trim();
}

function Md({ children, tonight = false }: { children: string; tonight?: boolean }) {
  // 「今夜」の節の中では【今夜】の印は要らない。ほかの節ではローズの小さな印にする
  const text = tonight ? children.replace(/【今夜】\s*/g, '') : children.replace(/【今夜】\s*/g, '**今夜** ');
  return (
    <ReactMarkdown
      components={{
        h3: ({ children: c }) => <h4 className="mb-1 mt-3 text-[14px] font-semibold text-foreground first:mt-0">{c}</h4>,
        p: ({ children: c }) => <p className="text-[15px] leading-relaxed text-foreground/90">{c}</p>,
        ul: ({ children: c }) => <ul className="space-y-2">{c}</ul>,
        li: ({ children: c }) => <li className="relative pl-3.5 text-[15px] leading-relaxed text-foreground/90 before:absolute before:left-0 before:top-[0.7em] before:h-1 before:w-1 before:rounded-full before:bg-muted-foreground/60">{c}</li>,
        strong: ({ children: c }) =>
          c === '今夜' ? (
            <span className="mr-1 inline-block rounded-full bg-primary/10 px-1.5 py-px align-[1px] text-[12px] font-bold text-primary">今夜</span>
          ) : (
            <strong className="font-semibold text-foreground">{c}</strong>
          ),
        a: ({ href, children: c }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap text-[13px] font-medium text-primary underline-offset-2 hover:underline">
            {c}
          </a>
        ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}

function IrinaBubble({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="h-9 w-9 flex-shrink-0 overflow-hidden rounded-full bg-secondary">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192x192.png" alt="" className="h-full w-full scale-[1.7] object-cover" style={{ transformOrigin: '50% 32%' }} />
      </span>
      <p className="min-w-0 rounded-2xl rounded-tl-md bg-secondary/70 px-4 py-2.5 text-[15px] leading-relaxed text-foreground">{text}</p>
    </div>
  );
}

function ReportBody({ rep }: { rep: ResearchReport }) {
  const p = useMemo(() => parse(rep.markdown || ''), [rep.markdown]);
  return (
    <div className="space-y-4">
      {p.irina && <IrinaBubble text={p.irina} />}
      {p.lead && <Md>{p.lead}</Md>}
      {p.sections.map((s) => {
        const tonight = s.title.startsWith('今夜');
        return (
          <section key={s.title} className={`rounded-2xl p-4 ${tonight ? 'border border-primary/25 bg-primary/[0.04]' : 'bg-secondary/40'}`}>
            <h3 className={`mb-2 text-[15px] font-bold ${tonight ? 'text-primary' : 'text-foreground'}`}>{s.title}</h3>
            <Md tonight={tonight}>{s.body}</Md>
          </section>
        );
      })}
      {p.notes && <p className="text-[12px] leading-relaxed text-muted-foreground">{p.notes}</p>}
      <Meta
        parts={[when(rep.done_at || rep.created_at), rep.sources.length ? `出典 ${rep.sources.length} 件` : null, modelLabel(rep.model)]}
        className="block"
      />
    </div>
  );
}

interface Props {
  guildId: string | null;
}

// タブを行き来しても読み込み中に戻らないよう、最後のフィードを覚えておく
let lastFeed: { guildId: string; feed: ResearchFeed } | null = null;

export const ResearchScreen: React.FC<Props> = ({ guildId }) => {
  const { toast } = useToast();
  const [feed, setFeedState] = useState<ResearchFeed | null>(() => (lastFeed && lastFeed.guildId === guildId ? lastFeed.feed : null));
  const setFeed = useCallback(
    (next: ResearchFeed | null | ((f: ResearchFeed | null) => ResearchFeed | null)) => {
      setFeedState((prev) => {
        const v = typeof next === 'function' ? next(prev) : next;
        if (v && guildId) lastFeed = { guildId, feed: v };
        return v;
      });
    },
    [guildId]
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [asking, setAsking] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    if (!guildId) return;
    setLoading(true);
    try {
      setFeed(await appApi.researchFeed(guildId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込めませんでした');
    } finally {
      setLoading(false);
    }
  }, [guildId, setFeed]);

  useEffect(() => {
    void load();
  }, [load]);

  // 調べ中のものがあれば 8 秒ごとに取り直す
  const running = feed?.reports.some((r) => r.status === 'running') ?? false;
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => void load(), 8000);
    return () => window.clearInterval(t);
  }, [running, load]);

  // 通知・Discord の埋め込みから（?tab=research&r=<id>）
  useEffect(() => {
    const id = takeResearchOpen();
    if (id != null) setOpenId(id);
    return onResearchOpen(setOpenId);
  }, []);

  // 一覧に無い古い調査は 1 件だけ取りに行く
  const [extra, setExtra] = useState<ResearchReport | null>(null);
  useEffect(() => {
    if (!guildId || openId == null || !feed || feed.reports.some((r) => r.id === openId) || extra?.id === openId) return;
    let alive = true;
    appApi
      .researchItem(guildId, openId)
      .then((r) => alive && setExtra(r))
      .catch(() => alive && setOpenId(null));
    return () => {
      alive = false;
    };
  }, [guildId, openId, feed, extra]);

  const ask = async () => {
    if (!guildId || q.trim().length < 2) return;
    setAsking(true);
    try {
      const rep = await appApi.researchAsk(guildId, q.trim());
      setFeed((f) => (f ? { ...f, reports: [rep, ...f.reports], questions_left: Math.max(0, f.questions_left - 1) } : f));
      setQ('');
      toast({ title: '調べ始めました', description: '1〜2 分でここに出ます' });
    } catch (e) {
      toast({ title: '調べられませんでした', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setAsking(false);
    }
  };

  if (!guildId) {
    return <p className="py-10 text-center text-sm text-muted-foreground">サーバーを選択すると、イリーナの調査が出ます</p>;
  }
  if (!feed) {
    // 読み込み中は案内（ツアー）を待たせ、読めなかったときだけ「空」として案内に飛ばしてもらう
    return error ? (
      <div className="flex flex-col items-center gap-3 py-16" data-tour="research-empty">
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>再読み込み</Button>
      </div>
    ) : (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="読み込み中" />
      </div>
    );
  }

  const reports = feed.reports;
  const latestDaily = reports.find((r) => r.kind === 'daily' && r.status === 'done');
  const dailyRunningAny = reports.some((r) => r.kind === 'daily' && r.status === 'running');
  const dailyRunning = !latestDaily && dailyRunningAny;
  const questions = reports.filter((r) => r.kind === 'question');
  const others = reports.filter((r) => r.kind !== 'question' && r.id !== latestDaily?.id && r.status === 'done');
  const open = openId != null ? reports.find((r) => r.id === openId) ?? (extra?.id === openId ? extra : null) : null;

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-background">
      <div className="mx-auto max-w-[860px] space-y-10 pb-10 pt-4 sm:pt-6">
        {/* 今日の調査 */}
        <section data-tour="research-daily">
          <SectionHeader
            title={latestDaily?.title || '今日の調査'}
            caption={dailyRunningAny && latestDaily ? '今日の分を調べています…' : '毎日 17:30 に更新'}
            action={
              <button type="button" onClick={() => void load()} className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary" aria-label="更新">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            }
          />
          <div className="px-4 sm:px-6">
            {latestDaily ? (
              <ReportBody rep={latestDaily} />
            ) : (
              <p className="flex items-center gap-2 rounded-2xl bg-secondary/40 p-4 text-[15px] text-muted-foreground">
                {dailyRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-primary" />
                    イリーナがいま調べています（1〜2 分）
                  </>
                ) : (
                  'まだありません。毎日 17:30 にできます'
                )}
              </p>
            )}
          </div>
        </section>

        {/* 質問 */}
        <section data-tour="research-ask">
          <SectionHeader title="イリーナに調べてもらう" caption={`今日はあと ${feed.questions_left} 回`} />
          <div className="space-y-3 px-4 sm:px-6">
            <div className="flex items-end gap-2 rounded-2xl border border-border bg-card p-2 pl-4 focus-within:border-primary/50">
              <textarea
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void ask();
                }}
                rows={2}
                maxLength={500}
                placeholder="何でも聞いて（ゲーム・大会・新作・曲…）"
                aria-label="調べてほしいこと"
                className="min-h-[48px] flex-1 resize-none bg-transparent py-1.5 text-[15px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
              />
              <Button
                onClick={() => void ask()}
                disabled={asking || q.trim().length < 2 || feed.questions_left <= 0}
                className="h-11 flex-shrink-0 rounded-full bg-primary px-4 text-[14px] font-semibold text-white hover:bg-primary/90"
              >
                {asking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                <span className="ml-1.5">調べる</span>
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((x) => (
                <button
                  key={x}
                  type="button"
                  onClick={() => {
                    setQ(x);
                    inputRef.current?.focus();
                  }}
                  className="h-9 rounded-full bg-secondary/70 px-3.5 text-[13px] font-medium text-foreground/75 hover:text-foreground"
                >
                  {x}
                </button>
              ))}
            </div>
            {questions.length > 0 && (
              <ul className="divide-y divide-border/60" aria-label="みんなの質問">
                {questions.slice(0, 12).map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => r.status === 'done' && setOpenId(r.id)}
                      disabled={r.status !== 'done'}
                      className="flex min-h-[56px] w-full items-center gap-3 py-2.5 text-left disabled:cursor-default"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-foreground">{r.question || r.title}</span>
                        <Meta
                          parts={[
                            r.asked_by_name,
                            r.status === 'running' ? (
                              <span key="s" className="font-medium text-primary">調べ中…</span>
                            ) : r.status === 'failed' ? (
                              '調べられませんでした（回数には数えません）'
                            ) : (
                              when(r.done_at || r.created_at)
                            ),
                          ]}
                          className="block truncate"
                        />
                      </span>
                      {r.status === 'running' && <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-primary" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* ほかの調査 */}
        {others.length > 0 && (
          <section>
            <SectionHeader title="これまでの調査" />
            <ul className="divide-y divide-border/60 px-4 sm:px-6">
              {others.slice(0, 20).map((r) => {
                const p = parse(r.markdown || '');
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => setOpenId(r.id)} className="flex min-h-[56px] w-full items-center gap-3 py-2.5 text-left">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-semibold text-foreground">{r.title || KIND_LABEL[r.kind] || '調査'}</span>
                        <Meta parts={[KIND_LABEL[r.kind], p.sections.map((s) => s.title).slice(0, 3).join('・')]} className="block truncate" />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      <ResponsiveSheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)} title={open?.question || open?.title || ''} dataTour="research-detail">
        {open && (
          <div className="px-5 pb-6 pt-4">
            <ReportBody rep={open} />
          </div>
        )}
      </ResponsiveSheet>
    </div>
  );
};

export default ResearchScreen;
