#!/usr/bin/env node
/**
 * プッシュ通知の端から端までのテスト（本物の Google Chrome + FCM + ローカルのバックエンド）
 *
 * 1. NextAuth のセッション Cookie をテスト用に作って入れる（本物の /api/irina-token が署名する）
 * 2. 通知を許可した Chrome でアプリを開く → Service Worker が FCM に購読 → バックエンドに端末登録
 * 3. 「通知とアプリ」からテスト通知 → バックエンドが VAPID で FCM に送る → Chrome の SW が表示
 * 4. 管理画面から自分宛てにお知らせを送る → 届く / 履歴に載る / 開封 API
 *
 * 準備（ローカル）:
 *   backend: set -a; . ./.env; set +a; IRINA_ROLE=web IRINA_EXTRA_CORS_ORIGINS=http://localhost:3100 \
 *            IRINA_APP_ORIGIN=http://localhost:3100 IRINA_API_ORIGIN=http://localhost:8090 \
 *            .venv/bin/python -m uvicorn app.main:app --port 8090
 *   frontend: NEXT_PUBLIC_API_URL=http://localhost:8090 NEXT_PUBLIC_BUILD_ID=local-a bun run build
 *             NEXTAUTH_URL=http://localhost:3100 NEXT_PUBLIC_API_URL=http://localhost:8090 bunx next start -p 3100
 *   node scripts/push-e2e-test.mjs
 * TEST_USER_ID は管理者（IRINA_ADMIN_USER_IDS）に含まれている ID にする（ローカル DB にだけ書かれる）
 */
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');
const { encode } = require('next-auth/jwt');

const BASE = process.env.APP_BASE || 'http://localhost:3100';
const API = process.env.API_BASE || 'http://localhost:8090';
const USER_ID = process.env.TEST_USER_ID || '606125595755282432';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(OUT, { recursive: true });

const envLocal = readFileSync(new URL('../frontend/.env.local', import.meta.url), 'utf8');
const SECRET = envLocal.match(/^NEXTAUTH_SECRET=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!SECRET) throw new Error('NEXTAUTH_SECRET が frontend/.env.local にありません');

let failures = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const sessionToken = await encode({
  token: { sub: USER_ID, id: USER_ID, name: 'push-e2e', picture: 'https://cdn.discordapp.com/embed/avatars/2.png', accessToken: 'test' },
  secret: SECRET,
  maxAge: 3600,
});

// 普通のプロファイルで起動する（browser.newContext() はシークレット相当で、Chrome はプッシュの購読を拒否する）
const profileDir = mkdtempSync(join(tmpdir(), 'irina-push-e2e-'));
const context = await chromium.launchPersistentContext(profileDir, {
  channel: 'chrome',
  headless: true,
  viewport: { width: 1280, height: 860 },
  locale: 'ja-JP',
});
const browser = { close: async () => { await context.close(); rmSync(profileDir, { recursive: true, force: true }); } };
await context.grantPermissions(['notifications'], { origin: BASE });
await context.addCookies([{ name: 'next-auth.session-token', value: sessionToken, url: BASE, httpOnly: true }]);
// 音楽まわり（voice プロセス）はこのテストの対象外なのでモック
await context.route('**/api/discord/userGuilds', (r) => json(r, [{ id: '1093915551174234212', name: 'ドデカサーバー', permissions: '0' }]));
for (const p of ['bot-guilds', 'voice-channels', 'bot-voice-status', 'auto-connect-info', 'current-track', 'queue', 'history', 'history-stats', 'is-playing', 'uploaded-audio-list', 'recommendations', 'shared-tracks', 'user-voice-status', 'player-state']) {
  await context.route(new RegExp(`${API.replace(/[.:/]/g, '\\$&')}/${p}`), (r) =>
    json(r, p === 'history-stats' ? { guild_id: '1', days: 30, total_plays: 0, top_users: [], top_tracks: [] } : p === 'shared-tracks' ? { channels: [], tracks: [] } : p === 'bot-guilds' ? [{ id: '1093915551174234212', name: 'ドデカサーバー' }] : [])
  );
}
await context.routeWebSocket(/\/ws\//, () => {});

const page = context.pages()[0] ?? (await context.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

const notifications = () =>
  page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return (await reg.getNotifications()).map((n) => ({ title: n.title, body: n.body, tag: n.tag, data: n.data }));
  });
