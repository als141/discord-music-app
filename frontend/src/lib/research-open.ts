/**
 * 通知・Discord の埋め込みから「この調査を開く」（?tab=research&r=<id>）。
 * MainApp は URL のパラメータを読んだらすぐ消すので、ここで預かって、調査タブが開いたら渡す。
 */
const EVENT = 'irina-research-open';
let pending: number | null = null;

export function requestResearchOpen(id: string | null): void {
  if (!id || !/^\d+$/.test(id)) return;
  pending = Number(id);
  window.dispatchEvent(new CustomEvent<number>(EVENT, { detail: pending }));
}

/** 調査タブを開いたときに 1 回だけ受け取る */
export function takeResearchOpen(): number | null {
  const id = pending;
  pending = null;
  return id;
}

/** 調査タブを開いている間に届いた分 */
export function onResearchOpen(cb: (id: number) => void): () => void {
  const handler = (e: Event) => {
    pending = null;
    cb((e as CustomEvent<number>).detail);
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
