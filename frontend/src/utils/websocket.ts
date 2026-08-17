// src/utils/websocket.ts
/**
 * WebSocket接続を管理するユーティリティ
 * - 無制限の自動再接続（指数バックオフ、上限あり。タブ非表示中は間隔を延ばす）
 * - 生存監視: サーバーの ping / 自分の ping→pong で「開いているが死んでいる」接続を検出して張り直す
 * - タブ復帰 / オンライン復帰 / フォーカス時に即再接続 or 状態の再同期要求（sync）
 * - エラー処理
 */

export interface WebSocketOptions {
    /** 最大再接続試行回数（Infinity で無制限） */
    maxReconnectAttempts?: number;
    /** 初期再接続待ち時間（ミリ秒） */
    reconnectBaseDelay?: number;
    /** 再接続の最大待ち時間（ミリ秒） */
    maxReconnectDelay?: number;
    /** タブ非表示中の再接続の最大待ち時間（ミリ秒） */
    hiddenMaxReconnectDelay?: number;
    /** 接続が閉じられたときのコールバック */
    onClose?: () => void;
    /** エラー発生時のコールバック */
    onError?: (error: Event) => void;
    /** 接続確立時のコールバック */
    onOpen?: () => void;
    /** 再接続をあきらめたときのコールバック */
    onGiveUp?: () => void;
    /** クライアント→サーバー ping の間隔（ミリ秒） 0の場合は無効 */
    heartbeatInterval?: number;
    /** この時間サーバーから何も届かなければ接続を死んだとみなして張り直す（ミリ秒） */
    staleTimeout?: number;
    /** デバッグモード */
    debug?: boolean;
}

// Message handler type definition
type MessageHandler = (data: Record<string, unknown>) => void;

export class WSConnection {
    private ws: WebSocket | null = null;
    private url: string;
    private options: Required<WebSocketOptions>;
    private reconnectAttempts = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private messageHandlers: Array<MessageHandler> = [];
    private lastMessageTime = 0;
    private isIntentionallyClosed = false;
    private everConnected = false;
    private readonly boundOnVisibility: () => void;
    private readonly boundOnOnline: () => void;

    constructor(url: string, options: WebSocketOptions = {}) {
        this.url = url;
        this.options = {
            maxReconnectAttempts: options.maxReconnectAttempts ?? Infinity,
            reconnectBaseDelay: options.reconnectBaseDelay ?? 1000,
            maxReconnectDelay: options.maxReconnectDelay ?? 15000,
            hiddenMaxReconnectDelay: options.hiddenMaxReconnectDelay ?? 60000,
            onClose: options.onClose ?? (() => {}),
            onError: options.onError ?? (() => {}),
            onOpen: options.onOpen ?? (() => {}),
            onGiveUp: options.onGiveUp ?? (() => {}),
            heartbeatInterval: options.heartbeatInterval ?? 25000,
            staleTimeout: options.staleTimeout ?? 75000,
            debug: options.debug ?? false,
        };

        this.boundOnVisibility = () => this.handleWake('visibilitychange');
        this.boundOnOnline = () => this.handleWake('online');
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', this.boundOnVisibility);
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('online', this.boundOnOnline);
            window.addEventListener('focus', this.boundOnVisibility);
            window.addEventListener('pageshow', this.boundOnVisibility);
        }

