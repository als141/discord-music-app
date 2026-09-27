'use client';

import React, { useEffect, useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Drawer } from 'vaul';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsDesktop } from '@/hooks/use-media-query';
import { useGuideStore } from '@/store/useGuideStore';
import { useDeviceStore } from '@/store/useDeviceStore';
import {
  APP_VERSION,
  NOTICE_KIND_LABEL,
  Notice,
  NoticeAction,
  formatNoticeDate,
  sortedNotices,
  unreadNotices,
} from '@/lib/guide/notices';

/** お知らせのボタンを実行する（案内を始める / タブを開く / 通知とアプリの設定を開く） */
export function runNoticeAction(action: NoticeAction) {
  const s = useGuideStore.getState();
  if (action.type === 'tour') {
    s.startTour(action.tourId);
    return;
  }
  s.closeCenter();
  if (action.type === 'open-settings') {
    useDeviceStore.getState().openSettings();
    return;
  }
  s.navigator?.({ homeTab: action.tab });
}

const kindClass: Record<Notice['kind'], string> = {
  feature: 'text-primary bg-primary/10',
  improvement: 'text-foreground/70 bg-secondary',
  info: 'text-foreground/70 bg-secondary',
};

function NoticeItem({ notice, isNew }: { notice: Notice; isNew: boolean }) {
  const [primary, ...rest] = notice.actions ?? [];
  return (
    <li className="relative px-5 py-4">
      {isNew && (
        <span className="absolute left-2 top-[22px] h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
      )}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className={`rounded-full px-2 py-0.5 font-semibold ${kindClass[notice.kind]}`}>
          {NOTICE_KIND_LABEL[notice.kind]}
        </span>
        <time dateTime={notice.publishedAt}>{formatNoticeDate(notice.publishedAt)}</time>
        {notice.version && <span>Ver. {notice.version}</span>}
        {isNew && <span className="sr-only">未読</span>}
      </div>
      <h3 className="mt-1.5 text-[15px] font-semibold text-foreground leading-snug">{notice.title}</h3>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{notice.body}</p>
      {primary && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            className="h-8 rounded-full px-4 text-xs font-semibold bg-primary text-white hover:bg-primary/90"
            onClick={() => runNoticeAction(primary)}
          >
            {primary.label}
          </Button>
          {rest.map((a) => (
            <Button
              key={a.label}
              size="sm"
              variant="outline"
              className="h-8 rounded-full px-4 text-xs font-medium"
              onClick={() => runNoticeAction(a)}
            >
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}

function NoticeList({ newIds }: { newIds: readonly string[] }) {
  const notices = useMemo(() => sortedNotices(), []);
  return (
    <ul className="divide-y divide-border/70">
      {notices.map((n) => (
        <NoticeItem key={n.id} notice={n} isNew={newIds.includes(n.id)} />
      ))}
    </ul>
  );
}

/** 一覧の下: この端末の通知の状態と「設定」への入口 */
function NotifyStatusRow() {
  const capability = useDeviceStore((s) => s.capability);
  const permission = useDeviceStore((s) => s.permission);
  const subscribed = useDeviceStore((s) => s.subscribed);
  const info = useDeviceStore((s) => s.info);
  if (!info) return null;
  const on = permission === 'granted' && subscribed;
  const label = on
    ? 'この端末に通知が届きます'
    : capability === 'needs-install'
      ? 'ホーム画面に追加すると通知が届きます'
      : capability === 'in-app'
        ? 'ブラウザで開くと通知をオンにできます'
        : capability === 'unsupported'
          ? 'この端末では通知を使えません'
          : permission === 'denied'
            ? '通知がブロックされています'
            : '通知はオフです';
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-secondary/40 px-5 py-3">
      <span className="flex min-w-0 items-center gap-2 text-[12.5px] text-muted-foreground">
        <span className={`h-2 w-2 flex-shrink-0 rounded-full ${on ? 'bg-green-500' : 'bg-muted-foreground/40'}`} aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
      <Button
        size="sm"
        variant={on ? 'ghost' : 'default'}
        className={`h-7 flex-shrink-0 rounded-full px-3 text-[12px] font-semibold ${on ? '' : 'bg-primary text-white hover:bg-primary/90'}`}
        onClick={() => {
          useGuideStore.getState().closeCenter();
          useDeviceStore.getState().openSettings();
        }}
      >
        {on ? '設定' : 'オンにする'}
      </Button>
    </div>
  );
}

function PanelHeader({ titleAs: Title }: { titleAs: React.ElementType }) {
  return (
    <div className="flex items-baseline justify-between px-5 pt-4 pb-3 border-b border-border/70">
      <Title className="text-[17px] font-bold tracking-tight text-foreground">お知らせ</Title>
      <span className="text-[11px] text-muted-foreground">Irina Ver. {APP_VERSION}</span>
    </div>
  );
}

/**
 * ヘッダーのベル + お知らせ一覧。
 * PC はベルの下にポップオーバー、スマホは下から出るシート。
 * 開いた瞬間に全件を既読にし、そのとき未読だったものにだけ一覧で点を付ける。
 */
export const NoticeBell: React.FC = () => {
  const isDesktop = useIsDesktop();
  const centerOpen = useGuideStore((s) => s.centerOpen);
  const seen = useGuideStore((s) => s.seenNoticeIds);
  const openCenter = useGuideStore((s) => s.openCenter);
  const closeCenter = useGuideStore((s) => s.closeCenter);
  const markSeen = useGuideStore((s) => s.markSeen);

  const unread = useMemo(() => unreadNotices(seen), [seen]);
  const [newIds, setNewIds] = useState<string[]>([]);

  useEffect(() => {
    if (!centerOpen) return;
    setNewIds(unreadNotices(useGuideStore.getState().seenNoticeIds).map((n) => n.id));
    markSeen(sortedNotices().map((n) => n.id));
  }, [centerOpen, markSeen]);

  const label = unread.length > 0 ? `お知らせ（未読 ${unread.length} 件）` : 'お知らせ';

  const bell = (
    <Button
      variant="ghost"
      size="icon"
      className={`relative h-9 w-9 rounded-full transition-colors ${
        centerOpen ? 'bg-secondary text-foreground' : 'hover:bg-secondary text-foreground'
      }`}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={centerOpen}
      data-tour="notice-bell"
    >
      <Bell className="h-[18px] w-[18px]" />
      {unread.length > 0 && (
        <span
          className="absolute top-[7px] right-[8px] h-2 w-2 rounded-full bg-primary ring-2 ring-background"
          aria-hidden="true"
        />
      )}
    </Button>
  );

  return (
    <>
      <Popover.Root
        open={centerOpen && isDesktop}
        onOpenChange={(open) => (open ? openCenter() : closeCenter())}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Popover.Trigger asChild>{bell}</Popover.Trigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p>お知らせ</p>
          </TooltipContent>
        </Tooltip>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={10}
            collisionPadding={16}
            className="z-[160] w-[380px] max-h-[min(560px,calc(100dvh-96px))] overflow-y-auto rounded-2xl border border-border bg-background shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
            aria-label="お知らせ"
          >
            <PanelHeader titleAs="h2" />
            <NoticeList newIds={newIds} />
            <NotifyStatusRow />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>

      <Drawer.Root
        open={centerOpen && !isDesktop}
        onOpenChange={(open) => (open ? openCenter() : closeCenter())}
        shouldScaleBackground={false}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-[160] bg-black/30" />
          <Drawer.Content
            className="fixed inset-x-0 bottom-0 z-[161] flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-border bg-background outline-none"
            aria-describedby={undefined}
          >
            <div className="mx-auto mt-2.5 h-1.5 w-10 flex-shrink-0 rounded-full bg-muted-foreground/25" aria-hidden="true" />
            <PanelHeader titleAs={Drawer.Title} />
            <div className="overflow-y-auto pb-[calc(12px+env(safe-area-inset-bottom,0px))]">
              <NoticeList newIds={newIds} />
              <NotifyStatusRow />
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  );
};
