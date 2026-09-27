import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { GuideNavigation, TourId } from '@/lib/guide/tours';

/**
 * お知らせ・新機能カード・画面案内（ツアー）の状態。
 *
 * 既読や案内済みは端末ごとに localStorage に持つ（サーバーには送らない）。
 * 画面構成がスマホと PC で違うので、案内は端末ごとに 1 回ずつ出るのがむしろ自然。
 */

export type TourOutcome = 'completed' | 'skipped';

interface GuideState {
  // --- 永続 ---
  /** お知らせ一覧で見た / カードで対応したお知らせ */
  seenNoticeIds: string[];
  /** 紹介カードを出して閉じた（または押した）お知らせ */
  promoHandledIds: string[];
  /** 案内の結果。skipped の step はどこでやめたか */
  tours: Partial<Record<TourId, { outcome: TourOutcome; at: number; step: number }>>;
  /** 一度でも開いたホームのタブ（NEW の表示用） */
  visitedTabs: string[];

  // --- このタブの中だけ ---
  centerOpen: boolean;
  activeTour: { id: TourId; step: number } | null;
  /** 「新しいバージョンがあります」を閉じた */
  updateDismissed: boolean;
  /** 画面切り替え（MainApp が GuideHost 経由で登録する。お知らせのボタン・案内から使う） */
  navigator: ((nav: GuideNavigation) => void) | null;

  openCenter: () => void;
  closeCenter: () => void;
  markSeen: (ids: string[]) => void;
  handlePromo: (id: string) => void;
  startTour: (id: TourId) => void;
  goToStep: (step: number) => void;
  finishTour: (outcome: TourOutcome) => void;
  markTabVisited: (tab: string) => void;
  dismissUpdate: () => void;
  setNavigator: (fn: ((nav: GuideNavigation) => void) | null) => void;
}

const addUnique = (list: string[], ids: string[]) => {
  const missing = ids.filter((id) => !list.includes(id));
  return missing.length ? [...list, ...missing] : list;
};

export const useGuideStore = create<GuideState>()(
  persist(
    (set, get) => ({
      seenNoticeIds: [],
      promoHandledIds: [],
      tours: {},
      visitedTabs: [],

      centerOpen: false,
      activeTour: null,
      updateDismissed: false,
      navigator: null,

      openCenter: () => set({ centerOpen: true }),
      closeCenter: () => set({ centerOpen: false }),
      markSeen: (ids) => set((s) => ({ seenNoticeIds: addUnique(s.seenNoticeIds, ids) })),
      handlePromo: (id) =>
        set((s) => ({
          promoHandledIds: addUnique(s.promoHandledIds, [id]),
          seenNoticeIds: addUnique(s.seenNoticeIds, [id]),
        })),
      startTour: (id) => set({ centerOpen: false, activeTour: { id, step: 0 } }),
      goToStep: (step) => {
        const active = get().activeTour;
        if (active) set({ activeTour: { ...active, step } });
      },
      finishTour: (outcome) => {
        const active = get().activeTour;
        if (!active) return;
        set((s) => ({
          activeTour: null,
          tours: { ...s.tours, [active.id]: { outcome, at: Date.now(), step: active.step } },
        }));
      },
      markTabVisited: (tab) =>
        set((s) => (s.visitedTabs.includes(tab) ? s : { visitedTabs: [...s.visitedTabs, tab] })),
      dismissUpdate: () => set({ updateDismissed: true }),
      setNavigator: (fn) => set({ navigator: fn }),
    }),
    {
      name: 'irina-guide',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        seenNoticeIds: s.seenNoticeIds,
        promoHandledIds: s.promoHandledIds,
        tours: s.tours,
        visitedTabs: s.visitedTabs,
      }),
    }
  )
);
