#!/usr/bin/env node
/**
 * リアルタイム同期（WebSocket / 再接続 / epoch / REST フォールバック）の挙動テスト
 *
 * 使い方:
 *   cd frontend && NEXT_PUBLIC_API_URL=https://api.atoriba.jp bun run dev   # 別ターミナル
 *   node scripts/realtime-sync-test.mjs
 *
 * Playwright の routeWebSocket でサーバー側を偽装し、ブラウザ側のストアが
 * 期待どおりに更新されるかを検証する（ログイン不要 /dev-preview を使用）。
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');

const BASE = process.env.PREVIEW_BASE || 'http://localhost:3000';
const GUILD = '1093915551174234212';
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const T = (title, id) => ({ title, artist: 'Test Artist', thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, url: `https://music.youtube.com/watch?v=${id}`, added_by: null });
const state = (current, queue, is_playing, version, epoch) => ({
  queue: [ ...(current ? [{ track: current, position: 0, isCurrent: true }] : []), ...queue.map((t, i) => ({ track: t, position: i + 1, isCurrent: false })) ],
  is_playing, history: [], version, epoch, has_player: true, timestamp: Date.now(),
});
const upd = (s) => JSON.stringify({ type: 'update', data: s });

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log(`OK   ${name}`); } else { fail++; console.log(`FAIL ${name} ${extra}`); } };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1376, height: 870 } });
await context.route('**/api/discord/userGuilds', r => json(r, [{ id: GUILD, name: 'テストサーバー', permissions: '0' }]));
await context.route('**/bot-voice-status/**', r => json(r, { channel_id: 'vc1' }));
await context.route('**/voice-channels/**', r => json(r, [{ id: 'vc1', name: 'ロビー' }]));
await context.route('**/auto-connect-info/**', r => json(r, { guild_id: GUILD, channel_id: 'vc1' }));
await context.route('**/history/**', r => json(r, []));
await context.route('**/recommendations', r => json(r, []));

// REST フォールバック: WebSocket 断中に叩かれる /player-state
let restState = state(T('REST fallback song', 'rest00000001'), [], false, 1, 'epoch-rest');
let restCalls = 0;
await context.route('**/player-state/**', r => { restCalls++; return json(r, restState); });

// WebSocket 偽サーバー
let connections = 0;
let sockets = [];
let received = [];
await context.routeWebSocket(/\/ws\//, ws => {
  connections++;
  sockets.push(ws);
  ws.onMessage(m => { received.push(String(m)); const msg = JSON.parse(String(m)); if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' })); });
  // 接続直後の初期状態（epoch A, version 5）
  ws.send(upd(state(T('Song A', 'aaaaaaaaaaaa'), [T('Song B', 'bbbbbbbbbbbb')], true, 5, 'epoch-A')));
});

const page = await context.newPage();
page.on('pageerror', e => console.log('  pageerror:', e.message));
await page.goto(`${BASE}/dev-preview`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const title = () => page.evaluate(() => document.querySelector('aside h2')?.textContent);
const queueCount = () => page.evaluate(() => document.querySelectorAll('aside [role="tabpanel"] li, aside [role="tabpanel"] [data-queue-item]').length);
const status = () => page.evaluate(() => document.querySelector('header button[aria-label^="接続先"] span:nth-of-type(2) span:nth-of-type(2)')?.textContent);

// 1) 初期状態が反映される
check('初期状態: 曲名 A', (await title()) === 'Song A', `got=${await title()}`);
check('WebSocket 接続 1 回', connections === 1, `connections=${connections}`);

// 2) 同じ epoch で version が進む更新 → 反映
sockets[0].send(upd(state(T('Song B', 'bbbbbbbbbbbb'), [], true, 6, 'epoch-A')));
await page.waitForTimeout(400);
check('同一 epoch / version 6 → 反映', (await title()) === 'Song B', `got=${await title()}`);

// 3) 同じ epoch で古い version → 無視
sockets[0].send(upd(state(T('Stale Song', 'stalestale00'), [], true, 3, 'epoch-A')));
await page.waitForTimeout(400);
check('同一 epoch / version 3（古い）→ 無視', (await title()) === 'Song B', `got=${await title()}`);

// 4) epoch が変わって version が小さい（bot 再起動）→ 反映される（旧実装ではここで永久に無視されていた）
sockets[0].send(upd(state(T('After Restart', 'restart00001'), [], false, 1, 'epoch-B')));
await page.waitForTimeout(400);
check('epoch 変更 / version 1 → 反映（bot再起動シナリオ）', (await title()) === 'After Restart', `got=${await title()}`);

// 5) is_playing の反映（再生ボタンの aria-label）
const playLabel = () => page.evaluate(() => document.querySelector('aside .apple-play-button')?.getAttribute('aria-label'));
check('is_playing=false → 再生ボタン表示', (await playLabel()) === '再生', `got=${await playLabel()}`);
sockets[0].send(upd(state(T('After Restart', 'restart00001'), [], true, 2, 'epoch-B')));
await page.waitForTimeout(400);
check('is_playing=true → 一時停止ボタン表示', (await playLabel()) === '一時停止', `got=${await playLabel()}`);

// 6) クライアント→サーバー ping が届く（生存確認）: heartbeatInterval 25s なので待たずに sync 要求で代替確認
await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await page.waitForTimeout(300);
check('タブ復帰で sync 要求が飛ぶ', received.some(m => m.includes('"sync"')), `received=${received.slice(-3).join(',')}`);

// 7) サーバーが切断 → 再接続する（新しい接続が来る）
const before = connections;
sockets[0].close({ code: 1006, reason: 'server gone' });
await page.waitForTimeout(3500);
check('切断後に自動再接続', connections > before, `connections=${connections} (before ${before})`);
// 再接続後、初期状態（epoch A / version 5）が再送されて反映される（epoch が戻っても受け入れる）
await page.waitForTimeout(400);
check('再接続後の初期状態を反映（epoch 巻き戻り OK）', (await title()) === 'Song A', `got=${await title()}`);

// 8) ヘッダーの同期インジケータ: 接続中は VC 名
check('接続中はヘッダーに VC 名', (await status()) === 'ロビー', `got=${await status()}`);

// 9) REST フォールバック: 接続を全部落として再接続を失敗させる → /player-state ポーリング
await context.unrouteAll({ behavior: 'ignoreErrors' });
await context.route('**/player-state/**', r => { restCalls++; return json(r, restState); });
await context.route('**/api/discord/userGuilds', r => json(r, [{ id: GUILD, name: 'テストサーバー', permissions: '0' }]));
await context.routeWebSocket(/\/ws\//, ws => { ws.close({ code: 1006, reason: 'down' }); });
for (const s of sockets) { try { s.close({ code: 1006, reason: 'down' }); } catch {} }
const restBefore = restCalls;
await page.waitForTimeout(12000);
check('WS 断中は REST フォールバック（/player-state）が呼ばれる', restCalls > restBefore, `restCalls=${restCalls}`);
check('REST フォールバックの状態が反映される', (await title()) === 'REST fallback song', `got=${await title()}`);
check('切断中はヘッダーに再接続中表示', /再接続中|同期中/.test((await status()) || ''), `got=${await status()}`);

await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
