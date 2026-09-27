'use client';

import React, { useEffect, useState } from 'react';
import { Loader2, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ResponsiveSheet } from '@/components/ui/responsive-sheet';

/**
 * 他のアプリ（YouTube など）の「共有」→ Irina で受け取った曲を、確認してからキューに入れる。
 * /share が sessionStorage に置いた URL を拾う（Android のホーム画面アプリだけが共有先に出る）。
 * VC で流れている最中に誤って入らないよう、自動では追加しない。
 */
export const PENDING_SHARE_KEY = 'irina.pendingShare';

export function readPendingShare(): { url: string; title?: string } | null {
  try {
    const raw = sessionStorage.getItem(PENDING_SHARE_KEY);
    return raw ? (JSON.parse(raw) as { url: string; title?: string }) : null;
  } catch {
    return null;
  }
}

function clearPendingShare() {
  try {
    sessionStorage.removeItem(PENDING_SHARE_KEY);
  } catch {
    /* noop */
  }
}

interface ShareReceiverProps {
  ready: boolean;
  onAdd: (url: string) => Promise<void>;
}

export const ShareReceiver: React.FC<ShareReceiverProps> = ({ ready, onAdd }) => {
  const [share, setShare] = useState<{ url: string; title?: string } | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const pending = readPendingShare();
    if (pending) setShare(pending);
  }, [ready]);

  const close = () => {
    clearPendingShare();
    setShare(null);
  };

  return (
    <ResponsiveSheet open={!!share} onOpenChange={(o) => !o && close()} title="共有された曲">
      {share && (
        <div className="space-y-4 px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Share2 className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              {share.title && <p className="line-clamp-2 text-[14px] font-semibold text-foreground">{share.title}</p>}
              <p className="break-all text-[12px] text-muted-foreground">{share.url}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              className="h-9 rounded-full bg-primary px-5 text-xs font-semibold text-white hover:bg-primary/90"
              disabled={adding}
              onClick={async () => {
                setAdding(true);
                try {
                  await onAdd(share.url);
                  close();
                } finally {
                  setAdding(false);
                }
              }}
            >
              {adding && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              キューに追加
            </Button>
            <Button variant="ghost" className="h-9 rounded-full px-4 text-xs" onClick={close}>
              やめる
            </Button>
          </div>
        </div>
      )}
    </ResponsiveSheet>
  );
};
