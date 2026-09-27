'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Bell,
  BellOff,
  Check,
  ChevronDown,
  Loader2,
  RefreshCw,
  Send,
  Smartphone,
  Monitor,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/hooks/use-toast';
import { AdminMember, AdminOverview, AppApiError, appApi, PublicDevice, PushLogEntry } from '@/lib/app-api';
import { describeDevice } from '@/lib/pwa/platform';
import { NOTICES } from '@/lib/guide/notices';

/**
 * 管理画面（IRINA_ADMIN_USER_IDS の人だけ。判定はバックエンド）。
 * ドデカの全メンバーの「アプリを使ったか / ホーム画面に追加したか / 通知がオンか」と、通知の送信・履歴。
 */

const CURRENT_BUILD = process.env.NEXT_PUBLIC_BUILD_ID || '';

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
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

type Filter = 'all' | 'unused' | 'not-installed' | 'no-push';

const FILTERS: { id: Filter; label: string; test: (m: AdminMember) => boolean }[] = [
  { id: 'all', label: 'すべて', test: () => true },
  { id: 'unused', label: 'まだ使っていない', test: (m) => !m.used },
  { id: 'not-installed', label: 'ホーム画面に未追加', test: (m) => !m.installed },
  { id: 'no-push', label: '通知オフ', test: (m) => !m.push },
];

const LINKS = [
  { value: '/', label: 'ホーム' },
  { value: '/?tab=shelf', label: '曲置き場' },
  { value: '/?open=settings', label: '通知とアプリ' },
];

const KIND_LABEL: Record<string, string> = {
  announce: 'お知らせ',
  shelf: '曲置き場',
  vc_music: 'VC',
  test: 'テスト',
};

function Tile({ label, value, total, note }: { label: string; value: number; total: number; note?: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className="rounded-2xl border border-border bg-background p-4">
      <p className="text-[12px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-[26px] font-bold leading-none tracking-tight text-foreground">
        {value}
        <span className="ml-1 text-[13px] font-medium text-muted-foreground">/ {total} 人</span>
      </p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">{note ?? `${pct}%`}</p>
    </div>
  );
}

function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'muted' | 'accent'; children: React.ReactNode }) {
  const cls = {
    ok: 'bg-green-500/12 text-green-700',
    warn: 'bg-amber-500/15 text-amber-700',
    muted: 'bg-secondary text-muted-foreground',
    accent: 'bg-primary/10 text-primary',
  }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{children}</span>;
}

function usageBadge(m: AdminMember) {
  if (!m.used) return <Badge tone="muted">未利用</Badge>;
  if (m.installed) return <Badge tone="ok"><Check className="h-3 w-3" />ホーム画面に追加済み</Badge>;
  return <Badge tone="warn">ブラウザのみ</Badge>;
}

function pushBadge(m: AdminMember) {
  if (m.push) return <Badge tone="accent"><Bell className="h-3 w-3" />通知オン</Badge>;
  if (m.permission === 'denied') return <Badge tone="warn"><BellOff className="h-3 w-3" />ブロック中</Badge>;
  if (!m.used) return null;
  return <Badge tone="muted"><BellOff className="h-3 w-3" />通知オフ</Badge>;
}

