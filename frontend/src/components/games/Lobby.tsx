'use client';

import React, { useMemo, useState } from 'react';
import { Check, Copy, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { useToast } from '@/hooks/use-toast';
import { appApi, GameBoard, GameCard, Lobby } from '@/lib/app-api';
import { AvatarStack } from './ui';

/**
 * 募集（ロビー）。ゲーム探しのジャーニーでいちばんの壁＝人数（「あと N 人」）と、ただ一つの明示的な要望＝「揃ったら教えて」に答える。
 * - カード: 立てた人・何を・いつ・何人／何人、［行く］、［Discord に貼る］（<@id> 付きの文面をコピー。イリーナは投稿しない）
 * - 立てる: ゲームは任意（実際の誘いの 8 割はゲーム名なし）、人数、開始（今から / 次の正時 3 つ）、呼ぶ人
 * - 揃ったら「行く」を押した人に通知（backend の lobby.tick）。VC に入った人も行くに数える
 */

type Members = GameBoard['members'];

const avatarOf = (id: string, members: Members) =>
  members[id]?.image || `https://cdn.discordapp.com/embed/avatars/${Number(BigInt(id) >> BigInt(22)) % 6}.png`;

function whenLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.getTime() <= Date.now() + 5 * 60_000 ? '今から' : `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}〜`;
}

export function lobbyWhat(lb: Lobby, games: Map<string, GameCard>): string {
  return (lb.appid && games.get(lb.appid)?.name) || lb.title || 'なにかやる';
}

/** Discord に貼る文面。<@id> は貼って送るとメンションになる */
export function lobbyText(lb: Lobby, games: Map<string, GameCard>): string {
  const left = Math.max(0, lb.need - lb.going.length);
  const call = lb.invited.filter((u) => !lb.going.includes(u)).map((u) => `<@${u}>`).join(' ');
  const url = typeof window !== 'undefined' ? `${window.location.origin}/?tab=games&lobby=${lb.id}` : '';
  return `【募集】${lobbyWhat(lb, games)} ${whenLabel(lb.start_at)} ${left ? `あと${left}人` : 'そろった'}（${lb.going.length}/${lb.need}）${call ? ` ${call}` : ''}\n${url}`;
}

