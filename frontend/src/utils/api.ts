import axios, { AxiosInstance, AxiosError, AxiosRequestConfig } from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL;

if (!API_URL) {
  throw new Error('API URL is not defined. Please set NEXT_PUBLIC_API_URL environment variable.');
}

// API timeout in milliseconds
const REQUEST_TIMEOUT = 30000;

// Maximum retry attempts
const MAX_RETRIES = 3;

// Create an API client with interceptors for better error handling
const createApiClient = (): AxiosInstance => {
  const client = axios.create({
    baseURL: API_URL,
    timeout: REQUEST_TIMEOUT,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Request interceptor
  client.interceptors.request.use(
    (config) => {
      // You can add auth tokens or other common headers here
      return config;
    },
    (error) => Promise.reject(error)
  );

  // Response interceptor with retry logic
  client.interceptors.response.use(
    (response) => response,
    async (error: AxiosError) => {
      const config = error.config as AxiosRequestConfig & { _retry?: number };
      
      // Give up if max retries reached or no config available
      if (!config || !config.url || config._retry === MAX_RETRIES) {
        return Promise.reject(error);
      }
      
      // Retry on network errors or server errors (5xx)
      if (!error.response || (error.response.status >= 500 && error.response.status < 600)) {
        config._retry = (config._retry || 0) + 1;
        
        // Exponential backoff for retries
        const delay = Math.pow(2, config._retry) * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
        
        return client(config);
      }
      
      return Promise.reject(error);
    }
  );

  return client;
};

const apiClient = createApiClient();

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
  stats?: Record<string, unknown>;
}

// Types for artist data avoiding any type
export interface ArtistData {
  name: string;
  subscribers?: string;
  thumbnails: {
    url: string;
    width?: number;
    height?: number;
  }[];
  songs: unknown[];
  albums: unknown[];
  related: unknown[];
}

// Type for WebSocket data
interface WebSocketData {
  queue: QueueItem[];
  is_playing: boolean;
  history: QueueItem[];
}

// Type for realtime session response
interface RealtimeSessionData {
  client_secret: {
    value: string;
  };
}

// Improved error handling utility
const handleApiError = (error: unknown): never => {
  if (axios.isAxiosError(error)) {
    if (error.response) {
      throw new Error(`API error: ${error.response.status} - ${error.response.data?.message || error.message}`);
    } else if (error.request) {
      throw new Error('No response from server. Please check your connection.');
    } else {
      throw new Error(`Request error: ${error.message}`);
    }
  }
  throw error instanceof Error ? error : new Error(String(error));
};

export const api = {
  getServers: async (): Promise<Server[]> => {
    try {
      const response = await apiClient.get('/bot-guilds');
      return response.data;
    } catch (error) {
      handleApiError(error);
    }
    return []; // エラーハンドリング後の空の戻り値
  },

  getUserGuilds: async (): Promise<Server[]> => {
    try {
      const response = await fetch('/api/discord/userGuilds');
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      handleApiError(error);
    }
    return []; // エラーハンドリング後の空の戻り値
  },
  
  getBotGuilds: async (): Promise<Server[]> => {
    try {
      const response = await apiClient.get('/bot-guilds');
      return response.data;
    } catch (error) {
      handleApiError(error);
    }
    return []; // エラーハンドリング後の空の戻り値
  },

  getVoiceChannels: async (serverId: string): Promise<VoiceChannel[]> => {
    try {
      const response = await apiClient.get(`/voice-channels/${serverId}`);
      return response.data;
    } catch (error) {
      handleApiError(error);
    }
    return []; // エラーハンドリング後の空の戻り値
  },

  joinVoiceChannel: async (serverId: string, channelId: string): Promise<void> => {
    try {
      await apiClient.post(`/join-voice-channel/${serverId}/${channelId}`);
    } catch (error) {
      handleApiError(error);
    }
  },

  disconnectVoiceChannel: async (guildId: string): Promise<void> => {
    try {
      await apiClient.post(`/disconnect-voice-channel/${guildId}`);
    } catch (error) {
      handleApiError(error);
    }
  },

  getCurrentTrack: async (guildId: string): Promise<Track | null> => {
    try {
      const response = await apiClient.get(`/current-track/${guildId}`);
      return response.data;
    } catch (error) {
      handleApiError(error);
    }
    return null; // エラーハンドリング後の空の戻り値
  },

  getQueue: async (guildId: string): Promise<QueueItem[]> => {
    try {
      const response = await apiClient.get(`/queue/${guildId}`);
      return response.data;
    } catch (error) {
      handleApiError(error);
    }
    return []; // エラーハンドリング後の空の戻り値
  },

  isPlaying: async (guildId: string): Promise<boolean> => {
    try {
      const response = await apiClient.get(`/is-playing/${guildId}`);
      return response.data;
    } catch (error) {
      handleApiError(error);
    }
    return false; // エラーハンドリング後の空の戻り値
  },

  playTrack: async (guildId: string, track: Track, user: User): Promise<void> => {
    try {
      await apiClient.post(`/play/${guildId}`, { track, user });
    } catch (error) {
      handleApiError(error);
    }
  },

  pausePlayback: async (guildId: string): Promise<void> => {
    try {
      await apiClient.post(`/pause/${guildId}`);
    } catch (error) {
      handleApiError(error);
    }
  },

  resumePlayback: async (guildId: string): Promise<void> => {
    try {
      await apiClient.post(`/resume/${guildId}`);
    } catch (error) {
      handleApiError(error);
    }
  },

  skipTrack: async (guildId: string): Promise<void> => {
    try {
      await apiClient.post(`/skip/${guildId}`);
    } catch (error) {
      handleApiError(error);
    }
  },

  search: async (query: string, filter?: string): Promise<SearchItem[]> => {
    try {
      const response = await apiClient.get('/search', {
        params: { query, filter }
      });
      return response.data.results;
    } catch (error) {
      handleApiError(error);
    }
    return []; // エラーハンドリング後の空の戻り値
  },

  getPlaylistItems: async (browseId: string): Promise<Track[]> => {
    try {
      const response = await apiClient.get(`/playlist/${browseId}`);
      return response.data;
    } catch (error) {
      handleApiError(error);
    }
    return []; // エラーハンドリング後の空の戻り値
  },

  getArtistInfo: async (artistId: string): Promise<ArtistData> => {
    try {
      const response = await apiClient.get(`/artist/${artistId}`);
      return response.data as ArtistData;
    } catch (error) {
      handleApiError(error);
    }
    // エラーハンドリング後のデフォルト値を用意
    return {
      name: 'Unknown',
      thumbnails: [],
      songs: [],
      albums: [],
      related: []
    };
  },

  getAlbumItems: async (albumId: string): Promise<Track[]> => {
    try {
      const response = await apiClient.get(`/album/${albumId}`);
      return response.data;
    } catch (error) {
      handleApiError(error);
    }
    return []; // エラーハンドリング後の空の戻り値
  },

  addUrl: async (guildId: string, url: string, user: User | null): Promise<void> => {
    try {
      await apiClient.post(`/add-url/${guildId}`, { url, user });
    } catch (error) {
      handleApiError(error);
    }
  },

  reorderQueue: async (guildId: string, startIndex: number, endIndex: number): Promise<void> => {
    try {
      await apiClient.post(`/reorder-queue/${guildId}`, {
        start_index: startIndex,
        end_index: endIndex,
      });
    } catch (error) {
      handleApiError(error);
    }
  },

  setVolume: async (guildId: string, volume: number): Promise<void> => {
    try {
      await apiClient.post(`/set-volume/${guildId}`, { volume });
    } catch (error) {
      handleApiError(error);
    }
  },

  seek: async (guildId: string, position: number): Promise<void> => {
    try {
      await apiClient.post(`/seek/${guildId}`, { position });
    } catch (error) {
      handleApiError(error);
    }
  },

  getBotVoiceStatus: async (serverId: string): Promise<string | null> => {
    try {
      const response = await apiClient.get(`/bot-voice-status/${serverId}`);
      return response.data.channel_id;
    } catch (error) {
      handleApiError(error);
    }
    return null; // エラーハンドリング後の空の戻り値
  },

  getRecommendations: async (): Promise<Section[]> => {
    try {
      const response = await apiClient.get('/recommendations');
      return response.data;
    } catch (error) {
      handleApiError(error);
    }
    return []; // エラーハンドリング後の空の戻り値
  },

  getCharts: async (): Promise<SearchItem[]> => {
    try {
      const response = await apiClient.get('/charts');
      return response.data.results;
    } catch (error) {
      handleApiError(error);
    }
    return []; // エラーハンドリング後の空の戻り値
  },

  getRelatedSongs: async (videoId: string): Promise<SearchItem[]> => {
    try {
      const response = await apiClient.get(`/related/${videoId}`);
      return response.data.results;
    } catch (error) {
      handleApiError(error);
    }
    return []; // エラーハンドリング後の空の戻り値
  },

  getHistory: async (guildId: string): Promise<QueueItem[]> => {
    try {
      const response = await apiClient.get(`/history/${guildId}`);
      return response.data;
    } catch (error) {
      handleApiError(error);
    }
    return []; // エラーハンドリング後の空の戻り値
  },

  removeFromQueue: async (guildId: string, position: number): Promise<void> => {
    try {
      await apiClient.post(`/remove-from-queue/${guildId}`, undefined, { 
        params: { position } 
      });
    } catch (error) {
      handleApiError(error);
    }
  },

  getRealtimeSession: async (): Promise<RealtimeSessionData> => {
    try {
      const response = await apiClient.post('/realtime-session', {
        modalities: ["text"]
      });
      return response.data;
    } catch (error) {
      handleApiError(error);
    }
    return { client_secret: { value: '' } }; // エラーハンドリング後のデフォルト値
  },

  // VALORANT related methods
  valorant: {
    getPlayerInfo: async (name: string, tag: string): Promise<ValorantPlayer> => {
      try {
        const response = await apiClient.get(`/valorant/player/${name}/${tag}`);
        return response.data;
      } catch (error) {
        handleApiError(error);
      }
      // エラーハンドリング後のデフォルト値
      return {
        puuid: '',
        game_name: '',
        tag_line: '',
        region: '',
        account_level: 0,
        card: { small: '', large: '', wide: '', id: '', assets: {} },
        last_updated: '',
        is_authenticated: false
      };
    },

    getStore: async (puuid: string): Promise<ValorantStore> => {
      try {
        const response = await apiClient.get(`/valorant/store/${puuid}`);
        return response.data;
      } catch (error) {
        handleApiError(error);
      }
      // エラーハンドリング後のデフォルト値
      return {
        daily_offers: [],
        remaining_duration: { daily: 0, featured: 0 }
      };
    },

    getAgents: async (): Promise<ValorantAgent[]> => {
      try {
        const response = await apiClient.get('/valorant/agents');
        return response.data;
      } catch (error) {
        handleApiError(error);
      }
      return []; // エラーハンドリング後の空の戻り値
    },
  },
};

// Improved WebSocket connection with reconnection logic
export function setupWebSocket(guildId: string, onMessage: (data: WebSocketData) => void): WebSocket {
  if (!API_URL) {
    throw new Error('API URL is not defined. Please set NEXT_PUBLIC_API_URL environment variable.');
  }
  
  const wsUrl = `${API_URL.replace(/^http/, 'ws')}/ws/${guildId}`;
  let ws: WebSocket | null = new WebSocket(wsUrl);
  let reconnectTimer: NodeJS.Timeout | null = null;
  let reconnectAttempts = 0;
  const MAX_RECONNECT_ATTEMPTS = 5;
  const RECONNECT_DELAY = 3000;

  const connect = () => {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log("WebSocket connected");
      reconnectAttempts = 0; // Reset counter on successful connection
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "update") {
          onMessage(data.data);
        }
      } catch (error) {
        console.error("WebSocket message parse error:", error);
      }
    };

    ws.onclose = (event) => {
      console.log(`WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`);
      
      // Don't reconnect if it was a clean closure
      if (event.wasClean) {
        return;
      }
      
      // Try to reconnect with exponential backoff
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = RECONNECT_DELAY * Math.pow(1.5, reconnectAttempts - 1);
        console.log(`Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) in ${delay}ms...`);
        
        reconnectTimer = setTimeout(connect, delay);
      } else {
        console.error(`WebSocket reconnection failed after ${MAX_RECONNECT_ATTEMPTS} attempts`);
      }
    };

    ws.onerror = (error) => {
      console.error("WebSocket error:", error);
    };
  };

  // Initial connection
  connect();

  // Return an extended WebSocket with proper cleanup methods
  const extendedWs = {
    send: (data: string) => ws?.send(data),
    close: () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.close();
        ws = null;
      }
    }
  };

  // We need to cast this to WebSocket as we're extending the interface
  return extendedWs as unknown as WebSocket;
}