function DeviceLine({ d }: { d: PublicDevice }) {
  const mobile = d.form_factor !== 'desktop';
  const stale = CURRENT_BUILD && d.app_build && d.app_build !== CURRENT_BUILD;
  const perm =
    d.push ? '通知オン' : d.permission === 'denied' ? 'ブロック中' : d.permission === 'unsupported' ? '通知非対応' : '通知オフ';
  return (
    <li className="flex items-start gap-2 text-[12.5px] text-muted-foreground">
      {mobile ? <Smartphone className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" /> : <Monitor className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />}
      <span className="min-w-0">
        <span className="font-medium text-foreground/80">{describeDevice(d.platform, d.browser, d.standalone)}</span>
        {!d.standalone && d.installed && '（アプリも追加済み）'} · {perm}
        {d.push_last_error && <span className="text-amber-700"> · 送信エラー</span>} · Ver. {d.app_version || '—'}
        {stale ? '（古い）' : ''} · {timeAgo(d.last_seen_at)}
      </span>
    </li>
  );
}

function MemberRow({
  m,
  selected,
  onToggle,
}: {
  m: AdminMember;
  selected: boolean;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          className="h-4 w-4 flex-shrink-0 accent-[var(--color-primary)]"
          checked={selected}
          onChange={onToggle}
          disabled={!m.push}
          aria-label={`${m.name} に送る`}
          title={m.push ? '送り先に選ぶ' : '通知オンの端末がありません'}
        />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={m.avatar} alt="" className="h-9 w-9 flex-shrink-0 rounded-full bg-secondary object-cover" />
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[14px] font-semibold text-foreground">{m.name}</span>
            {m.username && <span className="truncate text-[11px] text-muted-foreground">@{m.username}</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {usageBadge(m)}
            {pushBadge(m)}
            {m.used && <span className="text-[11px] text-muted-foreground">最終 {timeAgo(m.last_seen_at)}</span>}
          </div>
        </button>
        {m.devices.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
            aria-label={open ? '端末を隠す' : '端末を見る'}
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
      {open && m.devices.length > 0 && (
        <div className="ml-[52px] mt-2 space-y-2">
          <ul className="space-y-1">
            {m.devices.map((d) => (
              <DeviceLine key={d.device_id} d={d} />
            ))}
          </ul>
          {m.push && (
            <p className="text-[11.5px] text-muted-foreground">
              受け取り: {['お知らせ', m.prefs.shelf && '曲置き場', m.prefs.vc_music && 'VC'].filter(Boolean).join('・')}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

function Composer({
  data,
  selected,
  onSent,
}: {
  data: AdminOverview;
  selected: string[];
  onSent: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('/');
  const [target, setTarget] = useState<'all' | 'selected'>('all');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);

  const pushMembers = data.members.filter((m) => m.push);
  const recipients = target === 'all' ? pushMembers.map((m) => m.id) : selected;
  const recipientCount = target === 'all' ? pushMembers.length : selected.length;

  const fillLatest = () => {
    const n = NOTICES[0];
    setTitle(n.title);
    setBody(n.body.length > 300 ? n.body.slice(0, 297) + '…' : n.body);
    const a = n.actions?.[0];
    setLink(a?.type === 'open-tab' ? `/?tab=${a.tab}` : a?.type === 'open-settings' ? '/?open=settings' : '/');
  };

  const send = async () => {
    setSending(true);
    try {
      const r = await appApi.adminPush({ title: title.trim(), body: body.trim(), url: link, user_ids: target === 'all' ? [] : recipients });
      toast({
        title: '送信しました',
        description: `${r.target_users} 人・送信 ${r.sent} / 失敗 ${r.failed}${r.removed ? ` / 期限切れ ${r.removed}` : ''}`,
      });
      setTitle('');
      setBody('');
      onSent();
    } catch (e) {
      toast({ title: '送れませんでした', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setSending(false);
      setConfirming(false);
    }
  };

  const canSend = title.trim().length > 0 && recipientCount > 0 && data.push_enabled;

  return (
    <div className="rounded-2xl border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <h2 className="text-[15px] font-bold text-foreground">通知を送る</h2>
        <button type="button" onClick={fillLatest} className="text-[12px] font-medium text-primary hover:text-primary/80">
          最新のお知らせを入れる
        </button>
      </div>
      <div className="space-y-3 p-4">
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-muted-foreground">タイトル</span>
          <Input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="例: 曲置き場ができました" />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-medium text-muted-foreground">本文</span>
          <textarea
            value={body}
            maxLength={300}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-[14px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
            placeholder="何ができるようになったか、どこにあるか"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted-foreground">タップで開く画面</span>
            <select
              value={link}
              onChange={(e) => setLink(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
            >
              {LINKS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-muted-foreground">送り先</span>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value as 'all' | 'selected')}
              className="h-9 w-full rounded-md border border-input bg-background px-2 text-[13px]"
            >
              <option value="all">通知オンの全員（{pushMembers.length} 人）</option>
              <option value="selected">選んだ人（{selected.length} 人）</option>
            </select>
          </label>
        </div>

        {/* 見え方 */}
        <div className="rounded-xl bg-secondary/70 p-3" aria-label="プレビュー">
          <div className="flex gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192x192.png" alt="" className="h-9 w-9 flex-shrink-0 rounded-lg" />
            <div className="min-w-0">
              <p className="text-[12px] text-muted-foreground">Irina · 今</p>
              <p className="truncate text-[13.5px] font-semibold text-foreground">{title || 'タイトル'}</p>
              <p className="line-clamp-3 text-[12.5px] text-foreground/75">{body || '本文'}</p>
            </div>
          </div>
        </div>

        <Button
          className="h-10 w-full rounded-full bg-primary text-[13px] font-semibold text-white hover:bg-primary/90"
          disabled={!canSend || sending}
          onClick={() => setConfirming(true)}
        >
          {sending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
          {recipientCount} 人に送る
        </Button>
        {!data.push_enabled && <p className="text-[12px] text-amber-700">サーバー側の通知設定（VAPID）がありません</p>}
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{recipientCount} 人に通知を送りますか？</AlertDialogTitle>
            <AlertDialogDescription>「{title}」を、通知オンの端末すべてに送ります。取り消しはできません。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>やめる</AlertDialogCancel>
            <AlertDialogAction onClick={send}>送る</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function History({ log }: { log: PushLogEntry[] }) {
  return (
    <div className="rounded-2xl border border-border bg-background">
      <h2 className="border-b border-border/70 px-4 py-3 text-[15px] font-bold text-foreground">送信履歴</h2>
      {log.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">まだ送っていません</p>
      ) : (
        <ul className="divide-y divide-border/70">
          {log.map((l) => (
            <li key={l.id} className="px-4 py-3">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <Badge tone={l.kind === 'announce' ? 'accent' : 'muted'}>{KIND_LABEL[l.kind] ?? l.kind}</Badge>
                <span>{timeAgo(l.created_at)}</span>
              </div>
              <p className="mt-1 truncate text-[13.5px] font-semibold text-foreground">{l.title}</p>
              <p className="mt-0.5 text-[12px] text-muted-foreground">
                {l.target_users} 人 · 届いた {l.sent}
                {l.failed ? ` · 失敗 ${l.failed}` : ''}
                {l.removed ? ` · 期限切れ ${l.removed}` : ''} · 開いた {l.clicked}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AdminDashboard() {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<string[]>([]);
  const [showOthers, setShowOthers] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await appApi.adminOverview();
      setData(d);
      setError(null);
    } catch (e) {
      setError({ status: e instanceof AppApiError ? e.status : 0, message: e instanceof Error ? e.message : '読み込めませんでした' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const members = useMemo(() => {
    if (!data) return [];
    const f = FILTERS.find((x) => x.id === filter)!;
    // まだ使っていない人・通知オフの人が上に来るように（声をかける相手が先）
    const score = (m: AdminMember) => (m.used ? 0 : 4) + (m.installed ? 0 : 2) + (m.push ? 0 : 1);
    return data.members.filter(f.test).sort((a, b) => score(b) - score(a) || a.name.localeCompare(b.name, 'ja'));
  }, [data, filter]);

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="min-h-dvh bg-secondary/50">
      <header className="sticky top-0 z-10 border-b border-border/70 bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href="/"
              className="flex h-9 w-9 items-center justify-center rounded-full text-foreground hover:bg-secondary"
              aria-label="アプリに戻る"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <h1 className="truncate text-[16px] font-bold text-foreground">
              管理 <span className="font-medium text-muted-foreground">{data?.guild.name ? `· ${data.guild.name}` : ''}</span>
            </h1>
          </div>
          <Button variant="ghost" size="sm" className="h-9 rounded-full px-3 text-xs" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            更新
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-5">
        {error ? (
          <div className="rounded-2xl border border-border bg-background p-8 text-center">
            <p className="text-[15px] font-semibold text-foreground">
              {error.status === 403 ? 'このページは管理者だけが見られます' : '読み込めませんでした'}
            </p>
            <p className="mt-1 text-[13px] text-muted-foreground">{error.message}</p>
          </div>
        ) : !data ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="min-w-0 space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Tile label="メンバー" value={data.summary.members} total={data.summary.members} note="bot を除く" />
                <Tile label="アプリを使った" value={data.summary.used} total={data.summary.members} />
                <Tile label="ホーム画面に追加" value={data.summary.installed} total={data.summary.members} />
                <Tile
                  label="通知オン"
                  value={data.summary.push}
                  total={data.summary.members}
                  note={data.summary.denied ? `ブロック中 ${data.summary.denied} 人` : undefined}
                />
              </div>

              <div className="rounded-2xl border border-border bg-background">
                <div className="flex gap-2 overflow-x-auto border-b border-border/70 px-4 py-3" role="group" aria-label="絞り込み">
                  {FILTERS.map((f) => {
                    const count = data.members.filter(f.test).length;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setFilter(f.id)}
                        aria-pressed={filter === f.id}
                        className={`h-8 flex-shrink-0 rounded-full border px-3 text-[12.5px] font-medium transition-colors ${
                          filter === f.id
                            ? 'border-transparent bg-primary text-white'
                            : 'border-border bg-card text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {f.label} {count}
                      </button>
                    );
                  })}
                </div>
                {members.length === 0 ? (
                  <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">該当する人はいません</p>
                ) : (
                  <ul className="divide-y divide-border/70">
                    {members.map((m) => (
                      <MemberRow key={m.id} m={m} selected={selected.includes(m.id)} onToggle={() => toggle(m.id)} />
                    ))}
                  </ul>
                )}
              </div>

              {data.others.length > 0 && (
                <div className="rounded-2xl border border-border bg-background">
                  <button
                    type="button"
                    onClick={() => setShowOthers((v) => !v)}
                    className="flex w-full items-center justify-between px-4 py-3 text-left text-[13px] font-semibold text-muted-foreground"
                    aria-expanded={showOthers}
                  >
                    サーバー外の利用者（{data.others.length} 人）
                    <ChevronDown className={`h-4 w-4 transition-transform ${showOthers ? 'rotate-180' : ''}`} />
                  </button>
                  {showOthers && (
                    <ul className="divide-y divide-border/70 border-t border-border/70">
                      {data.others.map((m) => (
                        <MemberRow key={m.id} m={m} selected={selected.includes(m.id)} onToggle={() => toggle(m.id)} />
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-4">
              <Composer data={data} selected={selected} onSent={() => void load()} />
              <History log={data.push_log} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
