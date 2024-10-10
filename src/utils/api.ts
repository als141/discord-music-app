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

// 共通のインターフェースを定義
export interface PlayableItem {
  title: string;
  artist: string;
  thumbnail: string;
  url: string;
}

export interface Track extends PlayableItem {
  added_by?: User;
}

export interface SearchItem extends PlayableItem {
  type: string;  // 'song', 'video', 'album', 'playlist'
  browseId?: string;
  items?: Track[];
}

export interface Track {
  title: string;
  artist: string;
  thumbnail: string;
  url: string;
  added_by?: User; // フィールド名を 'added_by' に修正
}

export interface SearchItem {
  type: string;  // 'song', 'video', 'album', 'playlist'
  title: string;
  artist: string;
  thumbnail: string;
  url: string;
  browseId?: string;
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

interface QueueData {
  queue: QueueItem[];
  is_playing: boolean;
  history: QueueItem[];
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
    const response = await axios.get(`${API_URL}/bot-guilds`);
    return response.data;
  },

  getVoiceChannels: async (serverId: string): Promise<VoiceChannel[]> => {
    const response = await axios.get(`${API_URL}/voice-channels/${serverId}`);
    return response.data;
  },

  joinVoiceChannel: async (serverId: string, channelId: string): Promise<void> => {
    await axios.post(`${API_URL}/join-voice-channel/${serverId}/${channelId}`);
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

  search: async (query: string): Promise<SearchItem[]> => {
    const response = await axios.get(`${API_URL}/search`, { params: { query } });
    return response.data.results;
  },

  getPlaylistItems: async (browseId: string): Promise<Track[]> => {
    const response = await axios.get(`${API_URL}/playlist/${browseId}`);
    return response.data;
  },

  getAlbumItems: async (browseId: string): Promise<Track[]> => {
    const response = await axios.get(`${API_URL}/album/${browseId}`);
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

  getRecommendations: async (): Promise<SearchItem[]> => {
    const response = await axios.get(`${API_URL}/recommendations`);
    return response.data.results;
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
};

export const setupWebSocket = (guildId: string, onUpdate: (data: QueueData) => void) => {
  const protocol = API_URL.startsWith('https') ? 'wss' : 'ws';
  const host = API_URL.replace(/^https?:\/\//, '');
  const wsUrl = `${protocol}://${host}/ws/${guildId}`;

  const ws = new WebSocket(wsUrl);

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'update') {
      onUpdate(message.data);
    }
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };

  ws.onclose = () => {
    console.log('WebSocket connection closed');
    // 再接続を試みる
    // setTimeout(() => setupWebSocket(guildId, onUpdate), 5000); // setTimeout を削除
    setupWebSocket(guildId, onUpdate) // 即時再接続を試みる
  };

  return ws;
};
