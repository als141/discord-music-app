/**
 * バックエンド（api.atoriba.jp）を「本人として」呼ぶクライアント。
 *
 * /api/irina-token（Vercel）が NextAuth のセッションから 15 分のトークンを作り、
 * それを Authorization: Bearer で付けて直接バックエンドを呼ぶ。トークンは期限の 1 分前まで使い回す。
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

let cached: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string | null> | null = null;

export class AppApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function getIrinaToken(force = false): Promise<string | null> {
  if (!force && cached && cached.expiresAt - Date.now() > 60_000) return cached.token;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch('/api/irina-token', { cache: 'no-store' });
      if (!res.ok) return null;
      const data = (await res.json()) as { token: string; expiresAt: number };
      cached = data;
      return data.token;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

async function call<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = await getIrinaToken();
  if (!token) throw new AppApiError(401, 'ログインを確認できませんでした');
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  if (res.status === 401 && retry) {
    cached = null;
    await getIrinaToken(true);
    return call<T>(path, init, false);
  }
  if (!res.ok) {
    let message = `エラー（${res.status}）`;
    try {
      const body = await res.json();
      if (typeof body?.detail === 'string') message = body.detail;
    } catch {
      /* 本文なし */
    }
    throw new AppApiError(res.status, message);
  }
  return (await res.json()) as T;
}

// ---- 型 ----

export type NotifPermission = 'granted' | 'denied' | 'default' | 'unsupported';

export interface DeviceReportBody {
  device_id: string;
  platform: string;
  browser: string;
  form_factor: string;
  standalone: boolean;
  installed: boolean;
  permission: NotifPermission;
  subscription: PushSubscriptionJSON | null;
  app_version: string;
  app_build: string;
  user_agent: string;
}

export interface PublicDevice {
  device_id: string;
  platform: string | null;
  browser: string | null;
  form_factor: string | null;
  standalone: boolean;
  installed: boolean;
  installed_at: string | null;
  permission: NotifPermission | null;
  push: boolean;
  push_last_ok_at: string | null;
  push_last_error: string | null;
  app_version: string | null;
  app_build: string | null;
  first_seen_at: string;
  last_seen_at: string;
}

export interface NotifPrefs {
  shelf: boolean;
  vc_music: boolean;
  game_deals: boolean;
  game_gather: boolean;
  /** VC に何人そろったら「揃ったら教えて」を送るか（2〜8） */
  gather_min: number;
  /** 自分のプレイ中をゲーム置き場に出すか */
  show_playing: boolean;
}

// ---- ゲーム置き場 ----

export interface GameCard {
  appid: string;
  name: string;
  image: string | null;
  hook: string;
  players: { min: number | null; max: number | null; best: string | null };
  modes: string[];
  vibe: string[];
  fit: number | null;
  price: { final: number | null; initial: number | null; discount: number; free: boolean; lowest: number | null };
  release: { text: string; soon: boolean };
  review: { desc: string | null; pct: number | null; total: number | null };
  live_players: number | null;
  posted: { by: string | null; at: string | null; count: number; last_at: string | null };
  want: string[];
  own: string[];
  played: string[];
  last_played_at: string | null;
  playing_now: string[];
  news: string[];
  store_url: string;
}

export interface SteamLink {
  linked?: boolean;
  name: string | null;
  avatar: string | null;
  games: number | null;
  /** ゲームの詳細が非公開で所持ゲームが取れない */
  private: boolean;
  synced_at?: string | null;
}

export interface GameOffer {
  id: string;
  source: string;
  title: string;
  url: string | null;
  image: string | null;
  appid: string | null;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
}

export interface GameBoard {
  guild_id: string;
  now: {
    voice: { user_id: string; channel: string | null; since: string }[];
    playing: { game_name: string; appid: string | null; users: string[]; since: string }[];
  };
  tonight: { players: number; from_voice: boolean; picks: { appid: string; score: number; why: string[] }[]; fits: number };
  deadlines: { offers: GameOffer[]; sales: string[]; releases: { appid: string; date: string; released: boolean }[] };
  recent: { appid: string | null; game_name: string; users: string[]; last_at: string; minutes: number }[];
  /** みんなのウィッシュリスト（Steam を連携した人。入れている人の多い順） */
  wishlist?: { appid: string; users: string[] }[];
  games: GameCard[];
  news: { url: string; text: string; posted_by: string | null; posted_at: string }[];
  members: Record<string, { name: string | null; image: string | null }>;
  updated_at: string;
  scene?: GameScene | null;
}

