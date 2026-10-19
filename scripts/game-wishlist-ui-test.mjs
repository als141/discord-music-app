#!/usr/bin/env node
/**
 * ゲーム置き場「みんなのウィッシュリスト」の画面テスト（/dev-preview + モック）。
 *   cd frontend && NEXT_PUBLIC_BUILD_ID=test-a NEXT_PUBLIC_API_URL=https://api.atoriba.jp bunx next dev -p 3100
 *   BOARD_FIXTURE=path/to/board.json PREVIEW_BASE=http://localhost:3100 node scripts/game-wishlist-ui-test.mjs
 * BOARD_FIXTURE は wishlist を 7 本以上含む GET /games/{guild}/board の応答（メンバーは架空でよい）
 */
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');
const BASE = process.env.PREVIEW_BASE || 'http://localhost:3100';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(OUT, { recursive: true });
const board = JSON.parse(readFileSync(process.env.BOARD_FIXTURE, 'utf8'));
const songs = null;
const GUILD = board.guild_id;

let failures = 0;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const json = (r, body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function setup(vp) {
  const context = await (await chromium.launch()).newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, locale: 'ja-JP' });
  await context.addInitScript(({ guild }) => {
    localStorage.setItem('homeActiveTab', 'home');
    localStorage.setItem('guild-storage', JSON.stringify({ state: { activeServerId: guild, activeChannelId: null, mutualServers: [{ id: guild, name: 'ドデカサーバー' }] }, version: 0 }));
    // 新機能カードと「お願い」はこのテストの対象外
    localStorage.setItem('irina-device', JSON.stringify({ state: { nudge: { lastShownAt: Date.now(), count: 9 } }, version: 1 }));
    // next dev の「Issue」バッジが画面下の押す場所に重なるので隠す
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = 'nextjs-portal{display:none!important}';
      document.head.appendChild(st);
    });
  }, { guild: GUILD });
  const marks = [];
  await context.route('**/api/auth/session', (r) => json(r, { user: { id: '000000000000000001', name: 'tester', image: null }, expires: new Date(Date.now() + 864e5).toISOString() }));
  await context.route('**/api/irina-token', (r) => json(r, { token: 'x.y.z', expiresAt: Date.now() + 9e5 }));
  await context.route('**/api/discord/userGuilds', (r) => json(r, [{ id: GUILD, name: 'ドデカサーバー', permissions: '0' }]));
  await context.route(/\/games\/\d+\/board/, (r) => {
    const n = Number(new URL(r.request().url()).searchParams.get('players')) || null;
    json(r, n ? { ...board, tonight: { ...board.tonight, players: n } } : board);
  });
  await context.route(/\/games\/\d+\/\d+\/mark/, (r) => {
    const body = JSON.parse(r.request().postData() || '{}');
    marks.push(body);
    json(r, { appid: r.request().url().split('/').slice(-2)[0], want: body.kind === 'want' && body.on ? ['000000000000000001'] : [], own: body.kind === 'own' && body.on ? ['000000000000000001'] : [] });
  });
  const added = [];
  await context.route(/\/scene\/\d+\/songs/, (r) => json(r, songs || { songs: [], updated_at: null }));
  await context.route(/api\.atoriba\.jp\/add-url/, (r) => {
    added.push(JSON.parse(r.request().postData() || '{}'));
    json(r, { message: 'ok' });
  });
  await context.route(/\/me\/steam/, (r) => json(r, { linked: false, name: null, avatar: null, games: null, private: false }));
  await context.route(/\/me\/device/, (r) => json(r, { device: {}, prefs: {}, push_enabled: false, is_admin: false }));
  for (const p of ['bot-guilds', 'voice-channels', 'bot-voice-status', 'auto-connect-info', 'current-track', 'queue', 'history', 'history-stats', 'is-playing', 'uploaded-audio-list', 'recommendations', 'shared-tracks', 'user-voice-status', 'player-state']) {
    await context.route(new RegExp(`api\\.atoriba\\.jp/${p}`), (r) => json(r, p === 'history-stats' ? { guild_id: GUILD, days: 30, total_plays: 0, top_users: [], top_tracks: [] } : p === 'shared-tracks' ? { channels: [], tracks: [] } : p === 'bot-guilds' ? [{ id: GUILD, name: 'ドデカサーバー' }] : []));
  }
  await context.routeWebSocket(/\/ws\//, () => {});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|steamstatic|cdn\.discordapp|ytimg|epicgames|gamerpower/.test(m.text())) errors.push(m.text()); });
  return { context, page, errors, marks, added };
}

