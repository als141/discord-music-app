'use client';

import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { useToast } from '@/hooks/use-toast';
import { appApi, SteamLink } from '@/lib/app-api';

/** Steam 連携（本人が自分のプロフィールを入れたときだけ。所持ゲームとウィッシュリストで「持ってる」「やりたい」が自動で付く） */
export function SteamLinkCard({ onChanged }: { onChanged: () => void }) {
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
