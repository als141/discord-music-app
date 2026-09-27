#!/usr/bin/env node
/**
 * お願いカード（通知・ホーム画面に追加）の出し分け / 通知とアプリ / 共有の受け取り / 管理画面のレイアウト
 *
 * 端末は UA とメディアクエリでエミュレート（Playwright 同梱の Chromium。プッシュの実送受信は push-e2e-test.mjs）。
 * 準備は push-e2e-test.mjs と同じ（ローカルのバックエンド :8090 と本番ビルド :3100）。
 *   node scripts/pwa-ui-test.mjs
 */
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');
const { encode } = require('next-auth/jwt');

const BASE = process.env.APP_BASE || 'http://localhost:3100';
const API = process.env.API_BASE || 'http://localhost:8090';
const USER_ID = '222222222222222222'; // 管理者ではない利用者
const ADMIN_ID = process.env.TEST_ADMIN_ID || '606125595755282432';
const GUILD = '1093915551174234212';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(OUT, { recursive: true });
const SECRET = readFileSync(new URL('../frontend/.env.local', import.meta.url), 'utf8')
  .match(/^NEXTAUTH_SECRET=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
};

let failures = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const apiRe = (p) => new RegExp(`${API.replace(/[.:/]/g, '\\$&')}/${p}`);