const waitNotification = async (title, timeoutMs = 45000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const list = await notifications();
    const hit = list.find((n) => n.title === title);
    if (hit) return { ...hit, ms: Date.now() - t0 };
    await page.waitForTimeout(1000);
  }
  return null;
};

try {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  const swOk = await page.waitForFunction(() => navigator.serviceWorker?.controller != null || navigator.serviceWorker?.ready, null, { timeout: 20000 }).then(() => true).catch(() => false);
  check('Service Worker が動く', swOk);

  // 許可済みなので、開いただけで黙って購読して報告するはず
  let device = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 40000) {
    device = await page.evaluate(async (api) => {
      const t = await (await fetch('/api/irina-token')).json();
      const r = await fetch(`${api}/admin/overview`, { headers: { Authorization: `Bearer ${t.token}` } });
      if (!r.ok) return { error: r.status };
      const d = await r.json();
      const me = [...d.members, ...d.others].find((m) => m.devices?.length);
      return me ? me.devices.find((x) => x.push) ?? null : null;
    }, API);
    if (device && !device.error) break;
    await page.waitForTimeout(1500);
  }
  check('端末が登録され、購読（FCM）がバックエンドに届く', !!device && !device.error && device.push, JSON.stringify(device)?.slice(0, 160));

  // 「通知とアプリ」→ テスト通知
  await page.getByRole('button', { name: 'ユーザーメニュー' }).click();
  await page.getByRole('menuitem', { name: /通知とアプリ/ }).click();
  await page.getByText('この端末に通知が届きます').waitFor({ timeout: 15000 });
  check('設定に「この端末に通知が届きます」', true);
  await page.screenshot({ path: join(OUT, 'push-settings-on.png') });
  await page.getByRole('button', { name: 'テスト通知を送る' }).click();
  const test = await waitNotification('テスト通知');
  check('テスト通知が Chrome に届く（FCM 経由）', !!test, test ? `${test.ms}ms body=${test.body}` : 'timeout');
  check('通知の開く先に送信ログ ID（?n=）が入っている', /[?&]n=\d+/.test(test?.data?.url || ''), JSON.stringify(test?.data));
  await page.keyboard.press('Escape');

  // 管理画面から自分宛てにお知らせ
  await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
  await page.getByText('通知を送る').waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, 'push-admin.png'), fullPage: true });
  await page.getByPlaceholder('例: 曲置き場ができました').fill('E2E お知らせ');
  await page.getByPlaceholder('何ができるようになったか、どこにあるか').fill('管理画面からの送信テスト');
  await page.getByRole('button', { name: /人に送る$/ }).click();
  await page.getByRole('button', { name: '送る', exact: true }).click();
  const ann = await waitNotification('E2E お知らせ');
  check('管理画面のお知らせが届く', !!ann, ann ? `${ann.ms}ms` : 'timeout');
  await page.getByRole('button', { name: '更新' }).click();
  await page.waitForTimeout(1500);
  const hist = await page.locator('text=E2E お知らせ').count();
  check('送信履歴に載る', hist > 0);

  // 開封の記録（SW の notificationclick が叩く API）
  const logId = Number((ann?.data?.url || '').match(/[?&]n=(\d+)/)?.[1]);
  const clickRes = await page.evaluate(async ({ api, logId }) => (await fetch(`${api}/push/click`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ log_id: logId }) })).status, { api: API, logId });
  check('開封 API', clickRes === 200, `status=${clickRes}`);

  check('ページエラーなし', errors.length === 0, errors.slice(0, 2).join(' | '));
} catch (e) {
  check('push e2e', false, e.message.split('\n')[0]);
} finally {
  await browser.close();
}
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures ? 1 : 0);
