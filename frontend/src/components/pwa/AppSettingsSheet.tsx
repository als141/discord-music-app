'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Bell, BellOff, Check, Download, Loader2, ShieldCheck, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';
import { useToast } from '@/hooks/use-toast';
import { useDeviceStore } from '@/store/useDeviceStore';
import { describeDevice } from '@/lib/pwa/platform';
import { preparePush } from '@/lib/pwa/push';
import { APP_VERSION } from '@/lib/guide/notices';
import { InstallSteps, OpenInBrowserSteps, UnblockSteps } from './InstallGuide';

/**
 * 「通知とアプリ」: この端末のインストール状況・通知の状態と設定。
 * 開き方: アバターのメニュー / お知らせ一覧の下 / お願いカード / `/?open=settings`
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-5 py-4">
      <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function StatusLine({ ok, icon, children }: { ok: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
          ok ? 'bg-green-500/12 text-green-600' : 'bg-secondary text-muted-foreground'
        }`}
      >
        {icon}
      </span>
      <p className="text-[14px] font-medium leading-snug text-foreground">{children}</p>
    </div>
  );
}

export const AppSettingsSheet: React.FC = () => {
  const open = useDeviceStore((s) => s.settingsOpen);
  const close = useDeviceStore((s) => s.closeSettings);
  const info = useDeviceStore((s) => s.info);
  const capability = useDeviceStore((s) => s.capability);
  const permission = useDeviceStore((s) => s.permission);
  const subscribed = useDeviceStore((s) => s.subscribed);
  const installed = useDeviceStore((s) => s.installed);
  const canPrompt = useDeviceStore((s) => s.canPromptInstall);
  const prefs = useDeviceStore((s) => s.prefs);
  const isAdmin = useDeviceStore((s) => s.isAdmin);
  const serverPushEnabled = useDeviceStore((s) => s.serverPushEnabled);
  const busy = useDeviceStore((s) => s.busy);
  const { enablePush, setPref, sendTest, install, sync } = useDeviceStore.getState();
  const { toast } = useToast();
  const [testing, setTesting] = useState(false);

  // 開いたら最新の状態を読み直し、通知ボタン用に Service Worker と鍵を先に用意しておく（iPhone 対策）
  useEffect(() => {
    if (!open) return;
    void sync({ force: true });
    void preparePush();
  }, [open, sync]);

  if (!info) return null;
  const mobile = info.formFactor !== 'desktop';
  const notifOn = permission === 'granted' && subscribed;

  const onEnable = async () => {
    const res = await enablePush();
    if (res.ok) toast({ title: '通知をオンにしました', description: 'テスト通知で届き方を確かめられます' });
    else if (res.permission === 'denied') toast({ title: '通知がブロックされました', description: '下の手順で許可に戻せます' });
    else if (res.error) toast({ title: 'オンにできませんでした', description: res.error, variant: 'destructive' });
  };

  const onTest = async () => {
    setTesting(true);
    try {
      const r = await sendTest();
      toast({ title: 'テスト通知を送りました', description: r.sent ? '数秒で届きます' : '届け先の端末が見つかりませんでした' });
    } catch (e) {
      toast({ title: '送れませんでした', description: e instanceof Error ? e.message : '', variant: 'destructive' });
    } finally {
      setTesting(false);
    }
  };

  const onInstall = async () => {
    const outcome = await install();
    if (outcome === 'accepted') toast({ title: 'インストールしました', description: 'ホーム画面の Irina から開けます' });
  };

  const installBlock = (() => {
    if (info.standalone) {
      return <StatusLine ok icon={<Check className="h-4 w-4" />}>アプリとして開いています</StatusLine>;
    }
    if (mobile && info.inApp) {
      return (
        <div className="space-y-3">
          <StatusLine ok={false} icon={<Smartphone className="h-4 w-4" />}>
            Discord などのアプリ内ブラウザでは、ホーム画面への追加や通知が使えません
          </StatusLine>
          <OpenInBrowserSteps info={info} />
        </div>
      );
    }
    if (installed) {
      return (
        <StatusLine ok icon={<Check className="h-4 w-4" />}>
          追加済みです。ホーム画面の Irina から開けます
        </StatusLine>
      );
    }
    if (canPrompt) {
      return (
        <div className="space-y-3">
          <StatusLine ok={false} icon={<Download className="h-4 w-4" />}>
            {mobile ? 'ホーム画面に追加すると、アプリとして 1 タップで開けます' : 'アプリとしてインストールできます'}
          </StatusLine>
          <Button size="sm" className="h-9 rounded-full bg-primary px-5 text-xs font-semibold text-white hover:bg-primary/90" onClick={onInstall}>
            インストール
          </Button>
        </div>
      );
    }
    if (!mobile) {
      return (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          PC はブラウザのままで使えます（Chrome / Edge ならアドレスバー右のアイコンからアプリとして追加もできます）
        </p>
      );
    }
    return (
      <div className="space-y-3">
        <StatusLine ok={false} icon={<Smartphone className="h-4 w-4" />}>
          {info.platform === 'ios'
            ? 'ホーム画面に追加してください（iPhone はそうしないと通知が届きません）'
            : 'ホーム画面に追加すると、アプリとして 1 タップで開けます'}
        </StatusLine>
        <InstallSteps info={info} />
        <p className="text-[12px] text-muted-foreground">すでに追加済みなら、ホーム画面の Irina から開いてください</p>
      </div>
    );
  })();

  const notifyBlock = (() => {
    if (!serverPushEnabled && capability === 'ok') {
      return <p className="text-[13px] text-muted-foreground">通知の準備中です。しばらくしてから開いてください</p>;
    }
    if (capability === 'in-app') {
      return <p className="text-[13px] text-muted-foreground">ブラウザで開き直すと通知をオンにできます</p>;
    }
    if (capability === 'needs-install') {
      return (
        <StatusLine ok={false} icon={<BellOff className="h-4 w-4" />}>
          ホーム画面に追加した Irina から開くと、通知をオンにできます
        </StatusLine>
      );
    }
    if (capability === 'unsupported') {
      return <p className="text-[13px] text-muted-foreground">この端末・ブラウザでは通知を使えません</p>;
    }
    if (permission === 'denied') {
      return (
        <div className="space-y-3">
          <StatusLine ok={false} icon={<BellOff className="h-4 w-4" />}>
            通知がブロックされています。次の手順で許可してください
          </StatusLine>
          <UnblockSteps info={info} />
        </div>
      );
    }
    if (!notifOn) {
      return (
        <div className="space-y-3">
          <StatusLine ok={false} icon={<BellOff className="h-4 w-4" />}>
            通知はオフです
          </StatusLine>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            新機能のお知らせが届きます。曲置き場に曲が置かれたとき・VC で音楽が流れ始めたときの通知も、下の「受け取る通知」でオンにできます。
          </p>
          <Button
            size="sm"
            className="h-9 rounded-full bg-primary px-5 text-xs font-semibold text-white hover:bg-primary/90"
            onClick={onEnable}
            disabled={busy}
          >
            {busy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            通知をオンにする
          </Button>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <StatusLine ok icon={<Bell className="h-4 w-4" />}>
          この端末に通知が届きます
        </StatusLine>
        <Button variant="outline" size="sm" className="h-8 rounded-full px-4 text-xs" onClick={onTest} disabled={testing}>
          {testing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          テスト通知を送る
        </Button>
      </div>
    );
  })();

  const prefRows: { key: 'announce' | 'shelf' | 'vc_music'; label: string; note: string }[] = [
    { key: 'announce', label: 'お知らせ', note: '新機能や大事なお知らせ。必ず届きます' },
    { key: 'shelf', label: '曲置き場に曲が置かれたとき', note: '#曲置き場 にリンクが貼られたら（30 分に 1 回まで）' },
    { key: 'vc_music', label: 'VC で音楽が流れ始めたとき', note: 'しばらく静かだった VC で再生が始まったら（3 時間に 1 回まで）' },
  ];

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(o) => (o ? undefined : close())}
      title="通知とアプリ"
      aside={`Ver. ${APP_VERSION}`}
      dataTour="app-settings"
    >
      <div className="divide-y divide-border/70">
        <Section title="この端末">
          <p className="text-[13px] text-muted-foreground">{describeDevice(info.platform, info.browser, info.standalone)}</p>
        </Section>
        <Section title="ホーム画面に追加">{installBlock}</Section>
        <Section title="通知">{notifyBlock}</Section>
        <Section title="受け取る通知">
          <ul className="space-y-3">
            {prefRows.map((row) => {
              const fixed = row.key === 'announce';
              // 曲置き場・VC は既定オフ（オンにした人にだけ届く）
              const checked = fixed ? true : prefs ? prefs[row.key as 'shelf' | 'vc_music'] : false;
              return (
                <li key={row.key} className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-foreground">{row.label}</p>
                    <p className="text-[12px] leading-relaxed text-muted-foreground">{row.note}</p>
                  </div>
                  <Switch
                    checked={checked}
                    disabled={fixed || !prefs}
                    onCheckedChange={(v) => {
                      if (fixed) return;
                      setPref(row.key as 'shelf' | 'vc_music', v).catch(() =>
                        toast({ title: '保存できませんでした', variant: 'destructive' })
                      );
                    }}
                    aria-label={row.label}
                  />
                </li>
              );
            })}
          </ul>
          {!notifOn && (
            <p className="mt-3 text-[12px] text-muted-foreground">この端末で通知をオンにすると届くようになります</p>
          )}
        </Section>
        {isAdmin && (
          <Section title="管理">
            <Link
              href="/admin"
              onClick={close}
              className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-primary hover:text-primary/80"
            >
              <ShieldCheck className="h-4 w-4" />
              管理画面（インストール状況・通知の送信）
            </Link>
          </Section>
        )}
      </div>
    </ResponsiveSheet>
  );
};