const byId = new Map(board.games.map((g) => [g.appid, g]));
const top = board.wishlist[0];
for (const vp of [{ name: 'mobile-390x844', width: 390, height: 844, mobile: true }, { name: 'desktop-1376x870', width: 1376, height: 870 }]) {
  const { context, page, errors } = await setup(vp);
  const tag = vp.name;
  try {
    await page.goto(`${BASE}/dev-preview`, { waitUntil: 'domcontentloaded' });
    const tab = page.locator('[data-tour="tab-games"]');
    await tab.waitFor({ timeout: 20000 });
    for (let i = 0; i < 10; i++) {
      await tab.click({ timeout: 4000 }).catch(() => {});
      if (await page.getByText('今夜どれ？').isVisible().catch(() => false)) break;
      await page.waitForTimeout(1000);
    }
    const sec = page.locator('[data-tour="games-wishlist"]');
    await sec.waitFor({ timeout: 15000 });
    await sec.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    check(`${tag}: みんなのウィッシュリストが出る`, await sec.getByText('みんなのウィッシュリスト').isVisible());
    const rows = sec.locator('[aria-label="みんなのウィッシュリスト"] button');
    check(`${tag}: 最初は 6 本`, (await rows.count()) === 6, String(await rows.count()));
    const firstText = (await rows.first().innerText()).replace(/\s+/g, ' ');
    check(`${tag}: 先頭がいちばん多くの人が入れているゲーム`, firstText.includes(byId.get(top.appid).name) && firstText.includes(`${top.users.length}人がほしい`), firstText.slice(0, 80));
    const owned = board.wishlist.find((w) => byId.get(w.appid).own.length);
    if (owned) check(`${tag}: 持っている人の数`, (await sec.getByText(`${byId.get(owned.appid).own.length}人が持ってる`).count()) > 0);
    const sale = board.wishlist.slice(0, 6).find((w) => byId.get(w.appid).price.discount > 0);
    if (sale) check(`${tag}: セールの値引き`, (await sec.getByText(`${byId.get(sale.appid).price.discount}%`).count()) > 0);
    await page.screenshot({ path: join(OUT, `wishlist-${tag}.png`) });
    await sec.getByRole('button', { name: /もっと見る/ }).click();
    await page.waitForTimeout(400);
    check(`${tag}: もっと見るで全部`, (await rows.count()) === board.wishlist.length, String(await rows.count()));
    await sec.getByRole('button', { name: 'たたむ' }).click();
    await page.waitForTimeout(300);
    check(`${tag}: たたむで 6 本に戻る`, (await rows.count()) === 6);
    await rows.first().click();
    const d = page.locator('[data-tour="game-detail"]');
    await d.waitFor({ timeout: 5000 });
    check(`${tag}: 押すとゲームの詳細`, await d.getByText(byId.get(top.appid).name).first().isVisible());
    await page.screenshot({ path: join(OUT, `wishlist-detail-${tag}.png`) });
    await page.keyboard.press('Escape');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check(`${tag}: 横スクロールなし`, !overflow);
    check(`${tag}: コンソールエラーなし`, errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (e) {
    await page.screenshot({ path: join(OUT, `wishlist-fail-${tag}.png`) }).catch(() => {});
    if (errors.length) console.log(`[${tag}] page errors:`, errors.slice(0, 3).map((x) => x.slice(0, 300)).join('\n'));
    check(`${tag}: 実行`, false, String(e).split('\n').filter((l) => /intercepts|Timeout|not visible|not stable/.test(l)).slice(0, 3).join(' / ').slice(0, 300));
  } finally {
    await context.close();
  }
}

console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} OK`);
process.exit(failures ? 1 : 0);
