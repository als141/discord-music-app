'use client';

import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Drawer } from 'vaul';
import { X } from 'lucide-react';
import { useIsDesktop } from '@/hooks/use-media-query';

/**
 * PC は中央のダイアログ、スマホは下から出るシート（スワイプで閉じられる）。
 * 見出し・閉じるボタン・中身のスクロールまで面倒を見る。
 */
interface ResponsiveSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** 見出しの右に小さく出す補足 */
  aside?: React.ReactNode;
  children: React.ReactNode;
  /** テスト・案内用の目印 */
  dataTour?: string;
}

export function ResponsiveSheet({ open, onOpenChange, title, aside, children, dataTour }: ResponsiveSheetProps) {
  const isDesktop = useIsDesktop();

  const header = (TitleEl: React.ElementType, CloseEl: React.ElementType) => (
    <div className="flex items-center justify-between gap-3 border-b border-border/70 px-5 pb-3 pt-4">
      <TitleEl className="text-[17px] font-bold tracking-tight text-foreground">{title}</TitleEl>
      <div className="flex items-center gap-2">
        {aside && <span className="text-[11px] text-muted-foreground">{aside}</span>}
        <CloseEl asChild>
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="閉じる"
          >
            <X className="h-4 w-4" />
          </button>
        </CloseEl>
      </div>
    </div>
  );

  if (isDesktop) {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[160] bg-black/30" />
          <Dialog.Content
            aria-describedby={undefined}
            data-tour={dataTour}
            className="fixed left-1/2 top-1/2 z-[161] flex max-h-[min(760px,calc(100dvh-64px))] w-[min(460px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border bg-background shadow-2xl outline-none"
          >
            {header(Dialog.Title, Dialog.Close)}
            <div className="min-h-0 overflow-y-auto">{children}</div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[160] bg-black/30" />
        <Drawer.Content
          aria-describedby={undefined}
          data-tour={dataTour}
          className="fixed inset-x-0 bottom-0 z-[161] flex max-h-[90dvh] flex-col rounded-t-2xl border-t border-border bg-background outline-none"
        >
          <div className="mx-auto mt-2.5 h-1.5 w-10 flex-shrink-0 rounded-full bg-muted-foreground/25" aria-hidden="true" />
          {header(Drawer.Title, Drawer.Close)}
          <div className="min-h-0 overflow-y-auto pb-[calc(16px+env(safe-area-inset-bottom,0px))]">{children}</div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