// ---- 界隈（配信者・VTuber・ゲームメディア・Steam） ----

export interface SceneStreamerGame {
  key: string;
  name: string;
  appid: string | null;
  card: GameCard | null;
  image: string | null;
  channels: { name: string; group: string; image: string | null }[];
  videos: number;
  views: number;
  top: { video_id: string; title: string; thumb: string | null; channel: string; views: number } | null;
  on_shelf: boolean;
}

export interface SceneFresh {
  key: string;
  appid: string;
  card: GameCard;
  badges: string[];
  score: number;
  articles: { src: string; title: string; url: string; at: string | null }[];
  streamers: string[];
  jikkyou: { views: number; videos: number; top_video: string | null; top_title: string | null; at: string } | null;
  on_shelf: boolean;
  found_first: boolean;
  /** X で話題（Grok の x_search）。根拠のポスト付き */
  x?: { why: string; posts: { url: string; handle: string; summary: string; likes: number | null }[] } | null;
  /** Claude（Opus 5.5）がドデカ向けに付けた一言 */
  why?: string | null;
}

export interface GameScene {
  streamers: SceneStreamerGame[];
  fresh: SceneFresh[];
  updated_at: string | null;
}

export interface SceneSong {
  key: string;
  song: string | null;
  artist: string | null;
  hook: string | null;
  orig_video_id: string | null;
  play_video_id: string;
  videos: { video_id: string; title: string; thumb: string | null; channel: string; channel_image: string | null; group: string; views: number; at: string; type: string | null; hook: string | null }[];
  channels: string[];
  /** 歌った・踊った人の数（本人の公式と Topic チャンネルは 1 人） */
  people: number;
  views: number;
  latest: string;
  posted_affinity: number;
  score: number;
}

// ---- ドデカのおすすめ・置き場（/reco/...） ----

export interface RecoItem {
  key: string;
  url: string;
  title: string;
  artist: string;
  thumb: string | null;
  year: number | null;
  /** context / discovery / favorite / memory / throwback / new / scene / trend / related / classic */
  kind: string;
  /** 行の札（続けて・懐かしい・新曲・界隈・ニコニコ・定番・好みから） */
  tag: string;
  reason: string;
  sub: string | null;
  label: string | null;
  who: { name: string; image: string | null } | null;
  platform: 'youtube' | 'niconico';
}

export interface RecoFeed {
  items: RecoItem[];
  /** limit を増やせばまだある（最大 120 曲） */
  has_more?: boolean;
  /** その場の選曲（Claude）を裏で作っている。数秒後に取り直すと並びが入れ替わる */
  curating?: boolean;
  /** その場の選曲がもう反映されている */
  live?: boolean;
  /** 「流れてる『○○』に合わせて」。いまの起点が無ければ null */
  context: { label: string | null; anchors: { title: string | null; src: string }[] };
  stats: { songs: number; people: number; since: number | null; box: number; vc: number };
  taste: string | null;
  curated_at: string | null;
  built_at: string;
}

export interface ShelfItem {
  key: string;
  url: string;
  title: string;
  artist: string;
  thumb: string | null;
  /** 「#曲置き場」「#一般」「アプリ」 */
  source: string;
  platform: 'youtube' | 'niconico';
  /** Discord に貼った人。曲置き箱（アプリ）の曲は出さない（自分の分だけ「自分」） */
  who: { name: string; image: string | null } | null;
  at: string;
  box_id: number | null;
  mine: boolean;
}

export interface BoxItem {
  id: number;
  key: string;
  url: string;
  title: string;
  artist: string;
  thumb: string | null;
  platform: 'youtube' | 'niconico';
  /** 自分が置いた曲だけ（ほかの人の分は null） */
  who: { id: string; name: string | null; image: string | null } | null;
  added_at: string;
  mine: boolean;
}

export interface BoxAddResult {
  url: string;
  ok: boolean;
  error?: string;
  item?: BoxItem;
}

export interface DeviceReportResult {
  device: PublicDevice;
  prefs: NotifPrefs;
  push_enabled: boolean;
  is_admin: boolean;
}

export interface PushSendResult {
  log_id: number;
  target_users: number;
  sent: number;
  failed: number;
  removed: number;
}

