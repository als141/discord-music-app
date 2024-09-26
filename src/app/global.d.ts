interface Window {
    difyChatbotConfig?: {
      token: string;
      isDev?: boolean;
      baseUrl?: string;
      containerProps?: {
        style?: React.CSSProperties;
      };
      draggable?: boolean;
      dragAxis?: 'both' | 'x' | 'y';
      inputs?: Record<string, any>;
    };
  }