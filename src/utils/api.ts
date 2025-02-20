import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

if (!API_URL) {
  throw new Error('API URL is not defined. Please set NEXT_PUBLIC_API_URL environment variable.');
}

export interface User {
  id: string;
  name: string | null;
  image: string | null;
}

export interface PlayableItem {
  title: string;
  artist: string;
  thumbnail: string;
  url: string;
  type?: string;
}

export interface Section {
  title: string;
  contents: SearchItem[];
}

export interface Track extends PlayableItem {
  added_by?: User;
}

export interface SearchItem extends PlayableItem {
  type: string;  // 'song', 'video', 'album', 'playlist'
  browseId?: string;
  artistId?: string;
  items?: Track[];
}

export interface QueueItem {
  track: Track;
  position: number;
  isCurrent: boolean;
}

export interface Server {
  id: string;
  name: string;
  icon?: string;
  owner?: boolean;
  permissions?: string;
}

export interface VoiceChannel {
  id: string;
  name: string;
}

export interface ValorantPlayerCard {
  small: string;
  large: string;
  wide: string;
  id: string;
  assets: Record<string, string>;
}

export interface ValorantRank {
  tier: number;
  tier_name: string;
  division: string;
  rank_score: number;
  elo?: number;
  images: {
    small: string;
    large: string;
  };
}

export interface ValorantPlayer {
  puuid: string;
  game_name: string;
  tag_line: string;
  region: string;
  account_level: number;
  card: ValorantPlayerCard;
  rank?: ValorantRank;
  last_updated: string;
  is_authenticated: boolean;
}

export interface ValorantWeaponSkin {
  uuid: string;
  name: string;
  price?: number;
  image: string;
  rarity: string;
  rarity_weight: number;
  featured: boolean;
}

export interface ValorantStore {
  daily_offers: ValorantWeaponSkin[];
  featured_bundle?: Record<string, unknown>;
  remaining_duration: {
    daily: number;
    featured: number;
  };
}

export interface ValorantAgent {
  uuid: string;
  name: string;
  role: string;
  images: {
    small: string;
    full: string;
    bust: string;
    killfeed: string;
  };
  stats?: Record<string, string>;
}

// ArtistData内のanyをunknownなどにして @typescript-eslint/no-explicit-any を回避
export interface ArtistData {
  name: string;
  subscribers?: string;
  thumbnails: {
    url: string;
    width?: number;
    height?: number;
  }[];
  songs: unknown[];    // 必要に応じてSong[]に修正
  albums: unknown[];
  related: unknown[];
}

// WebSocket受信時のデータ型例
interface WebSocketData {
  queue: QueueItem[];
  is_playing: boolean;
  history: QueueItem[];
}

// Realtime Sessionレスポンス
interface RealtimeSessionData {
  client_secret: {
    value: string;
  };
}

