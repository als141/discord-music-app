'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Clock, ExternalLink, Gift, Info, Loader2, RefreshCw, Swords, Tag, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { ScrollRow } from '@/components/home/ScrollRow';
import { useIsDesktop } from '@/hooks/use-media-query';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';
import { appApi, GameBoard, GameCard, GameOffer, SteamLink } from '@/lib/app-api';

/**
 * 「ゲーム置き場」タブ。#ゲーム置き場 に貼られたゲームを、ドデカの「いま」に結びつけて見せる。
 *
 * 上から: いま（VC とプレイ中）→ 今夜どれ？（人数で絞った候補）→ 期限つき（無料配布・セール・発売）
 *        → 最近ドデカで遊ばれた → 置き場（全部・絞り込み）。カードを押すと詳しい情報とボタン
 * データは `GET /games/{guild}/board`（本人のトークン）。60 秒だけメモリにキャッシュ
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

function priceLabel(g: GameCard): { text: string; old?: string; tone: 'free' | 'sale' | 'normal' | 'muted' } {
  const p = g.price;
  if (p.free || p.final === 0) return { text: '無料', tone: 'free' };
  if (p.final == null) return { text: g.release.soon ? '発売前' : '価格不明', tone: 'muted' };
  if (p.discount > 0) return { text: `-${p.discount}% ¥${p.final.toLocaleString()}`, old: p.initial ? `¥${p.initial.toLocaleString()}` : undefined, tone: 'sale' };
  return { text: `¥${p.final.toLocaleString()}`, tone: 'normal' };
}

function modeLabel(modes: string[]): string {
  if (modes.includes('online_coop') && modes.includes('online_pvp')) return '協力・対戦';
  if (modes.includes('online_coop')) return '協力';
  if (modes.includes('online_pvp')) return '対戦';
  if (modes.includes('mmo')) return 'MMO';
  if (modes.includes('local_coop') || modes.includes('local_pvp')) return 'ローカル';
  return 'ソロ';
}

type Members = GameBoard['members'];

function Avatars({ ids, members, size = 20, max = 5 }: { ids: string[]; members: Members; size?: number; max?: number }) {
  if (!ids.length) return null;
  const shown = ids.slice(0, max);
  return (
    <span className="inline-flex items-center">
      {shown.map((id, i) => {
        const m = members[id];
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={id}
            src={m?.image || `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(id) >> BigInt(22)) % 6}.png`}
            alt={m?.name || ''}
            title={m?.name || ''}
            width={size}
            height={size}
            className="rounded-full border-2 border-background bg-secondary object-cover"
            style={{ width: size, height: size, marginLeft: i ? -size / 3 : 0 }}
          />
        );
      })}
      {ids.length > max && <span className="ml-1 text-[11px] text-muted-foreground">+{ids.length - max}</span>}
    </span>
  );
}

function SectionTitle({ icon, title, aside }: { icon: React.ReactNode; title: string; aside?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3 px-4 sm:px-6">
      <h2 className="flex items-center gap-2 text-[17px] font-bold tracking-tight text-foreground">
        <span className="text-primary">{icon}</span>
        {title}
      </h2>
      {aside}
    </div>
  );
}

function GameImage({ g, className = '' }: { g: GameCard | { image: string | null; name: string }; className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded-xl bg-secondary ${className}`} style={{ aspectRatio: '460 / 215' }}>
      {g.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={g.image} alt={g.name} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
      )}
    </div>
  );
}

function PriceTag({ g }: { g: GameCard }) {
  const p = priceLabel(g);
  const cls = { free: 'bg-green-600 text-white', sale: 'bg-primary text-white', normal: 'bg-secondary text-foreground', muted: 'bg-secondary text-muted-foreground' }[p.tone];
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${cls}`}>{p.text}</span>
      {p.old && <span className="text-[11px] text-muted-foreground line-through">{p.old}</span>}
    </span>
  );
}

function Chip({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'accent' | 'ok' }) {
  const cls = { muted: 'bg-secondary text-foreground/75', accent: 'bg-primary/10 text-primary', ok: 'bg-green-500/12 text-green-700' }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

function GridCard({ g, members, onOpen, anchor }: { g: GameCard; members: Members; onOpen: (g: GameCard) => void; anchor?: string }) {
  const people = Array.from(new Set([...g.playing_now, ...g.played]));
  return (
    <button type="button" onClick={() => onOpen(g)} data-tour={anchor} className="group w-full self-start text-left" aria-label={`${g.name} の詳細`}>
      <GameImage g={g} className="mb-2 transition-transform duration-300 group-hover:scale-[1.02]" />
      <div className="px-0.5">
        <h3 className="line-clamp-1 text-[13.5px] font-semibold text-foreground">{g.name}</h3>
        <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground">{g.hook}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Chip tone="accent">
            <Users className="h-3 w-3" />
            {playersLabel(g)}
          </Chip>
          <Chip>{modeLabel(g.modes)}</Chip>
          <PriceTag g={g} />
        </div>
        {(people.length > 0 || g.want.length > 0) && (
          <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Avatars ids={people.length ? people : g.want} members={members} size={18} />
            <span>{g.playing_now.length ? 'プレイ中' : people.length ? '遊んだ' : 'やりたい'}</span>
          </div>
        )}
      </div>
    </button>
  );
}

function PickCard({ g, why, members, onOpen, anchor }: { g: GameCard; why: string[]; members: Members; onOpen: (g: GameCard) => void; anchor?: string }) {
  const people = Array.from(new Set([...g.playing_now, ...g.played, ...g.own]));
  return (
    <button type="button" onClick={() => onOpen(g)} data-tour={anchor} className="group w-[230px] min-w-[230px] text-left sm:w-[260px] sm:min-w-[260px]">
      <GameImage g={g} className="mb-2" />
      <h3 className="line-clamp-1 text-[14px] font-semibold text-foreground">{g.name}</h3>
      <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-muted-foreground">{g.hook}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {why.slice(0, 4).map((w) => (
          <Chip key={w} tone={/無料|オフ/.test(w) ? 'accent' : /持って|遊んだ/.test(w) ? 'ok' : 'muted'}>{w}</Chip>
        ))}
      </div>
      {people.length > 0 && (
        <div className="mt-1.5">
          <Avatars ids={people} members={members} size={18} />
        </div>
      )}
    </button>
  );
}

function OfferCard({ o, game, onOpen }: { o: GameOffer; game?: GameCard; onOpen: (g: GameCard) => void }) {
  const until = o.active ? `${md(o.ends_at)} まで無料` : `${md(o.starts_at)} から無料`;
  const body = (
    <>
      <div className="relative overflow-hidden rounded-xl bg-secondary" style={{ aspectRatio: '460 / 215' }}>
        {o.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={o.image} alt={o.title} loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
        )}
        <span className={`absolute left-2 top-2 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${o.active ? 'bg-green-600 text-white' : 'bg-background/90 text-foreground'}`}>
          {o.source === 'epic' ? 'Epic' : o.source} · {until}
        </span>
      </div>
      <h3 className="mt-2 line-clamp-1 text-[13.5px] font-semibold text-foreground">{o.title}</h3>
      {game && (
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">
          {playersLabel(game)}・{modeLabel(game.modes)}
        </p>
      )}
    </>
  );
  return game ? (
    <button type="button" onClick={() => onOpen(game)} className="w-[230px] min-w-[230px] text-left">
      {body}
    </button>
  ) : (
    <a href={o.url || '#'} target="_blank" rel="noopener noreferrer" className="block w-[230px] min-w-[230px]">
      {body}
    </a>
  );
}

function GameDetail({ g, board, myId, onMark, busy }: { g: GameCard; board: GameBoard; myId: string | null; onMark: (kind: 'want' | 'own', on: boolean) => void; busy: boolean }) {
  const isDesktop = useIsDesktop();
  const m = board.members;
  const posted = g.posted.by ? m[g.posted.by]?.name : null;
  const iWant = !!myId && g.want.includes(myId);
  const iOwn = !!myId && g.own.includes(myId);
  return (
    <div className="space-y-4 px-5 py-4">
      <GameImage g={g} />
      <div>
        <p className="text-[14px] leading-relaxed text-foreground/85">{g.hook}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Chip tone="accent">
            <Users className="h-3 w-3" />
            {playersLabel(g)}
          </Chip>
          <Chip>{modeLabel(g.modes)}</Chip>
          {g.vibe.slice(0, 3).map((v) => (
            <Chip key={v}>{v}</Chip>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-[12.5px]">
        <div className="rounded-xl bg-secondary/70 p-3">
          <p className="text-[11px] text-muted-foreground">価格</p>
          <div className="mt-1">
            <PriceTag g={g} />
          </div>
          {g.price.lowest != null && g.price.final != null && g.price.lowest < g.price.final && (
            <p className="mt-1 text-[11px] text-muted-foreground">記録上の最安 ¥{g.price.lowest.toLocaleString()}</p>
          )}
        </div>
        <div className="rounded-xl bg-secondary/70 p-3">
          <p className="text-[11px] text-muted-foreground">{g.release.soon ? '発売' : '評価'}</p>
          <p className="mt-1 font-semibold text-foreground">
            {g.release.soon ? g.release.text || '未定' : g.review.desc || '—'}
            {!g.release.soon && g.review.pct != null && <span className="ml-1 font-normal text-muted-foreground">{g.review.pct}%</span>}
          </p>
          {g.live_players != null && !g.release.soon && (
            <p className="mt-1 text-[11px] text-muted-foreground">Steam で今 {g.live_players.toLocaleString()} 人がプレイ中</p>
          )}
        </div>
      </div>
      {(g.playing_now.length > 0 || g.played.length > 0 || g.want.length > 0 || g.own.length > 0) && (
        <div className="space-y-1.5 text-[12.5px]">
          {g.playing_now.length > 0 && (
            <p className="flex items-center gap-2"><Avatars ids={g.playing_now} members={m} />いまプレイ中</p>
          )}
          {g.played.length > 0 && (
            <p className="flex items-center gap-2"><Avatars ids={g.played} members={m} />最近遊んだ{g.last_played_at ? `（${timeAgo(g.last_played_at)}）` : ''}</p>
          )}
          {g.own.length > 0 && <p className="flex items-center gap-2"><Avatars ids={g.own} members={m} />持ってる</p>}
          {g.want.length > 0 && <p className="flex items-center gap-2"><Avatars ids={g.want} members={m} />やりたい</p>}
        </div>
      )}
      {g.news.length > 0 && (
        <div className="space-y-2">
          {g.news.map((n, i) => (
            <p key={i} className="rounded-xl border border-border px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">{n}</p>
          ))}
        </div>
      )}
      {posted && (
        <p className="text-[11.5px] text-muted-foreground">
          {posted} が置いた{g.posted.at ? `（${md(g.posted.at)}）` : ''}{g.posted.count > 1 ? `・${g.posted.count} 回貼られた` : ''}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={iWant ? 'default' : 'outline'}
          className={`h-9 rounded-full px-4 text-xs font-semibold ${iWant ? 'bg-primary text-white hover:bg-primary/90' : ''}`}
          disabled={busy || !myId}
          onClick={() => onMark('want', !iWant)}
          aria-pressed={iWant}
        >
          やりたい
        </Button>
        <Button
          size="sm"
          variant={iOwn ? 'default' : 'outline'}
          className={`h-9 rounded-full px-4 text-xs font-semibold ${iOwn ? 'bg-green-600 text-white hover:bg-green-600/90' : ''}`}
          disabled={busy || !myId}
          onClick={() => onMark('own', !iOwn)}
          aria-pressed={iOwn}
        >
          持ってる
        </Button>
        <Button asChild size="sm" variant="ghost" className="h-9 rounded-full px-3 text-xs">
          <a href={g.store_url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            Steam で見る
          </a>
        </Button>
        {isDesktop && (
          <Button asChild size="sm" variant="ghost" className="h-9 rounded-full px-3 text-xs">
            <a href={`steam://store/${g.appid}`}>Steam アプリで開く</a>
          </Button>
        )}
      </div>
    </div>
  );
}

/** Steam 連携（本人が自分のプロフィールを入れたときだけ。所持ゲームとウィッシュリストで「持ってる」「やりたい」が自動で付く） */
function SteamLinkCard({ onChanged }: { onChanged: () => void }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<SteamLink | null>(null);
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    appApi.steamStatus().then(setStatus).catch(() => setStatus(null));
  }, []);

  const link = async () => {
    setBusy(true);
    try {
      const r = await appApi.linkSteam(profile.trim());
      setStatus({ linked: true, name: r.name, avatar: r.avatar, games: r.games, private: r.private });
      toast({
        title: 'Steam を連携しました',
        description: r.private ? 'ゲームの詳細が非公開のため、所持ゲームは取れませんでした' : `${r.games} 本のゲームを読み込みました`,
      });
      setOpen(false);
      onChanged();
    } catch (e) {
      toast({ title: '連携できませんでした', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const unlink = async () => {
    setBusy(true);
    try {
      await appApi.unlinkSteam();
      setStatus({ linked: false, name: null, avatar: null, games: null, private: false });
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;
  return (
    <>
      {status.linked ? (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground">
          {status.avatar && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={status.avatar} alt="" className="h-4 w-4 rounded-full" />
          )}
          Steam 連携中{status.private ? '（非公開）' : status.games != null ? `・${status.games}本` : ''}
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="text-[12px] font-semibold text-primary hover:text-primary/80" data-tour="games-steam">
          Steam を連携
        </button>
      )}
      <ResponsiveSheet open={open} onOpenChange={setOpen} title="Steam を連携">
        <div className="space-y-4 px-5 py-4">
          <p className="text-[13px] leading-relaxed text-foreground/85">
            自分の Steam のプロフィールを入れると、持っているゲームとウィッシュリストから「持ってる」「やりたい」が自動で付き、「今夜どれ？」が持っている人の多いゲームを選びやすくなります。最近 2 週間に遊んだゲームは「遊んだ」に出ます。
          </p>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            所持ゲームを読むには、Steam のプライバシー設定で「ゲームの詳細」が公開になっている必要があります。取り込むのはゲームの一覧とプレイ時間だけで、いつでも解除できます（解除すると取り込んだ情報も消えます）。
          </p>
          {status.linked ? (
            <div className="flex items-center justify-between gap-3 rounded-xl bg-secondary/70 p-3">
              <span className="text-[13px] font-medium text-foreground">{status.name} と連携中</span>
              <Button variant="outline" size="sm" className="h-8 rounded-full px-4 text-xs" onClick={unlink} disabled={busy}>
                解除
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <Input
                value={profile}
                onChange={(e) => setProfile(e.target.value)}
                placeholder="https://steamcommunity.com/id/… または /profiles/…"
                aria-label="Steam のプロフィール URL"
              />
              <Button
                className="h-9 rounded-full bg-primary px-5 text-xs font-semibold text-white hover:bg-primary/90"
                onClick={link}
                disabled={busy || profile.trim().length < 2}
              >
                {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                連携する
              </Button>
              <p className="text-[11.5px] text-muted-foreground">Steam アプリでプロフィールを開き、右クリック →「ページの URL をコピー」で取れます</p>
            </div>
          )}
        </div>
      </ResponsiveSheet>
    </>
  );
}

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

  const byId = useMemo(() => new Map((board?.games ?? []).map((g) => [g.appid, g])), [board]);
  const open = openId ? byId.get(openId) ?? null : null;

  const onMark = async (kind: 'want' | 'own', on: boolean) => {
    if (!guildId || !open) return;
    setBusy(true);
    try {
      const r = await appApi.markGame(guildId, open.appid, kind, on);
      setBoard((b) =>
        b ? { ...b, games: b.games.map((g) => (g.appid === r.appid ? { ...g, want: r.want, own: r.own } : g)) } : b
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
  const voiceIds = board.now.voice.map((v) => v.user_id);
  const channels = Array.from(new Set(board.now.voice.map((v) => v.channel).filter(Boolean)));
  const picks = board.tonight.picks.map((p) => ({ ...p, g: byId.get(p.appid) })).filter((p) => p.g) as { appid: string; why: string[]; g: GameCard }[];
  const sales = board.deadlines.sales.map((a) => byId.get(a)).filter(Boolean) as GameCard[];
  const releases = board.deadlines.releases.map((r) => ({ ...r, g: byId.get(r.appid) })).filter((r) => r.g) as { appid: string; date: string; released: boolean; g: GameCard }[];
  const f = FILTERS.find((x) => x.id === filter)!;
  const list = board.games.filter((g) => g.posted.count > 0 && f.test(g));

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-background">
      <div className="space-y-8 py-4 sm:py-6">
        {/* いま */}
        <section className="px-4 sm:px-6" data-tour="games-now">
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] font-semibold text-muted-foreground">いま</p>
                {voiceIds.length ? (
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-[15px] font-bold text-foreground">
                    <Avatars ids={voiceIds} members={m} size={24} max={8} />
                    {channels.join('・')} に {voiceIds.length} 人
                  </p>
                ) : (
                  <p className="mt-1 text-[15px] font-semibold text-foreground">VC には誰もいません</p>
                )}
              </div>
              <button type="button" onClick={() => void load(true)} className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary" aria-label="更新">
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            {board.now.playing.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {board.now.playing.map((p) => {
                  const g = p.appid ? byId.get(p.appid) : undefined;
                  return (
                    <button
                      key={p.appid || p.game_name}
                      type="button"
                      disabled={!g}
                      onClick={() => g && setOpenId(g.appid)}
                      className="inline-flex items-center gap-2 rounded-full border border-border bg-background py-1 pl-1 pr-3 text-[12.5px] font-medium text-foreground disabled:cursor-default"
                    >
                      <Avatars ids={p.users} members={m} size={22} />
                      {p.game_name}
                      <span className="text-muted-foreground">{p.users.length}人</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* 今夜どれ？ */}
        <section data-tour="games-tonight">
          <SectionTitle icon={<Swords className="h-4 w-4" />} title="今夜どれ？" />
          <div className="mb-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:px-6" role="group" aria-label="人数">
            {PLAYER_CHOICES.map((n) => {
              const active = (players ?? board.tonight.players) === n;
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => setPlayers(n)}
                  aria-pressed={active}
                  className={`h-8 flex-shrink-0 rounded-full border px-3.5 text-[13px] font-semibold transition-colors ${
                    active ? 'border-transparent bg-primary text-white' : 'border-border bg-card text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {n === 8 ? '8人+' : `${n}人`}
                </button>
              );
            })}
            {board.tonight.from_voice && players === null && <span className="self-center text-[11.5px] text-muted-foreground">VC の人数</span>}
          </div>
          {picks.length ? (
            <ScrollRow className="gap-4" ariaLabel="今夜の候補">
              <div className="w-0.5 flex-shrink-0 sm:w-2" aria-hidden="true" />
              {picks.map((p, i) => (
                <PickCard key={p.appid} g={p.g} why={p.why} members={m} onOpen={(g) => setOpenId(g.appid)} anchor={i === 0 ? 'games-first-pick' : undefined} />
              ))}
              <div className="w-0.5 flex-shrink-0 sm:w-2" aria-hidden="true" />
            </ScrollRow>
          ) : (
            <p className="px-4 text-[13px] text-muted-foreground sm:px-6">{board.tonight.players} 人で遊べるゲームは置き場にまだありません</p>
          )}
        </section>

        {/* 期限つき */}
        {(board.deadlines.offers.length > 0 || sales.length > 0 || releases.length > 0) && (
          <section data-tour="games-deadlines">
            <SectionTitle icon={<Clock className="h-4 w-4" />} title="期限つき" />
            <ScrollRow className="gap-4" ariaLabel="無料配布・セール・発売">
              <div className="w-0.5 flex-shrink-0 sm:w-2" aria-hidden="true" />
              {board.deadlines.offers.map((o) => (
                <OfferCard key={o.id} o={o} game={o.appid ? byId.get(o.appid) : undefined} onOpen={(g) => setOpenId(g.appid)} />
              ))}
              {sales.map((g) => (
                <button key={`sale-${g.appid}`} type="button" onClick={() => setOpenId(g.appid)} className="w-[230px] min-w-[230px] text-left">
                  <GameImage g={g} />
                  <h3 className="mt-2 line-clamp-1 text-[13.5px] font-semibold text-foreground">{g.name}</h3>
                  <div className="mt-1 flex items-center gap-1.5">
                    <PriceTag g={g} />
                    <span className="text-[11.5px] text-muted-foreground">{playersLabel(g)}</span>
                  </div>
                </button>
              ))}
              {releases.map((r) => (
                <button key={`rel-${r.appid}`} type="button" onClick={() => setOpenId(r.appid)} className="w-[230px] min-w-[230px] text-left">
                  <GameImage g={r.g} />
                  <h3 className="mt-2 line-clamp-1 text-[13.5px] font-semibold text-foreground">{r.g.name}</h3>
                  <p className="mt-0.5 text-[11.5px] font-semibold text-primary">{r.released ? `${md(r.date)} に発売` : `${md(r.date)} 発売`}</p>
                </button>
              ))}
              <div className="w-0.5 flex-shrink-0 sm:w-2" aria-hidden="true" />
            </ScrollRow>
          </section>
        )}

        {/* 最近ドデカで遊ばれた */}
        {board.recent.length > 0 && (
          <section>
            <SectionTitle icon={<Gift className="h-4 w-4" />} title="最近ドデカで遊ばれた" />
            <ul className="space-y-2 px-4 sm:px-6">
              {board.recent.slice(0, 8).map((r) => {
                const g = r.appid ? byId.get(r.appid) : undefined;
                return (
                  <li key={r.appid || r.game_name}>
                    <button
                      type="button"
                      disabled={!g}
                      onClick={() => g && setOpenId(g.appid)}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-secondary/70 disabled:hover:bg-transparent"
                    >
                      {g?.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={g.image} alt="" className="h-9 w-[77px] flex-shrink-0 rounded-md object-cover" />
                      ) : (
                        <span className="flex h-9 w-[77px] flex-shrink-0 items-center justify-center rounded-md bg-secondary text-[10px] text-muted-foreground">Steam外</span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-semibold text-foreground">{r.game_name}</span>
                        <span className="text-[11.5px] text-muted-foreground">{timeAgo(r.last_at)}</span>
                      </span>
                      <Avatars ids={r.users} members={m} size={22} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* 置き場 */}
        <section data-tour="games-all">
          <SectionTitle
            icon={<Tag className="h-4 w-4" />}
            title="置き場"
            aside={
              <span className="flex items-center gap-3">
                <SteamLinkCard onChanged={() => { cache.clear(); void load(true); }} />
                <span className="text-[12px] text-muted-foreground">{board.games.filter((g) => g.posted.count > 0).length} 本</span>
              </span>
            }
          />
          <p className="mb-3 flex items-start gap-1.5 px-4 text-[12.5px] leading-relaxed text-muted-foreground sm:px-6">
            <Info className="mt-[3px] h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            #ゲーム置き場 に貼られた Steam のゲームと X の記事から、何人で遊べるか・価格を自動でまとめています
          </p>
          <div className="mb-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:px-6" role="group" aria-label="絞り込み" data-tour="games-filters">
            {FILTERS.map((x) => (
              <button
                key={x.id}
                type="button"
                onClick={() => setFilter(x.id)}
                aria-pressed={filter === x.id}
                className={`h-8 flex-shrink-0 rounded-full border px-3 text-[13px] font-medium transition-colors ${
                  filter === x.id ? 'border-transparent bg-primary text-white' : 'border-border bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                {x.label} {board.games.filter((g) => g.posted.count > 0 && x.test(g)).length}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4 px-4 sm:grid-cols-3 sm:gap-5 sm:px-6 md:grid-cols-4 xl:grid-cols-5">
            {list.map((g, i) => (
              <GridCard key={g.appid} g={g} members={m} onOpen={(x) => setOpenId(x.appid)} anchor={i === 0 ? 'games-first-card' : undefined} />
            ))}
          </div>
          {list.length === 0 && <p className="px-4 py-6 text-center text-[13px] text-muted-foreground sm:px-6">該当するゲームはありません</p>}
        </section>
      </div>

      <ResponsiveSheet open={!!open} onOpenChange={(o) => !o && setOpenId(null)} title={open?.name ?? ''} dataTour="game-detail">
        {open && <GameDetail g={open} board={board} myId={myId} onMark={onMark} busy={busy} />}
      </ResponsiveSheet>
    </div>
  );
};

export default GameShelfScreen;
