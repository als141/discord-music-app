'use client';

import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  count: number;
  children: React.ReactNode;
}

/** 「すべて見る」: セクションの全アイテムをグリッドで一覧するダイアログ */
export const SectionAllDialog: React.FC<Props> = ({ open, onOpenChange, title, count, children }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-[min(96vw,1100px)] max-h-[88dvh] p-0 overflow-hidden rounded-2xl bg-card border-border">
      <DialogHeader className="px-5 sm:px-6 pt-5 pb-3 border-b border-border/60 text-left">
        <DialogTitle className="text-lg sm:text-xl font-bold">{title}</DialogTitle>
        <DialogDescription className="text-muted-foreground">{count} 件</DialogDescription>
      </DialogHeader>
      <div className="overflow-y-auto max-h-[calc(88dvh-84px)] px-5 sm:px-6 py-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 sm:gap-5">
          {children}
        </div>
      </div>
    </DialogContent>
  </Dialog>
);
