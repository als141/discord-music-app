'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { ExternalLink, Loader2, PlayCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { ScrollRow } from '@/components/home/ScrollRow';
import { useIsDesktop } from '@/hooks/use-media-query';
import { useToast } from '@/hooks/use-toast';
import { appApi, GameBoard, GameCard, GameOffer, SceneFresh } from '@/lib/app-api';
import { SteamLinkCard } from './SteamLinkCard';
import { AvatarStack, Hero, Meta, RankList, RankRow, SectionHeader, SubHeader } from './ui';

/**
 * 「ゲーム置き場」タブ。曲置き場（ShelfScreen）と同じ部品（./ui）・同じ骨組み（いま → 界隈 → みんなが貼った）で対になる。
 *
 * 並びは場面で変える:
 *   VC に 2 人以上 → いま → 今夜どれ？（その人数。1 位を大きく＋2〜6 位）→ 期限つき → 界隈で話題（順位）→ 最近遊ばれた → みんなが貼った
 *   それ以外       → いま（1 行）→ 界隈で話題（1 位を大きく＋順位）→ 今夜どれ？ → 期限つき → 最近遊ばれた → みんなが貼った
 * 大きなカード（Hero）は 1 画面に 1 つだけ。データは `GET /games/{guild}/board`（本人のトークン）を 60 秒キャッシュ
 */

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; data: GameBoard }>();
const PLAYER_CHOICES = [2, 3, 4, 5, 6, 8];

type Filter = 'all' | 'coop' | 'pvp' | 'big' | 'sale' | 'free' | 'soon';
const FILTERS: { id: Filter; label: string; test: (g: GameCard) => boolean }[] = [
  { id: 'all', label: 'すべて', test: () => true },
  { id: 'coop', label: '協力', test: (g) => g.modes.includes('online_coop') },
  { id: 'pvp', label: '対戦', test: (g) => g.modes.includes('online_pvp') },
  { id: 'big', label: '5人以上', test: (g) => (g.players.max ?? 0) >= 5 },
  { id: 'sale', label: 'セール中', test: (g) => g.price.discount > 0 },
  { id: 'free', label: '無料', test: (g) => g.price.free || g.price.final === 0 },
  { id: 'soon', label: '発売前', test: (g) => g.release.soon },
];

// ---------------------------------------------------------------- 文字の整形

function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const min = Math.floor((Date.now() - t) / 60000);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}時間前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}日前`;
  const dt = new Date(t);
  return `${dt.getMonth() + 1}/${dt.getDate()}`;
}

function md(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()}`;
}

export function playersLabel(g: GameCard): string {
  const { min, max, best } = g.players;
  if (max && max >= 16) return `${max}人まで`;
  if (max && (min ?? 1) > 1 && min !== max) return `${min}〜${max}人`;
  if (max) return max === 1 ? 'ソロ' : `最大${max}人`;
  return best || '人数不明';
}

function modeLabel(modes: string[]): string {
  if (modes.includes('online_coop') && modes.includes('online_pvp')) return '協力・対戦';
  if (modes.includes('online_coop')) return '協力';
  if (modes.includes('online_pvp')) return '対戦';
  if (modes.includes('mmo')) return 'MMO';
  if (modes.includes('local_coop') || modes.includes('local_pvp')) return 'ローカル';
  return 'ソロ';
}

function priceText(g: GameCard): string {
  const p = g.price;
  if (p.free || p.final === 0) return '無料';
  if (p.final == null) return g.release.soon ? '発売前' : '';
  return p.discount > 0 ? `-${p.discount}% ¥${p.final.toLocaleString()}` : `¥${p.final.toLocaleString()}`;
}

/** 価格。セールはローズ、無料は緑、ふつうは補足色のまま */
function Price({ g }: { g: GameCard }) {
  const p = g.price;
  if (p.free || p.final === 0) return <span className="font-semibold text-green-600">無料</span>;
  if (p.final == null) return g.release.soon ? <span>発売前</span> : null;
  if (p.discount > 0)
    return (
      <span>
        <span className="font-semibold text-primary">
          -{p.discount}% ¥{p.final.toLocaleString()}
        </span>
        {p.initial ? <span className="ml-1 text-muted-foreground/70 line-through">¥{p.initial.toLocaleString()}</span> : null}
      </span>
    );
  return <span>¥{p.final.toLocaleString()}</span>;
}

