// src/utils/websocket.ts
/**
 * WebSocket接続を管理する強化されたユーティリティ
 * - 自動再接続機能
 * - 指数バックオフによる再試行
 * - ハートビート機能
 * - エラー処理
 */

export interface WebSocketOptions {
    /** 最大再接続試行回数 */
    maxReconnectAttempts?: number;
    /** 初期再接続待ち時間（ミリ秒） */
    reconnectBaseDelay?: number;
    /** 再接続の最大待ち時間（ミリ秒） */
    maxReconnectDelay?: number;
    /** 接続が閉じられたときのコールバック */
    onClose?: () => void;
    /** エラー発生時のコールバック */
    onError?: (error: Event) => void;
    /** 接続確立時のコールバック */
    onOpen?: () => void;
    /** ハートビート間隔（ミリ秒） 0の場合は無効 */
    heartbeatInterval?: number;
    /** ハートビートメッセージ */
    heartbeatMessage?: string | object;
    /** デバッグモード */
    debug?: boolean;
}

// Message handler type definition
type MessageHandler = (data: Record<string, unknown>) => void;

class WSConnection {
    private ws: WebSocket | null = null;
    private url: string;
    private options: Required<WebSocketOptions>;
    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private heartbeatTimer: NodeJS.Timeout | null = null;
    private messageHandlers: Array<MessageHandler> = [];
    private lastMessageTime = 0;
    private isIntentionallyClosed = false;

    constructor(url: string, options: WebSocketOptions = {}) {
        this.url = url;
        this.options = {
            maxReconnectAttempts: options.maxReconnectAttempts ?? 10,
            reconnectBaseDelay: options.reconnectBaseDelay ?? 1000,
            maxReconnectDelay: options.maxReconnectDelay ?? 30000,
            onClose: options.onClose ?? (() => {}),
            onError: options.onError ?? (() => {}),
            onOpen: options.onOpen ?? (() => {}),
            heartbeatInterval: options.heartbeatInterval ?? 30000,
            heartbeatMessage: options.heartbeatMessage ?? { type: 'ping' },
            debug: options.debug ?? false,
        };

        this.connect();
    }

    /**
     * WebSocket接続を開始する
     */
    private connect(): void {
        this.log('WebSocket接続を開始します', this.url);
        
        try {
            this.ws = new WebSocket(this.url);
            
            this.ws.onopen = this.handleOpen.bind(this);
            this.ws.onmessage = this.handleMessage.bind(this);
            this.ws.onclose = this.handleClose.bind(this);
            this.ws.onerror = this.handleError.bind(this);
        } catch (error) {
            this.log('WebSocket接続の作成に失敗しました', error);
            this.scheduleReconnect();
        }
    }

    /**
     * 接続が確立されたときの処理
     */
    private handleOpen(): void {
        this.log('WebSocket接続が確立されました');
        this.reconnectAttempts = 0;
        this.lastMessageTime = Date.now();
        this.startHeartbeat();
        this.options.onOpen();
    }

    /**
     * メッセージを受信したときの処理
     */
    private handleMessage(event: MessageEvent): void {
        this.lastMessageTime = Date.now();
        
        try {
            const data = JSON.parse(event.data) as Record<string, unknown>;
            this.messageHandlers.forEach(handler => {
                try {
                    handler(data);
                } catch (err) {
                    this.log('メッセージハンドラでエラーが発生しました', err);
                }
            });
        } catch (error) {
            this.log('JSONの解析に失敗しました', error);
        }
    }

    /**
     * 接続が閉じられたときの処理
     */
    private handleClose(event: CloseEvent): void {
        this.log(`WebSocket接続が閉じられました: ${event.code} ${event.reason}`);
        this.cleanupTimers();
        
        if (!this.isIntentionallyClosed) {
            this.scheduleReconnect();
        }
        
        this.options.onClose();
    }

    /**
     * エラーが発生したときの処理
     */
    private handleError(error: Event): void {
        this.log('WebSocketエラーが発生しました', error);
        this.options.onError(error);
        
        // エラー後に自動的にoncloseが呼ばれるため、ここでは再接続処理は行わない
    }