export const api = {
  getServers: async (): Promise<Server[]> => {
    const response = await axios.get(`${API_URL}/servers`);
    return response.data;
  },

  getUserGuilds: async (): Promise<Server[]> => {
    const response = await axios.get('/api/discord/guilds');
    return response.data;
  },
  getBotGuilds: async (): Promise<Server[]> => {
    const response = await axios.get(`${API_URL}/servers`);
    return response.data;
  },

  getVoiceChannels: async (serverId: string): Promise<VoiceChannel[]> => {
    const response = await axios.get(`${API_URL}/voice-channels/${serverId}`);
    return response.data;
  },

  joinVoiceChannel: async (serverId: string, channelId: string): Promise<void> => {
    await axios.post(`${API_URL}/join-voice-channel/${serverId}/${channelId}`);
  },

  disconnectVoiceChannel: async (guildId: string): Promise<void> => {
    await axios.post(`${API_URL}/disconnect-voice-channel/${guildId}`);
  },

  getCurrentTrack: async (guildId: string): Promise<Track | null> => {
    const response = await axios.get(`${API_URL}/current-track/${guildId}`);
    return response.data;
  },

  getQueue: async (guildId: string): Promise<QueueItem[]> => {
    const response = await axios.get(`${API_URL}/queue/${guildId}`);
    return response.data;
  },

  isPlaying: async (guildId: string): Promise<boolean> => {
    const response = await axios.get(`${API_URL}/is-playing/${guildId}`);
    return response.data;
  },

  playTrack: async (guildId: string, track: Track, user: User): Promise<void> => {
    await axios.post(`${API_URL}/play/${guildId}`, { track, user });
  },

  pausePlayback: async (guildId: string): Promise<void> => {
    await axios.post(`${API_URL}/pause/${guildId}`);
  },

  resumePlayback: async (guildId: string): Promise<void> => {
    await axios.post(`${API_URL}/resume/${guildId}`);
  },

  skipTrack: async (guildId: string): Promise<void> => {
    await axios.post(`${API_URL}/skip/${guildId}`);
  },

  previousTrack: async (guildId: string): Promise<void> => {
    await axios.post(`${API_URL}/previous/${guildId}`);
  },

  search: async (query: string, filter?: string): Promise<SearchItem[]> => {
    const response = await axios.get(`${API_URL}/search`, { params: { query, filter } });
    return response.data.results;
  },

  getPlaylistItems: async (browseId: string): Promise<Track[]> => {
    const response = await axios.get(`${API_URL}/playlist/${browseId}`);
    return response.data;
  },

  getArtistInfo: async (artistId: string): Promise<ArtistData> => {
    const response = await axios.get(`${API_URL}/artist/${artistId}`);
    return response.data as ArtistData;
  },

  getAlbumItems: async (albumId: string): Promise<Track[]> => {
    const response = await axios.get(`${API_URL}/album/${albumId}`);
    return response.data;
  },

  addUrl: async (guildId: string, url: string, user: User): Promise<void> => {
    await axios.post(`${API_URL}/add-url/${guildId}`, { url, user });
  },

  reorderQueue: async (guildId: string, startIndex: number, endIndex: number): Promise<void> => {
    await axios.post(`${API_URL}/reorder-queue/${guildId}`, {
      start_index: startIndex,
      end_index: endIndex,
    });
  },

  setVolume: async (guildId: string, volume: number): Promise<void> => {
    await axios.post(`${API_URL}/set-volume/${guildId}`, { volume });
  },

  seek: async (guildId: string, position: number): Promise<void> => {
    await axios.post(`${API_URL}/seek/${guildId}`, { position });
  },

  getBotVoiceStatus: async (serverId: string): Promise<string | null> => {
    const response = await axios.get(`${API_URL}/bot-voice-status/${serverId}`);
    return response.data.channel_id;
  },

  getRecommendations: async (): Promise<Section[]> => {
    const response = await axios.get(`${API_URL}/recommendations`);
    return response.data;
  },

  getCharts: async (): Promise<SearchItem[]> => {
    const response = await axios.get(`${API_URL}/charts`);
    return response.data.results;
  },

  getRelatedSongs: async (videoId: string): Promise<SearchItem[]> => {
    const response = await axios.get(`${API_URL}/related/${videoId}`);
    return response.data.results;
  },

  getHistory: async (guildId: string): Promise<QueueItem[]> => {
    const response = await axios.get(`${API_URL}/history/${guildId}`);
    return response.data;
  },

  removeFromQueue: async (guildId: string, position: number): Promise<void> => {
    await axios.post(`${API_URL}/remove-from-queue/${guildId}?position=${position}`);
  },

  getRealtimeSession: async (): Promise<RealtimeSessionData> => {
    const response = await axios.post(`${API_URL}/realtime-session`, {
      modalities: ["text"]
    });
    return response.data;
  },

  // VALORANT関連のメソッドを追加
  valorant: {
    // プレイヤー情報の取得
    getPlayerInfo: async (name: string, tag: string): Promise<ValorantPlayer> => {
      const response = await axios.get(`${API_URL}/valorant/player/${name}/${tag}`);
      return response.data;
    },

    // ストア情報の取得
    getStore: async (puuid: string): Promise<ValorantStore> => {
      const response = await axios.get(`${API_URL}/valorant/store/${puuid}`);
      return response.data;
    },

    // エージェント情報の取得
    getAgents: async (): Promise<ValorantAgent[]> => {
      const response = await axios.get(`${API_URL}/valorant/agents`);
      return response.data;
    },
  },
};

export function setupWebSocket(guildId: string, onMessage: (data: WebSocketData) => void): WebSocket {
  if (!process.env.NEXT_PUBLIC_API_URL) {
    throw new Error('API URL is not defined. Please set NEXT_PUBLIC_API_URL environment variable.');
  }
  const wsUrl = `${process.env.NEXT_PUBLIC_API_URL.replace(/^http/, 'ws')}/ws/${guildId}`;
  const ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log("WebSocket 接続成功");
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "update") {
        onMessage(data.data);
      }
    } catch (error) {
      console.error("WebSocket メッセージ解析エラー:", error);
    }
  };

  ws.onclose = () => {
    console.log("WebSocket 接続切断。再接続を試みます...");
    // 数秒後に再接続
    setTimeout(() => {
      setupWebSocket(guildId, onMessage);
    }, 3000);
  };

  ws.onerror = (error) => {
    console.error("WebSocket エラー:", error);
    ws.close();
  };

  return ws;
}