        this.connect();
    }

    /**
     * WebSocket接続を開始する
     */
    private connect(): void {
        if (this.isIntentionallyClosed) return;
        this.log('WebSocket接続を開始します', this.url);

        // 古いソケットが残っていればハンドラを外して破棄
        if (this.ws) {
            this.detachSocket(this.ws);
            try { this.ws.close(); } catch { /* noop */ }
            this.ws = null;
        }

        try {
            const ws = new WebSocket(this.url);
            this.ws = ws;
            ws.onopen = () => { if (this.ws === ws) this.handleOpen(); };
            ws.onmessage = (ev) => { if (this.ws === ws) this.handleMessage(ev); };
            ws.onclose = (ev) => { if (this.ws === ws) this.handleClose(ev); };
            ws.onerror = (ev) => { if (this.ws === ws) this.handleError(ev); };
        } catch (error) {
            this.log('WebSocket接続の作成に失敗しました', error);
            this.scheduleReconnect();
        }
    }

    private detachSocket(ws: WebSocket): void {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
    }

    /**
     * 接続が確立されたときの処理
     */
    private handleOpen(): void {
        this.log('WebSocket接続が確立されました');
        this.reconnectAttempts = 0;
        this.everConnected = true;
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
            // ping/pong は生存確認のみ（lastMessageTime 更新済み）
            if (data.type === 'ping' || data.type === 'pong') return;
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
        this.ws = null;

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
        if (this.isIntentionallyClosed) return;
        if (this.reconnectTimer) return; // 既にスケジュール済み
        if (this.reconnectAttempts >= this.options.maxReconnectAttempts) {
            this.log(`最大再接続試行回数 (${this.options.maxReconnectAttempts}) に達しました`);
            this.options.onGiveUp();
            return;
        }

        this.reconnectAttempts++;

        const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
        const cap = hidden ? this.options.hiddenMaxReconnectDelay : this.options.maxReconnectDelay;
        // 指数バックオフ + ランダム要素を追加して再接続の集中を避ける
        const delay = Math.min(
            this.options.reconnectBaseDelay * Math.pow(1.6, this.reconnectAttempts - 1) * (1 + 0.3 * Math.random()),
            cap
        );

        this.log(`${this.reconnectAttempts}回目の再接続を ${Math.round(delay)}ms 後に試みます`);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }

    /**
     * タブ復帰・オンライン復帰・フォーカス時: 切れていれば即再接続、開いていれば状態を再同期
     */
    private handleWake(reason: string): void {
        if (this.isIntentionallyClosed) return;
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

        if (this.isOpen()) {
            // 開いていても裏で取りこぼしている可能性があるので、古ければ張り直し・そうでなければ sync
            if (Date.now() - this.lastMessageTime > this.options.staleTimeout) {
                this.log(`${reason}: 接続が古いため張り直します`);
                this.forceReconnect();
            } else {
                this.log(`${reason}: 状態の再同期を要求します`);
                this.requestSync();
            }
            return;
        }

        this.log(`${reason}: 未接続のため即時再接続します`);
        this.reconnectAttempts = 0;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.connect();
    }

    /**
     * ハートビート（クライアント→サーバー ping と生存監視）を開始する
     */
    private startHeartbeat(): void {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.options.heartbeatInterval <= 0) return;

        this.heartbeatTimer = setInterval(() => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                return;
            }
            const silentFor = Date.now() - this.lastMessageTime;
            if (silentFor > this.options.staleTimeout) {
                // サーバー ping（30秒間隔）も自分の pong も届いていない → 死んだ接続とみなす
                this.log(`サーバーから ${Math.round(silentFor / 1000)} 秒応答がないため接続を張り直します`);
                this.forceReconnect();
                return;
            }
            this.send({ type: 'ping' });
        }, this.options.heartbeatInterval);
    }

    /**
     * 現在の接続を捨てて張り直す（onclose 経由で scheduleReconnect が走る）
     */
    public forceReconnect(): void {
        if (this.isIntentionallyClosed) return;
        const ws = this.ws;
        this.cleanupTimers();
        this.ws = null;
        if (ws) {
            this.detachSocket(ws);
            try { ws.close(4000, 'stale connection'); } catch { /* noop */ }
        }
        this.options.onClose();
        this.reconnectAttempts = 0;
        this.connect();
    }

    /**
     * サーバーに現在の状態の再送を要求する
     */
    public requestSync(): boolean {
        return this.send({ type: 'sync' });
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
     * 接続を閉じる（以後、再接続しない）
     */
    public close(): void {
        this.isIntentionallyClosed = true;
        this.cleanupTimers();

        if (typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this.boundOnVisibility);
        }
        if (typeof window !== 'undefined') {
            window.removeEventListener('online', this.boundOnOnline);
            window.removeEventListener('focus', this.boundOnVisibility);
            window.removeEventListener('pageshow', this.boundOnVisibility);
        }

        if (this.ws) {
            const ws = this.ws;
            this.detachSocket(ws);
            if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                ws.close(1000, 'Normal closure');
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
     * 一度でも接続に成功したか
     */
    public hasEverConnected(): boolean {
        return this.everConnected;
    }

    /**
     * 接続のステータスを取得
     */
    public getStatus(): 'CONNECTING' | 'OPEN' | 'CLOSING' | 'CLOSED' | 'RECONNECTING' | 'NOT_CONNECTED' {
        if (this.reconnectTimer !== null) return 'RECONNECTING';
        if (this.ws === null) return 'NOT_CONNECTED';

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
    /** サーバー側で音源を準備中（yt-dlp 抽出/DL）。UI のバッファリング表示用 */
    is_loading?: boolean;
    history?: unknown[];
    version?: number;
    /** MusicPlayer インスタンスの世代ID。変わったら version 比較をリセットする */
    epoch?: string | null;
    has_player?: boolean;
    timestamp?: number;
    current_track?: unknown;
    [key: string]: unknown;
}

export interface WebSocketHandle {
    close: () => void;
    requestSync: () => boolean;
    forceReconnect: () => void;
    isOpen: () => boolean;
}

/**
 * 指定されたギルドIDに対するWebSocket接続を作成する
 * @param guildId ギルドID
 * @param onMessage メッセージ受信時のコールバック
 * @param options WebSocket接続オプション
 * @returns WebSocket接続ハンドル
 */
export function createWebSocketConnection(
    guildId: string,
    onMessage: (data: WebSocketData) => void,
    options: WebSocketOptions = {}
): WebSocketHandle {
    if (!process.env.NEXT_PUBLIC_API_URL) {
        throw new Error('API URL is not defined. Please set NEXT_PUBLIC_API_URL environment variable.');
    }

    const wsUrl = `${process.env.NEXT_PUBLIC_API_URL.replace(/^http/, 'ws')}/ws/${guildId}`;
    const wsConnection = new WSConnection(wsUrl, {
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
        requestSync: () => wsConnection.requestSync(),
        forceReconnect: () => wsConnection.forceReconnect(),
        isOpen: () => wsConnection.isOpen(),
    };
}