    /**
     * 再接続をスケジュールする
     */
    private scheduleReconnect(): void {
        if (this.isIntentionallyClosed || 
            this.reconnectAttempts >= this.options.maxReconnectAttempts) {
            this.log(`最大再接続試行回数 (${this.options.maxReconnectAttempts}) に達しました`);
            return;
        }
        
        this.reconnectAttempts++;
        
        // 指数バックオフ + ランダム要素を追加して再接続の集中を避ける
        const delay = Math.min(
            this.options.reconnectBaseDelay * Math.pow(1.5, this.reconnectAttempts - 1) * (1 + 0.2 * Math.random()),
            this.options.maxReconnectDelay
        );
        
        this.log(`${this.reconnectAttempts}回目の再接続を ${Math.round(delay)}ms 後に試みます`);
        
        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, delay);
    }

    /**
     * ハートビートを開始する
     */
    private startHeartbeat(): void {
        if (this.options.heartbeatInterval <= 0) return;
        
        this.heartbeatTimer = setInterval(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                // 最後のメッセージから一定時間経過していたらハートビートを送信
                const now = Date.now();
                if (now - this.lastMessageTime > this.options.heartbeatInterval) {
                    this.log('ハートビートを送信します');
                    this.send(this.options.heartbeatMessage);
                }
            } else {
                this.cleanupTimers();
            }
        }, this.options.heartbeatInterval);
    }

    /**
     * タイマーをクリーンアップする
     */
    private cleanupTimers(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    /**
     * ログ出力
     */
    private log(message: string, ...args: unknown[]): void {
        if (this.options.debug) {
            console.log(`[WebSocket] ${message}`, ...args);
        }
    }

    /**
     * メッセージ受信時のハンドラを追加
     */
    public addMessageHandler(handler: MessageHandler): void {
        this.messageHandlers.push(handler);
    }

    /**
     * メッセージ受信時のハンドラを削除
     */
    public removeMessageHandler(handler: MessageHandler): void {
        const index = this.messageHandlers.indexOf(handler);
        if (index !== -1) {
            this.messageHandlers.splice(index, 1);
        }
    }

    /**
     * メッセージを送信する
     */
    public send(data: string | object): boolean {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.log('WebSocketが接続されていないため、メッセージを送信できません');
            return false;
        }
        
        try {
            const message = typeof data === 'string' ? data : JSON.stringify(data);
            this.ws.send(message);
            return true;
        } catch (error) {
            this.log('メッセージの送信に失敗しました', error);
            return false;
        }
    }

    /**
     * 接続を閉じる
     */
    public close(): void {
        this.isIntentionallyClosed = true;
        this.cleanupTimers();
        
        if (this.ws) {
            if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
                this.ws.close(1000, 'Normal closure');
            }
            this.ws = null;
        }
        
        this.messageHandlers = [];
        this.log('WebSocket接続を閉じました');
    }

    /**
     * 接続が開いているかどうか
     */
    public isOpen(): boolean {
        return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
    }

    /**
     * 接続のステータスを取得
     */
    public getStatus(): 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED' | 'RECONNECTING' | 'NOT_CONNECTED' {
        if (this.ws === null) return 'NOT_CONNECTED';
        if (this.reconnectTimer !== null) return 'RECONNECTING';
        
        switch (this.ws.readyState) {
            case WebSocket.CONNECTING: return 'CONNECTING';
            case WebSocket.OPEN: return 'OPEN';
            case WebSocket.CLOSING: return 'CLOSING';
            case WebSocket.CLOSED: return 'CLOSED';
            default: return 'NOT_CONNECTED';
        }
    }
}

// Type definition for websocket data structure
export interface WebSocketData {
    queue?: unknown[];
    is_playing?: boolean;
    history?: unknown[];
    version?: number;
    timestamp?: number;
    current_track?: unknown;
    [key: string]: unknown;
}

/**
 * 指定されたギルドIDに対するWebSocket接続を作成する
 * @param guildId ギルドID
 * @param onMessage メッセージ受信時のコールバック
 * @param options WebSocket接続オプション
 * @returns WebSocket接続インスタンス
 */
export function createWebSocketConnection(
    guildId: string,
    onMessage: (data: WebSocketData) => void,
    options: WebSocketOptions = {}
): { close: () => void } {
    if (!process.env.NEXT_PUBLIC_API_URL) {
        throw new Error('API URL is not defined. Please set NEXT_PUBLIC_API_URL environment variable.');
    }
    
    const wsUrl = `${process.env.NEXT_PUBLIC_API_URL.replace(/^http/, 'ws')}/ws/${guildId}`;
    const wsConnection = new WSConnection(wsUrl, {
        maxReconnectAttempts: 15,
        debug: process.env.NODE_ENV === 'development',
        ...options,
    });
    
    wsConnection.addMessageHandler((data) => {
        if (data.type === "update") {
            onMessage(data.data as WebSocketData);
        }
    });
    
    return {
        close: () => wsConnection.close(),
    };
}