function gameMeta(g: GameCard): React.ReactNode[] {
  return [playersLabel(g), modeLabel(g.modes), <Price key="p" g={g} />];
}

/** チャンネル名の「葛葉 / Kuzuha」「ローレン・イロアス【にじさんじ】」から日本語の呼び名だけ */
function cleanName(n: string): string {
  return n.split(/\s*[/／|｜【(（]\s*/)[0].trim() || n;
}

function names(list: string[], max = 2): string {
  return list.length > max ? `${list.slice(0, max).join('、')} ほか${list.length - max}人` : list.join('、');
}

function fmtViews(n: number): string {
  return n >= 10000 ? `${Math.round(n / 10000).toLocaleString()}万回` : `${n.toLocaleString()}回`;
}

/** why（backend の理由）のうち、人数・モード・価格と重なるものは出さない */
const META_WHY = /^(最大\d+人|\d+人まで|協力|対戦|¥[\d,]+|\d+%オフ.*|無料)$/;

type Members = GameBoard['members'];

function memberImages(ids: string[], members: Members): string[] {
  return ids.map((id) => members[id]?.image || `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(id) >> BigInt(22)) % 6}.png`);
}

// ---------------------------------------------------------------- カード

function Thumb({ src, alt, className = '' }: { src: string | null; alt: string; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-xl bg-secondary ${className}`} style={{ aspectRatio: '460 / 215' }}>
      {src && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
      )}
    </div>
  );
}

/** 横に流れるカード。3 行（名前・一言・人数と価格）で揃える */
function GameTile({ g, below, onOpen, anchor, wide = false }: { g: GameCard; below?: React.ReactNode; onOpen: (g: GameCard) => void; anchor?: string; wide?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(g)}
      data-tour={anchor}
      className={`group self-start text-left ${wide ? 'w-full' : 'w-[240px] min-w-[240px]'}`}
      aria-label={`${g.name} の詳細`}
    >
      <Thumb src={g.image} alt={g.name} className="mb-2" />
      <h3 className="truncate text-[15px] font-semibold leading-snug text-foreground">{g.name}</h3>
      <p className="truncate text-[13px] leading-snug text-muted-foreground">{g.hook}</p>
      <Meta parts={gameMeta(g)} className="mt-0.5 block truncate" />
      {below}
    </button>
  );
}

function OfferTile({ o, game, onOpen }: { o: GameOffer; game?: GameCard; onOpen: (g: GameCard) => void }) {
  const until = o.active ? `${md(o.ends_at)} まで無料` : `${md(o.starts_at)} から無料`;
  const body = (
    <>
      <div className="relative mb-2 overflow-hidden rounded-xl bg-secondary" style={{ aspectRatio: '460 / 215' }}>
        {o.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={o.image} alt={o.title} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        )}
      </div>
      <h3 className="truncate text-[15px] font-semibold leading-snug text-foreground">{o.title}</h3>
      <Meta
        parts={[<span key="u" className={o.active ? 'font-semibold text-green-600' : ''}>{o.source === 'epic' ? 'Epic' : o.source} {until}</span>, game ? playersLabel(game) : null]}
        className="block truncate"
      />
    </>
  );
  return game ? (
    <button type="button" onClick={() => onOpen(game)} className="group w-[240px] min-w-[240px] self-start text-left">
      {body}
    </button>
  ) : (
    <a href={o.url || '#'} target="_blank" rel="noopener noreferrer" className="group block w-[240px] min-w-[240px] self-start">
      {body}
    </a>
  );
}

// ---------------------------------------------------------------- 詳細

type SceneExtra = { articles: SceneFresh['articles']; streamers: string[]; streamerImages: (string | null)[]; jikkyou: SceneFresh['jikkyou'] };

function SceneDetail({ x }: { x: SceneExtra }) {
  if (!x.articles.length && !x.streamers.length && !x.jikkyou?.top_video) return null;
  return (
    <div className="space-y-2.5">
      <p className="text-[13px] font-semibold text-muted-foreground">界隈では</p>
      {x.streamers.length > 0 && (
        <div className="flex items-center gap-2.5">
          <AvatarStack images={x.streamerImages} size={26} max={5} />
          <p className="min-w-0 text-[13px] text-foreground/85">{names(x.streamers.map(cleanName), 3)} が今週配信</p>
        </div>
      )}
      {x.jikkyou?.top_video && (
        <a href={`https://www.youtube.com/watch?v=${x.jikkyou.top_video}`} target="_blank" rel="noopener noreferrer" className="flex items-start gap-2.5 text-foreground/85 hover:text-foreground">
          <PlayCircle className="mt-0.5 h-[18px] w-[18px] flex-shrink-0 text-primary" />
          <span className="min-w-0">
            <span className="block text-[13px]">日本語の実況 {x.jikkyou.videos} 本・{fmtViews(x.jikkyou.views)}（2 週間）</span>
            <span className="block truncate text-[13px] text-muted-foreground">{x.jikkyou.top_title}</span>
          </span>
        </a>
      )}
      {x.articles.map((a) => (
        <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer" className="block text-[13px] leading-snug text-foreground/85 hover:text-foreground">
          <span className="mr-1.5 font-semibold text-muted-foreground">{a.src}</span>
          {a.title}
        </a>
      ))}
    </div>
  );
}

