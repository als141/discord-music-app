import axios from 'axios';

const API_URL = 'http://localhost:8000';

export interface Track {
  title: string;
  artist: string;
  thumbnail: string;
  url: string;
}

export interface QueueItem {
  track: Track;
  position: number;
  isCurrent: boolean;
}

export interface Server {
  id: string;
  name: string;
}

export interface VoiceChannel {
  id: string;
  name: string;
}

export const api = {
  getServers: async (): Promise<Server[]> => {
    const response = await axios.get(`${API_URL}/servers`);
    return response.data;
  },

  getVoiceChannels: async (guildId: string): Promise<VoiceChannel[]> => {
    const response = await axios.get(`${API_URL}/voice-channels/${guildId}`);
    return response.data;
  },

  joinVoiceChannel: async (guildId: string, channelId: string): Promise<void> => {
    await axios.post(`${API_URL}/join-voice-channel/${guildId}/${channelId}`);
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

  playTrack: async (guildId: string, track: Track): Promise<void> => {
    await axios.post(`${API_URL}/play/${guildId}`, track);
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

  search: async (query: string): Promise<Track[]> => {
    const response = await axios.get(`${API_URL}/search`, { params: { query } });
    return response.data.tracks;
  },

  addUrl: async (guildId: string, url: string): Promise<void> => {
    await axios.post(`${API_URL}/add-url/${guildId}`, { url });
  },

  reorderQueue: async (guildId: string, startIndex: number, endIndex: number): Promise<void> => {
    await axios.post(`${API_URL}/reorder-queue/${guildId}`, {
      start_index: startIndex,
      end_index: endIndex,
    });
  },
};

export const setupWebSocket = (guildId: string, onUpdate: (data: any) => void) => {
  const ws = new WebSocket(`ws://localhost:8000/ws/${guildId}`);

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
    setTimeout(() => setupWebSocket(guildId, onUpdate), 5000);
  };

  return ws;
};