export interface AdminMember {
  id: string;
  name: string;
  username: string | null;
  avatar: string;
  joined_at: string | null;
  used: boolean;
  installed: boolean;
  push: boolean;
  permission: NotifPermission | null;
  last_seen_at: string | null;
  devices: PublicDevice[];
  prefs: NotifPrefs;
}

export interface PushLogEntry {
  id: number;
  kind: 'announce' | 'shelf' | 'vc_music' | 'test' | string;
  title: string;
  body: string | null;
  url: string | null;
  target_users: number;
  target_devices: number;
  sent: number;
  failed: number;
  removed: number;
  clicked: number;
  created_by: string | null;
  created_at: string;
}

/** 自動の通知・投稿のうち、オーナーが許可したもの（既定はすべて送らない） */
export interface NotifyGateKind {
  kind: string;
  label: string;
  on: boolean;
}

export interface AdminOverview {
  guild: { id: string; name: string };
  summary: { members: number; used: number; installed: number; push: number; denied: number };
  members: AdminMember[];
  others: AdminMember[];
  push_log: PushLogEntry[];
  push_enabled: boolean;
}

// ---- API ----

export const appApi = {
  vapidPublicKey: async (): Promise<string | null> => {
    const res = await fetch(`${API_URL}/push/vapid-public-key`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { key: string | null; enabled: boolean };
    return data.enabled ? data.key : null;
  },
  reportDevice: (body: DeviceReportBody) =>
    call<DeviceReportResult>('/me/device', { method: 'POST', body: JSON.stringify(body) }),
  getPrefs: () => call<NotifPrefs>('/me/notification-prefs'),
  putPrefs: (prefs: Partial<NotifPrefs>) =>
    call<NotifPrefs>('/me/notification-prefs', { method: 'PUT', body: JSON.stringify(prefs) }),
  pushTest: () => call<PushSendResult>('/me/push-test', { method: 'POST' }),
  adminOverview: () => call<AdminOverview>('/admin/overview'),
  adminNotifyGate: () => call<{ kinds: NotifyGateKind[] }>('/admin/notify-gate'),
  setNotifyGate: (kind: string, on: boolean) =>
    call<{ kinds: NotifyGateKind[] }>('/admin/notify-gate', { method: 'PUT', body: JSON.stringify({ kind, on }) }),
  adminPush: (body: { title: string; body: string; url: string; user_ids: string[] }) =>
    call<PushSendResult>('/admin/push', { method: 'POST', body: JSON.stringify(body) }),
  gameBoard: (guildId: string, players?: number) =>
    call<GameBoard>(`/games/${guildId}/board${players ? `?players=${players}` : ''}`),
  recoFeed: (guildId: string, limit?: number) => call<RecoFeed>(`/reco/${guildId}/feed${limit ? `?limit=${limit}` : ''}`),
  recoShelf: (guildId: string) => call<{ items: ShelfItem[]; total: number }>(`/reco/${guildId}/shelf`),
  recoBox: (guildId: string) => call<{ items: BoxItem[] }>(`/reco/${guildId}/box`),
  recoBoxAdd: (guildId: string, text: string) =>
    call<{ results: BoxAddResult[] }>(`/reco/${guildId}/box`, { method: 'POST', body: JSON.stringify({ text }) }),
  recoBoxRemove: (guildId: string, id: number) => call<{ ok: boolean }>(`/reco/${guildId}/box/${id}`, { method: 'DELETE' }),
  recoFeedback: (guildId: string, key: string, action: 'play' | 'dismiss', mood?: string) =>
    call<{ ok: boolean }>(`/reco/${guildId}/feedback`, { method: 'POST', body: JSON.stringify({ key, action, mood }) }),
  sceneSongs: (guildId: string) => call<{ songs: SceneSong[]; updated_at: string | null }>(`/scene/${guildId}/songs`),
  steamStatus: () => call<SteamLink>('/me/steam'),
  linkSteam: (profile: string) =>
    call<SteamLink & { ok: boolean; wishlist: number | null }>('/me/steam', { method: 'POST', body: JSON.stringify({ profile }) }),
  unlinkSteam: () => call<{ linked: false }>('/me/steam', { method: 'DELETE' }),
  markGame: (guildId: string, appid: string, kind: 'want' | 'own', on: boolean) =>
    call<{ appid: string; want: string[]; own: string[] }>(`/games/${guildId}/${appid}/mark`, {
      method: 'POST',
      body: JSON.stringify({ kind, on }),
    }),
};