function GameDetail({ g, board, myId, onMark, busy, extra }: { g: GameCard; board: GameBoard; myId: string | null; onMark: (kind: 'want' | 'own', on: boolean) => void; busy: boolean; extra?: SceneExtra }) {
  const isDesktop = useIsDesktop();
  const m = board.members;
  const posted = g.posted.by ? m[g.posted.by]?.name : null;
  const iWant = !!myId && g.want.includes(myId);
  const iOwn = !!myId && g.own.includes(myId);
  const vibe = g.vibe.filter((v) => v !== modeLabel(g.modes) && !['協力', '対戦'].includes(v)).slice(0, 2);
  const people: [string[], string][] = [
    [g.playing_now, 'いまプレイ中'],
    [g.played, `最近遊んだ${g.last_played_at ? `（${timeAgo(g.last_played_at)}）` : ''}`],
    [g.own, '持ってる'],
    [g.want, 'やりたい'],
  ];
  return (
    <div className="space-y-5 px-5 pt-4">
      <div>
        <Thumb src={g.image} alt={g.name} />
        <p className="mt-3 text-[15px] leading-relaxed text-foreground">{g.hook}</p>
        <Meta parts={[playersLabel(g), modeLabel(g.modes), ...vibe]} className="mt-1 block" />
      </div>
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-secondary/60 p-3">
          <dt className="text-[12px] text-muted-foreground">価格</dt>
          <dd className="mt-0.5 text-[15px]">
            <Price g={g} />
          </dd>
          {g.price.lowest != null && g.price.final != null && g.price.lowest < g.price.final && (
            <dd className="mt-0.5 text-[12px] text-muted-foreground">記録上の最安 ¥{g.price.lowest.toLocaleString()}</dd>
          )}
        </div>
        <div className="rounded-xl bg-secondary/60 p-3">
          <dt className="text-[12px] text-muted-foreground">{g.release.soon ? '発売' : '評価'}</dt>
          <dd className="mt-0.5 text-[15px] font-semibold text-foreground">
            {g.release.soon ? g.release.text || '未定' : g.review.desc || '—'}
            {!g.release.soon && g.review.pct != null && <span className="ml-1 text-[13px] font-normal text-muted-foreground">{g.review.pct}%</span>}
          </dd>
          {g.live_players != null && !g.release.soon && (
            <dd className="mt-0.5 text-[12px] text-muted-foreground">Steam で今 {g.live_players.toLocaleString()} 人</dd>
          )}
        </div>
      </dl>
      {extra && <SceneDetail x={extra} />}
      {people.some(([ids]) => ids.length) && (
        <div className="space-y-2">
          {people.map(([ids, label]) =>
            ids.length ? (
              <p key={label} className="flex items-center gap-2.5 text-[13px] text-foreground/85">
                <AvatarStack images={memberImages(ids, m)} size={24} max={6} />
                {label}
              </p>
            ) : null
          )}
        </div>
      )}
      {g.news.length > 0 && (
        <div className="space-y-2">
          {g.news.map((n, i) => (
            <p key={i} className="text-[13px] leading-relaxed text-muted-foreground">{n}</p>
          ))}
        </div>
      )}
      {posted && (
        <p className="text-[12px] text-muted-foreground">
          {posted} が置いた{g.posted.at ? `（${md(g.posted.at)}）` : ''}
          {g.posted.count > 1 ? `・${g.posted.count} 回貼られた` : ''}
        </p>
      )}
      {/* 操作は下に固定（長い詳細をスクロールしなくても押せる） */}
      <div className="sticky bottom-0 -mx-5 flex flex-wrap gap-2 border-t border-border/70 bg-background/95 px-5 py-3 backdrop-blur">
        <Button
          size="sm"
          variant={iWant ? 'default' : 'outline'}
          className={`h-10 rounded-full px-5 text-[13px] font-semibold ${iWant ? 'bg-primary text-white hover:bg-primary/90' : ''}`}
          disabled={busy || !myId}
          onClick={() => onMark('want', !iWant)}
          aria-pressed={iWant}
        >
          やりたい
        </Button>
        <Button
          size="sm"
          variant={iOwn ? 'default' : 'outline'}
          className={`h-10 rounded-full px-5 text-[13px] font-semibold ${iOwn ? 'bg-foreground text-background hover:bg-foreground/90' : ''}`}
          disabled={busy || !myId}
          onClick={() => onMark('own', !iOwn)}
          aria-pressed={iOwn}
        >
          持ってる
        </Button>
        <Button asChild size="sm" variant="ghost" className="h-10 rounded-full px-3 text-[13px]">
          <a href={isDesktop ? `steam://store/${g.appid}` : g.store_url} target={isDesktop ? undefined : '_blank'} rel="noopener noreferrer">
            <ExternalLink className="mr-1.5 h-4 w-4" />
            Steam で見る
          </a>
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- 画面

interface Props {
  guildId: string | null;
}

export const GameShelfScreen: React.FC<Props> = ({ guildId }) => {
  const { data: session } = useSession();
  const myId = (session?.user as { id?: string } | undefined)?.id ?? null;
  const { toast } = useToast();
  const [board, setBoard] = useState<GameBoard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [players, setPlayers] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reqRef = useRef(0);

  const load = useCallback(
    async (force = false) => {
      if (!guildId) return;
      const key = `${guildId}:${players ?? ''}`;
      const hit = cache.get(key);
      if (!force && hit && Date.now() - hit.at < CACHE_MS) {
        setBoard(hit.data);
        return;
      }
      const seq = ++reqRef.current;
      setLoading(true);
      try {
        const data = await appApi.gameBoard(guildId, players ?? undefined);
        if (seq !== reqRef.current) return;
        cache.set(key, { at: Date.now(), data });
        setBoard(data);
        setError(null);
      } catch (e) {
        if (seq !== reqRef.current) return;
        setError(e instanceof Error ? e.message : '読み込めませんでした');
      } finally {
        if (seq === reqRef.current) setLoading(false);
      }
    },
    [guildId, players]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [load]);

  const byId = useMemo(() => {
    const map = new Map((board?.games ?? []).map((g) => [g.appid, g]));
    // 界隈のゲーム（置き場に無いもの）も詳しく見られるように
    for (const e of board?.scene?.fresh ?? []) if (!map.has(e.appid)) map.set(e.appid, e.card);
    for (const e of board?.scene?.streamers ?? []) if (e.card && !map.has(e.card.appid)) map.set(e.card.appid, e.card);
    return map;
  }, [board]);
  const open = openId ? byId.get(openId) ?? null : null;
  const openExtra = useMemo((): SceneExtra | undefined => {
    if (!openId || !board?.scene) return undefined;
    const f = board.scene.fresh.find((e) => e.appid === openId);
    const st = board.scene.streamers.find((e) => e.appid === openId);
    if (!f && !st) return undefined;
    const chans = st?.channels ?? [];
    return {
      articles: f?.articles ?? [],
      streamers: f?.streamers.length ? f.streamers : chans.map((c) => c.name),
      streamerImages: chans.map((c) => c.image ?? null),
      jikkyou: f?.jikkyou ?? null,
    };
  }, [openId, board]);

  const onMark = async (kind: 'want' | 'own', on: boolean) => {
    if (!guildId || !open) return;
    setBusy(true);
    try {
      const r = await appApi.markGame(guildId, open.appid, kind, on);
      const patch = (c: GameCard) => (c.appid === r.appid ? { ...c, want: r.want, own: r.own } : c);
      setBoard((b) =>
        b
          ? {
              ...b,
              games: b.games.map(patch),
              scene: b.scene
                ? {
                    ...b.scene,
                    fresh: b.scene.fresh.map((e) => ({ ...e, card: patch(e.card) })),
                    streamers: b.scene.streamers.map((e) => (e.card ? { ...e, card: patch(e.card) } : e)),
                  }
                : b.scene,
            }
          : b
      );
      cache.clear();
    } catch (e) {
      toast({ title: '保存できませんでした', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  if (!guildId) {
    return <p className="py-10 text-center text-sm text-muted-foreground" data-tour="games-empty">サーバーを選択すると、ゲーム置き場が出ます</p>;
  }
  if (!board) {
    return (
      <div className="flex flex-col items-center gap-3 py-16" data-tour="games-empty">
        {error ? (
          <>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void load(true)}>再読み込み</Button>
          </>
        ) : (
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        )}
      </div>
    );
  }

  const m = board.members;
  const openGame = (g: GameCard) => setOpenId(g.appid);
  const voiceIds = board.now.voice.map((v) => v.user_id);
  const vcNames = Array.from(new Set(board.now.voice.map((v) => v.channel).filter(Boolean)));
  const picks = board.tonight.picks.map((p) => ({ ...p, g: byId.get(p.appid) })).filter((p) => p.g) as { appid: string; why: string[]; g: GameCard }[];
  const sales = board.deadlines.sales.map((a) => byId.get(a)).filter(Boolean) as GameCard[];
  const releases = board.deadlines.releases.map((r) => ({ ...r, g: byId.get(r.appid) })).filter((r) => r.g) as { appid: string; date: string; released: boolean; g: GameCard }[];
  const f = FILTERS.find((x) => x.id === filter)!;
  const shelfGames = board.games.filter((g) => g.posted.count > 0);
  const list = shelfGames.filter((g) => f.test(g));
  const scene = board.scene;
  const n = players ?? board.tonight.players;
  // VC に 2 人以上いる＝「今夜なにやる？」の場面。答え（今夜どれ？）を一番上に、大きなカードもそこに使う
  const gathered = voiceIds.length >= 2;
  const lastPlayed = board.recent[0];
  const rowPad = <div className="w-0.5 flex-shrink-0 sm:w-2" aria-hidden="true" />;
  const refresh = (
    <button type="button" onClick={() => void load(true)} className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background" aria-label="更新">
      <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
    </button>
  );

  // ---- いま
  const nowSection = (
    <section className="px-4 sm:px-6" data-tour="games-now" key="now">
      <div className="flex items-center gap-3 rounded-2xl bg-secondary/60 py-2 pl-4 pr-1.5">
        {voiceIds.length > 0 && <AvatarStack images={memberImages(voiceIds, m)} size={30} max={6} />}
        <div className="min-w-0 flex-1 py-1">
          <p className="truncate text-[15px] font-semibold text-foreground">
            {voiceIds.length ? `${vcNames.join('・')} に ${voiceIds.length} 人` : 'VC は空いています'}
          </p>
          {board.now.playing.length > 0 ? (
            <p className="truncate text-[13px] text-muted-foreground">
              {board.now.playing.map((p, i) => {
                const g = p.appid ? byId.get(p.appid) : undefined;
                return (
                  <React.Fragment key={p.appid || p.game_name}>
                    {i > 0 && ' · '}
                    {g ? (
                      <button type="button" onClick={() => openGame(g)} className="font-medium text-foreground/80 underline-offset-2 hover:underline">
                        {p.game_name}
                      </button>
                    ) : (
                      <span className="font-medium text-foreground/80">{p.game_name}</span>
                    )}{' '}
                    {p.users.length}人
                  </React.Fragment>
                );
              })}{' '}
              をプレイ中
            </p>
          ) : (
            !voiceIds.length &&
            lastPlayed && (
              <p className="truncate text-[13px] text-muted-foreground">
                最後は {lastPlayed.game_name}（{timeAgo(lastPlayed.last_at)}）
              </p>
            )
          )}
        </div>
        {refresh}
      </div>
    </section>
  );

  // ---- 人数のチップ
  const playerChips = (
    <div className="mb-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:px-6" role="group" aria-label="人数">
      {PLAYER_CHOICES.map((k) => {
        const active = n === k;
        return (
          <button
            key={k}
            type="button"
            onClick={() => setPlayers(k)}
            aria-pressed={active}
            className={`h-9 flex-shrink-0 rounded-full px-4 text-[13px] font-semibold transition-colors ${
              active ? 'bg-foreground text-background' : 'bg-secondary/70 text-foreground/70 hover:text-foreground'
            }`}
          >
            {k === 8 ? '8人+' : `${k}人`}
          </button>
        );
      })}
    </div>
  );

  const pickReasons = (p: { why: string[] }) => p.why.filter((w) => !META_WHY.test(w)).slice(0, 2);

  // ---- 今夜どれ？
  const tonightSection = (
    <section data-tour="games-tonight" key="tonight">
      <SectionHeader title="今夜どれ？" caption={board.tonight.from_voice && players === null ? `VC の ${n} 人で` : `${n} 人で`} />
      {playerChips}
      {!picks.length ? (
        <p className="px-4 text-[13px] text-muted-foreground sm:px-6">{n} 人で遊べるゲームは置き場にまだありません</p>
      ) : gathered ? (
        <div className="px-4 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start lg:gap-6">
          <Hero
            image={picks[0].g.image}
            kicker={`${n} 人ならこれ`}
            title={picks[0].g.name}
            fact={[...pickReasons(picks[0]), playersLabel(picks[0].g), modeLabel(picks[0].g.modes), priceText(picks[0].g)].filter(Boolean).join(' · ')}
            onClick={() => openGame(picks[0].g)}
            anchor="games-first-pick"
          />
          <div className="-mx-4 mt-2 sm:mx-0 lg:mt-0">
            <RankList ariaLabel="今夜の候補">
              {picks.slice(1, 6).map((p, i) => {
                const people = Array.from(new Set([...p.g.playing_now, ...p.g.played, ...p.g.own]));
                return (
                  <RankRow
                    key={p.appid}
                    rank={i + 2}
                    thumb={p.g.image}
                    title={p.g.name}
                    meta={<Meta parts={[...pickReasons(p), ...gameMeta(p.g)]} />}
                    right={people.length ? <AvatarStack images={memberImages(people, m)} size={22} max={3} /> : undefined}
                    onClick={() => openGame(p.g)}
                  />
                );
              })}
            </RankList>
          </div>
        </div>
      ) : (
        <ScrollRow className="gap-4" ariaLabel="今夜の候補">
          {rowPad}
          {picks.map((p, i) => {
            const people = Array.from(new Set([...p.g.playing_now, ...p.g.played, ...p.g.own]));
            const r = pickReasons(p);
            return (
              <GameTile
                key={p.appid}
                g={p.g}
                onOpen={openGame}
                anchor={i === 0 ? 'games-first-pick' : undefined}
                below={
                  (people.length > 0 || r.length > 0) && (
                    <span className="mt-1 flex items-center gap-2">
                      {people.length > 0 && <AvatarStack images={memberImages(people, m)} size={20} max={3} />}
                      {r.length > 0 && <span className="truncate text-[13px] font-medium text-foreground/80">{r.join(' · ')}</span>}
                    </span>
                  )
                }
              />
            );
          })}
          {rowPad}
        </ScrollRow>
      )}
    </section>
  );

  // ---- 界隈で話題
  const fresh = scene?.fresh ?? [];
  const streamers = scene?.streamers ?? [];
  const freshHero = !gathered && fresh.length > 0 ? fresh[0] : null;
  const freshRows = freshHero ? fresh.slice(1, 7) : fresh.slice(0, 6);
  const freshMeta = (e: SceneFresh) => <Meta parts={[<span key="b" className="font-medium text-foreground/80">{e.badges[0]}</span>, playersLabel(e.card), <Price key="p" g={e.card} />]} />;
  const streamerList = streamers.length > 0 && (
    <div>
      <SubHeader>配信者がいまやってる</SubHeader>
      <RankList ariaLabel="配信者がいまやってるゲーム">
        {streamers.slice(0, 6).map((e, i) => {
          const who = e.channels.map((c) => cleanName(c.name));
          const common = {
            rank: i + 1,
            thumb: e.image,
            title: e.name,
            meta: <Meta parts={[`${who.length}人`, names(who, 2)]} />,
            right: <AvatarStack images={e.channels.map((c) => c.image)} size={24} max={3} label={`配信者 ${who.length} 人`} />,
            anchor: i === 0 ? 'games-scene-first' : undefined,
            ariaLabel: `${e.name}（配信者 ${who.length} 人）`,
          };
          return e.card ? (
            <RankRow key={e.key} {...common} onClick={() => openGame(e.card!)} />
          ) : (
            <RankRow key={e.key} {...common} href={e.top ? `https://www.youtube.com/watch?v=${e.top.video_id}` : undefined} />
          );
        })}
      </RankList>
    </div>
  );
  const sceneSection = scene && (fresh.length > 0 || streamers.length > 0) && (
    <section data-tour="games-scene" key="scene">
      <SectionHeader title="界隈で話題" caption="配信者・ゲームメディア・Steam から" />
      <div className={gathered ? 'lg:grid lg:grid-cols-2 lg:gap-6 lg:px-2' : ''}>
        {fresh.length > 0 && (
          <div aria-label="話題の新作・インディー" className={freshHero ? 'px-4 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start lg:gap-6' : ''}>
            {freshHero && (
              <Hero
                image={freshHero.card.image}
                kicker="界隈でいま話題"
                title={freshHero.card.name}
                fact={[...freshHero.badges.slice(0, 2), playersLabel(freshHero.card), priceText(freshHero.card)].filter(Boolean).join(' · ')}
                onClick={() => openGame(freshHero.card)}
              />
            )}
            <div className={freshHero ? '-mx-4 mt-2 sm:mx-0 lg:mt-0' : ''}>
              {!freshHero && <SubHeader>話題の新作・インディー</SubHeader>}
              <RankList>
                {freshRows.map((e, i) => (
                  <RankRow key={e.key} rank={i + (freshHero ? 2 : 1)} thumb={e.card.image} title={e.card.name} meta={freshMeta(e)} onClick={() => openGame(e.card)} />
                ))}
              </RankList>
            </div>
          </div>
        )}
        <div className={gathered ? '' : 'mt-6'}>{streamerList}</div>
      </div>
    </section>
  );

  // ---- 期限つき
  const deadlinesSection = (board.deadlines.offers.length > 0 || sales.length > 0 || releases.length > 0) && (
    <section data-tour="games-deadlines" key="deadlines">
      <SectionHeader title="期限つき" caption="無料配布・セール・発売" />
      <ScrollRow className="gap-4" ariaLabel="無料配布・セール・発売">
        {rowPad}
        {board.deadlines.offers.map((o) => (
          <OfferTile key={o.id} o={o} game={o.appid ? byId.get(o.appid) : undefined} onOpen={openGame} />
        ))}
        {sales.map((g) => (
          <GameTile key={`sale-${g.appid}`} g={g} onOpen={openGame} />
        ))}
        {releases.map((r) => (
          <GameTile
            key={`rel-${r.appid}`}
            g={r.g}
            onOpen={openGame}
            below={<span className="mt-0.5 block text-[13px] font-semibold text-primary">{r.released ? `${md(r.date)} に発売` : `${md(r.date)} 発売`}</span>}
          />
        ))}
        {rowPad}
      </ScrollRow>
    </section>
  );

  // ---- 最近ドデカで遊ばれた
  const recentSection = board.recent.length > 0 && (
    <section key="recent">
      <SectionHeader title="最近ドデカで遊ばれた" />
      <RankList>
        {board.recent.slice(0, 6).map((r) => {
          const g = r.appid ? byId.get(r.appid) : undefined;
          return (
            <RankRow
              key={r.appid || r.game_name}
              thumb={g?.image ?? null}
              title={r.game_name}
              meta={<Meta parts={[timeAgo(r.last_at), r.minutes ? `${Math.round(r.minutes / 6) / 10} 時間` : null]} />}
              right={<AvatarStack images={memberImages(r.users, m)} size={24} max={4} />}
              onClick={g ? () => openGame(g) : undefined}
            />
          );
        })}
      </RankList>
    </section>
  );

  // ---- みんなが貼った
  const allSection = (
    <section data-tour="games-all" key="all">
      <SectionHeader title="みんなが貼った" caption={`${shelfGames.length} 本`} action={<SteamLinkCard onChanged={() => { cache.clear(); void load(true); }} />} />
      <div className="mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:px-6" role="group" aria-label="絞り込み" data-tour="games-filters">
        {FILTERS.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => setFilter(x.id)}
            aria-pressed={filter === x.id}
            className={`h-9 flex-shrink-0 rounded-full px-3.5 text-[13px] font-medium transition-colors ${
              filter === x.id ? 'bg-foreground text-background' : 'bg-secondary/70 text-foreground/70 hover:text-foreground'
            }`}
          >
            {x.label} <span className="tabular-nums opacity-60">{shelfGames.filter((g) => x.test(g)).length}</span>
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-6 px-4 sm:grid-cols-3 sm:gap-x-5 sm:px-6 md:grid-cols-4 xl:grid-cols-5">
        {list.map((g, i) => {
          const people = Array.from(new Set([...g.playing_now, ...g.played]));
          const who = people.length ? people : g.want;
          return (
            <GameTile
              key={g.appid}
              g={g}
              wide
              onOpen={openGame}
              anchor={i === 0 ? 'games-first-card' : undefined}
              below={
                who.length > 0 && (
                  <span className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
                    <AvatarStack images={memberImages(who, m)} size={18} max={4} />
                    {g.playing_now.length ? 'プレイ中' : people.length ? '遊んだ' : 'やりたい'}
                  </span>
                )
              }
            />
          );
        })}
      </div>
      {list.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-muted-foreground sm:px-6">該当するゲームはありません</p>}
    </section>
  );

  const order = gathered
    ? [nowSection, tonightSection, deadlinesSection, sceneSection, recentSection, allSection]
    : [nowSection, sceneSection, tonightSection, deadlinesSection, recentSection, allSection];

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-background">
      <div className="mx-auto max-w-[1280px] space-y-10 pb-10 pt-4 sm:pt-6">{order}</div>

      <ResponsiveSheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)} title={open?.name ?? ''} dataTour="game-detail">
        {open && <GameDetail g={open} board={board} myId={myId} onMark={onMark} busy={busy} extra={openExtra} />}
      </ResponsiveSheet>
    </div>
  );
};

export default GameShelfScreen;