export function LobbyCard({
  lb,
  guildId,
  members,
  games,
  myId,
  onChanged,
}: {
  lb: Lobby;
  guildId: string;
  members: Members;
  games: Map<string, GameCard>;
  myId: string | null;
  onChanged: (lb: Lobby | null) => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const going = !!myId && lb.going.includes(myId);
  const isHost = myId === lb.host_id;
  const left = Math.max(0, lb.need - lb.going.length);
  const game = lb.appid ? games.get(lb.appid) : undefined;

  const join = async () => {
    setBusy(true);
    try {
      onChanged(await appApi.joinLobby(guildId, lb.id, going ? 'none' : 'going'));
    } catch (e) {
      toast({ title: '保存できませんでした', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };
  const close = async () => {
    setBusy(true);
    try {
      await appApi.closeLobby(guildId, lb.id);
      onChanged(null);
    } catch (e) {
      toast({ title: '締められませんでした', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lobbyText(lb, games));
      toast({ title: 'コピーしました', description: 'Discord に貼って送ると、呼んだ人にメンションが届きます' });
    } catch {
      toast({ title: 'コピーできませんでした', variant: 'destructive' });
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-primary/25 bg-primary/[0.04]" data-tour="games-lobby">
      <div className="flex gap-3 p-4">
        {game?.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={game.image} alt="" className="hidden h-[52px] w-[111px] flex-shrink-0 rounded-lg object-cover sm:block" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-muted-foreground">
            {isHost ? 'あなた' : members[lb.host_id]?.name || 'だれか'}の募集 · {whenLabel(lb.start_at)}
          </p>
          <p className="truncate text-[17px] font-bold leading-snug text-foreground">{lobbyWhat(lb, games)}</p>
          <div className="mt-1.5 flex items-center gap-2">
            <AvatarStack images={lb.going.map((u) => avatarOf(u, members))} size={24} max={8} />
            <span className="text-[13px] text-muted-foreground">
              <span className="font-semibold text-foreground">{lb.going.length}</span>/{lb.need}
              {left ? <span className="ml-1.5 font-semibold text-primary">あと{left}人</span> : <span className="ml-1.5 font-semibold text-green-600">そろった</span>}
            </span>
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-primary/15 px-4 py-2.5">
        {!isHost && (
          <Button
            size="sm"
            onClick={join}
            disabled={busy || !myId}
            aria-pressed={going}
            className={`h-9 rounded-full px-5 text-[13px] font-semibold ${going ? 'bg-foreground text-background hover:bg-foreground/90' : 'bg-primary text-white hover:bg-primary/90'}`}
          >
            {going ? (
              <>
                <Check className="mr-1 h-4 w-4" />
                行く
              </>
            ) : (
              '行く'
            )}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={copy} className="h-9 rounded-full px-4 text-[13px] font-semibold">
          <Copy className="mr-1.5 h-3.5 w-3.5" />
          Discord に貼る
        </Button>
        {isHost && (
          <Button size="sm" variant="ghost" onClick={close} disabled={busy} className="ml-auto h-9 rounded-full px-3 text-[13px] text-muted-foreground">
            締める
          </Button>
        )}
      </div>
    </div>
  );
}

/** 次の正時を 3 つ（深夜は 0〜2 時まで） */
function startChoices(): { id: string; label: string }[] {
  const now = new Date();
  const out = [{ id: 'now', label: '今から' }];
  for (let i = 1; out.length < 4 && i < 6; i++) {
    const h = (now.getHours() + i) % 24;
    if (h >= 3 && h < 12) continue; // 朝〜昼の募集はほぼ無い
    out.push({ id: `${h}:00`, label: `${h}:00` });
  }
  return out;
}

export function LobbySheet({
  open,
  onOpenChange,
  guildId,
  board,
  games,
  myId,
  game,
  defaultNeed,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  guildId: string;
  board: GameBoard;
  games: Map<string, GameCard>;
  myId: string | null;
  game: GameCard | null;
  defaultNeed: number;
  onCreated: (lb: Lobby) => void;
}) {
  const { toast } = useToast();
  const [need, setNeed] = useState(defaultNeed);
  const [start, setStart] = useState('now');
  const [invite, setInvite] = useState<string[]>([]);
  const [withGame, setWithGame] = useState(true);
  const [busy, setBusy] = useState(false);
  const starts = useMemo(startChoices, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const people = Object.entries(board.members).filter(([id]) => id !== myId);
  const inVc = new Set(board.now.voice.map((v) => v.user_id));

  React.useEffect(() => {
    if (open) {
      setNeed(defaultNeed);
      setStart('now');
      setInvite([]);
      setWithGame(true);
    }
  }, [open, defaultNeed]);

  const submit = async () => {
    setBusy(true);
    try {
      const lb = await appApi.createLobby(guildId, { appid: withGame && game ? game.appid : null, need, start, invite });
      onCreated(lb);
      onOpenChange(false);
      try {
        await navigator.clipboard.writeText(lobbyText(lb, games));
        toast({ title: '募集しました', description: '誘う文面をコピーしました。Discord に貼って送ってください' });
      } catch {
        toast({ title: '募集しました' });
      }
    } catch (e) {
      toast({ title: '募集できませんでした', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const chip = (active: boolean) =>
    `h-9 flex-shrink-0 rounded-full px-4 text-[13px] font-semibold transition-colors ${active ? 'bg-foreground text-background' : 'bg-secondary/70 text-foreground/70 hover:text-foreground'}`;

  return (
    <ResponsiveSheet open={open} onOpenChange={onOpenChange} title="募集する" dataTour="lobby-sheet">
      <div className="space-y-5 px-5 pt-4">
        <div>
          <p className="mb-2 text-[13px] font-semibold text-muted-foreground">なにを</p>
          {game && withGame ? (
            <div className="flex items-center gap-3 rounded-xl bg-secondary/60 p-2 pr-3">
              {game.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={game.image} alt="" className="h-[40px] w-[86px] rounded-md object-cover" />
              )}
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{game.name}</span>
              <button type="button" onClick={() => setWithGame(false)} className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-background" aria-label="ゲームを決めずに募集">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <p className="rounded-xl bg-secondary/60 px-4 py-3 text-[15px] font-semibold">なにかやる（ゲームは集まってから）</p>
          )}
        </div>
        <div>
          <p className="mb-2 text-[13px] font-semibold text-muted-foreground">何人で（自分も入れて）</p>
          <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="人数">
            {[2, 3, 4, 5, 6, 8].map((k) => (
              <button key={k} type="button" onClick={() => setNeed(k)} aria-pressed={need === k} className={chip(need === k)}>
                {k}人
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-semibold text-muted-foreground">いつ</p>
          <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="開始">
            {starts.map((s) => (
              <button key={s.id} type="button" onClick={() => setStart(s.id)} aria-pressed={start === s.id} className={chip(start === s.id)}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {people.length > 0 && (
          <div>
            <p className="mb-2 text-[13px] font-semibold text-muted-foreground">呼ぶ人（Discord に貼る文面にメンションが入ります）</p>
            <div className="flex flex-wrap gap-2">
              {people.map(([id, m]) => {
                const on = invite.includes(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setInvite((xs) => (on ? xs.filter((x) => x !== id) : [...xs, id]))}
                    aria-pressed={on}
                    className={`flex h-9 items-center gap-1.5 rounded-full pl-1 pr-3 text-[13px] font-medium transition-colors ${on ? 'bg-foreground text-background' : 'bg-secondary/70 text-foreground/80'}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={avatarOf(id, board.members)} alt="" className="h-7 w-7 rounded-full object-cover" />
                    {m.name || '—'}
                    {inVc.has(id) && <span className="text-[11px] opacity-70">VC</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          そろったら「行く」を押した人に通知が届きます。VC に入った人も行くに数えます。開始から 2 時間で自動で締まります。
        </p>
        <div className="sticky bottom-0 -mx-5 border-t border-border/70 bg-background/95 px-5 py-3 backdrop-blur">
          <Button onClick={submit} disabled={busy || !myId} className="h-11 w-full rounded-full bg-primary text-[15px] font-semibold text-white hover:bg-primary/90">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {need}人で募集する
          </Button>
        </div>
      </div>
    </ResponsiveSheet>
  );
}