async function open(browser, { name, ua, mobile, width = 390, height = 844, userId = USER_ID, init = '', storage = {} }) {
  const context = await browser.newContext({
    viewport: { width, height }, userAgent: ua, isMobile: !!mobile, hasTouch: !!mobile, locale: 'ja-JP',
  });
  const token = await encode({ token: { sub: userId, id: userId, name: `ui-${name}`, accessToken: 't' }, secret: SECRET, maxAge: 3600 });
  await context.addCookies([{ name: 'next-auth.session-token', value: token, url: BASE, httpOnly: true }]);
  await context.addInitScript(({ init, storage, guild }) => {
    try {
      if (!localStorage.getItem('guild-storage')) {
        localStorage.setItem('guild-storage', JSON.stringify({ state: { activeServerId: guild, activeChannelId: null, mutualServers: [{ id: guild, name: 'ドデカサーバー' }] }, version: 0 }));
      }
      for (const [k, v] of Object.entries(storage)) if (!sessionStorage.getItem('__seeded_' + k)) { localStorage.setItem(k, v); sessionStorage.setItem('__seeded_' + k, '1'); }
    } catch {}
    if (init) (0, eval)(init);
  }, { init, storage, guild: GUILD });
  await context.route('**/api/discord/userGuilds', (r) => json(r, [{ id: GUILD, name: 'ドデカサーバー', permissions: '0' }]));
  for (const p of ['bot-guilds', 'voice-channels', 'bot-voice-status', 'auto-connect-info', 'current-track', 'queue', 'history', 'history-stats', 'is-playing', 'uploaded-audio-list', 'recommendations', 'shared-tracks', 'user-voice-status', 'player-state']) {
    await context.route(apiRe(p), (r) =>
      json(r, p === 'history-stats' ? { guild_id: GUILD, days: 30, total_plays: 0, top_users: [], top_tracks: [] } : p === 'shared-tracks' ? { channels: [], tracks: [] } : p === 'bot-guilds' ? [{ id: GUILD, name: 'ドデカサーバー' }] : [])
    );
  }
  const adds = [];
  await context.route(apiRe('add-url'), (r) => { adds.push(r.request().postData()); return json(r, { message: 'ok' }); });
  await context.routeWebSocket(/\/ws\//, () => {});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { context, page, errors, adds };
}

const card = (page) => page.getByRole('region', { name: 'お願い' });
const promo = (page) => page.getByRole('region', { name: '新機能のお知らせ' });
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const STANDALONE_IOS = `Object.defineProperty(navigator, 'standalone', { get: () => true });
  const mm = window.matchMedia.bind(window);
  window.matchMedia = (q) => (/display-mode: standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q));`;
const DENIED = `Object.defineProperty(Notification, 'permission', { get: () => 'denied' });
  Notification.requestPermission = async () => 'denied';`;
// ヘッドレスの Chromium は通知の許可が最初から denied なので、「まだ聞いていない」状態を作る
const DEFAULT_PERM = `Object.defineProperty(Notification, 'permission', { get: () => 'default' });`;
const STANDALONE_ANDROID = `const mm2 = window.matchMedia.bind(window);
  window.matchMedia = (q) => (/display-mode: standalone/.test(q) ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm2(q));`;

const browser = await chromium.launch();
try {
  // 1) iPhone の Safari（未追加）→ ホーム画面に追加のお願い
  {
    const { context, page, errors } = await open(browser, { name: 'iphone', ua: UA.iphone, mobile: true });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await card(page).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    check('iPhone Safari: 「ホーム画面に追加してください」', await card(page).getByText('ホーム画面に追加してください').isVisible());
    check('iPhone Safari: 新機能カードは同じセッションに出さない', !(await promo(page).isVisible()));
    check('iPhone Safari: 横スクロールなし', await noOverflow(page));
    await page.screenshot({ path: join(OUT, 'pwa-iphone-1-card.png') });
    await card(page).getByRole('button', { name: '追加のしかた' }).click();
    const sheet = page.locator('[data-tour="app-settings"]');
    await sheet.waitFor({ timeout: 8000 });
    await page.waitForTimeout(600);
    check('iPhone Safari: 手順（共有 → ホーム画面に追加）', (await sheet.innerText()).includes('ホーム画面に追加') && (await sheet.innerText()).includes('Web アプリとして開く'));
    check('iPhone Safari: 通知は「追加した Irina から」と案内', (await sheet.innerText()).includes('ホーム画面に追加した Irina から開くと'));
    await page.screenshot({ path: join(OUT, 'pwa-iphone-2-settings.png') });
    await page.keyboard.press('Escape');
    // 次のセッション: お願いは 1 日空ける → 新機能紹介が出る
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    check('iPhone Safari: 翌セッションはお願いを出さない（間隔）', !(await card(page).isVisible()));
    check('iPhone Safari: 代わりに新機能紹介が出る', await promo(page).isVisible());
    // 2 日後: 再びお願い（強制＝消えない）
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('irina-device'));
      s.state.nudge.lastShownAt = Date.now() - 2 * 24 * 3600e3;
      localStorage.setItem('irina-device', JSON.stringify(s));
      const g = JSON.parse(localStorage.getItem('irina-guide') || '{"state":{},"version":1}');
      g.state.promoHandledIds = ['2026-09-shelf'];
      g.state.seenNoticeIds = ['2026-09-shelf'];
      localStorage.setItem('irina-guide', JSON.stringify(g));
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await card(page).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    check('iPhone Safari: 間隔が空いたらもう一度お願い', await card(page).isVisible());
    check('iPhone: エラーなし', errors.length === 0, errors.slice(0, 2).join(' | '));
    await context.close();
  }

  // 2) iPhone のホーム画面アプリ → 通知のお願い
  {
    const { context, page, errors } = await open(browser, { name: 'iphone-app', ua: UA.iphone, mobile: true, init: STANDALONE_IOS + DEFAULT_PERM });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await card(page).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    check('iPhone アプリ: 「通知をオンにしてください」', await card(page).getByText('通知をオンにしてください').isVisible());
    await page.screenshot({ path: join(OUT, 'pwa-iphone-app-card.png') });
    check('iPhone アプリ: エラーなし', errors.length === 0, errors.slice(0, 2).join(' | '));
    await context.close();
  }

  // 3) Android（ブラウザ・ブロック中）→ まずホーム画面に追加（ブロック解除は手間なので後）
  {
    const { context, page } = await open(browser, { name: 'android-browser', ua: UA.android, mobile: true, init: DENIED });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await card(page).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    check('Android ブラウザ: 先に「ホーム画面に追加してください」', await card(page).getByText('ホーム画面に追加してください').isVisible());
    await card(page).getByRole('button', { name: '追加のしかた' }).click();
    const sheet = page.locator('[data-tour="app-settings"]');
    await sheet.waitFor({ timeout: 8000 });
    await page.waitForTimeout(600);
    check('Android ブラウザ: メニューからの追加手順', (await sheet.innerText()).includes('アプリをインストール'));
    await page.screenshot({ path: join(OUT, 'pwa-android-install.png') });
    await context.close();
  }
  // 3b) Android のホーム画面アプリでブロック中 → 許可のしかた
  {
    const { context, page, errors } = await open(browser, { name: 'android', ua: UA.android, mobile: true, init: DENIED + STANDALONE_ANDROID });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await card(page).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    check('Android アプリ ブロック中: 「通知がブロックされています」', await card(page).getByText('通知がブロックされています').isVisible());
    await card(page).getByRole('button', { name: '許可のしかた' }).click();
    const sheet = page.locator('[data-tour="app-settings"]');
    await sheet.waitFor({ timeout: 8000 });
    await page.waitForTimeout(600);
    check('Android アプリ ブロック中: 解除の手順（アプリ情報 → 通知）', (await sheet.innerText()).includes('アプリ情報'));
    await page.screenshot({ path: join(OUT, 'pwa-android-blocked.png') });
    check('Android: エラーなし', errors.length === 0, errors.slice(0, 2).join(' | '));
    await context.close();
  }

  // 4) PC → 通知のお願い（インストールはせかさない）/ お知らせ一覧の下に通知の状態
  {
    const { context, page, errors } = await open(browser, { name: 'desktop', width: 1376, height: 870, init: DEFAULT_PERM });
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await card(page).waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    check('PC: 「通知をオンにしてください」', await card(page).getByText('通知をオンにしてください').isVisible());
    await page.getByRole('button', { name: /^お知らせ/ }).click();
    await page.getByText('Irina Ver. 1.2.0').waitFor({ timeout: 8000 });
    await page.waitForTimeout(400);
    check('PC: お知らせの先頭が今回の告知', (await page.locator('li h3').first().textContent()) === 'スマホに通知が届くように');
    check('PC: 一覧の下に通知の状態と「オンにする」', await page.getByRole('button', { name: 'オンにする' }).first().isVisible());
    await page.screenshot({ path: join(OUT, 'pwa-desktop-center.png') });
    check('PC: エラーなし', errors.length === 0, errors.slice(0, 2).join(' | '));
    await context.close();
  }

  // 5) 共有の受け取り（Android のホーム画面アプリ → YouTube から共有）
  {
    const { context, page, errors, adds } = await open(browser, { name: 'share', ua: UA.android, mobile: true });
    await page.goto(BASE + '/share?title=' + encodeURIComponent('夜に駆ける') + '&text=' + encodeURIComponent('見て https://youtu.be/x8VYWazR5mE?si=abc'), { waitUntil: 'domcontentloaded' });
    await page.getByText('共有された曲').waitFor({ timeout: 15000 });
    check('共有: 確認シートに URL', await page.getByText('https://youtu.be/x8VYWazR5mE?si=abc').isVisible());
    await page.screenshot({ path: join(OUT, 'pwa-share.png') });
    await page.getByRole('button', { name: 'キューに追加' }).click();
    await page.waitForTimeout(1200);
    check('共有: 追加すると add-url が呼ばれる', adds.length === 1 && adds[0].includes('x8VYWazR5mE'), adds[0]?.slice(0, 80));
    check('共有: URL の後始末（/ に戻る）', new URL(page.url()).search === '', page.url());
    check('共有: エラーなし', errors.length === 0, errors.slice(0, 2).join(' | '));
    await context.close();
  }

  // 6) 管理画面（スマホ幅のレイアウト / 管理者以外は 403 表示）
  {
    const { context, page, errors } = await open(browser, { name: 'admin', userId: ADMIN_ID, mobile: true });
    await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await page.getByText('通知を送る').waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    check('管理画面: メンバー数のタイル', await page.getByText('メンバー', { exact: true }).isVisible());
    check('管理画面: スマホ幅で横スクロールなし', await noOverflow(page));
    await page.screenshot({ path: join(OUT, 'pwa-admin-mobile.png'), fullPage: true });
    check('管理画面: エラーなし', errors.length === 0, errors.slice(0, 2).join(' | '));
    await context.close();
    const other = await open(browser, { name: 'not-admin' });
    await other.page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded' });
    await other.page.getByText('このページは管理者だけが見られます').waitFor({ timeout: 20000 }).catch(() => {});
    check('管理画面: 管理者以外は見られない', await other.page.getByText('このページは管理者だけが見られます').isVisible());
    await other.context.close();
  }
} catch (e) {
  check('pwa ui', false, e.message.split('\n')[0]);
} finally {
  await browser.close();
}
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures ? 1 : 0);
