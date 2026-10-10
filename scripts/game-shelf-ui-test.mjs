#!/usr/bin/env node
/**
 * ゲーム置き場タブの画面テスト（/dev-preview + モック）。
 *   cd frontend && NEXT_PUBLIC_BUILD_ID=test-a NEXT_PUBLIC_API_URL=https://api.atoriba.jp bunx next dev -p 3100
 *   BOARD_FIXTURE=path/to/board.json PREVIEW_BASE=http://localhost:3100 node scripts/game-shelf-ui-test.mjs
 * BOARD_FIXTURE は GET /games/{guild}/board の応答（backend の game_shelf.build_board の出力）。
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
  return { context, page, errors, marks };
}

for (const vp of [{ name: 'mobile-390x844', width: 390, height: 844, mobile: true }, { name: 'desktop-1376x870', width: 1376, height: 870 }]) {
  const { context, page, errors, marks } = await setup(vp);
  const tag = vp.name;
  try {
    await page.goto(`${BASE}/dev-preview`, { waitUntil: 'domcontentloaded' });
    const tab = page.locator('[data-tour="tab-games"]');
    await tab.waitFor({ timeout: 20000 });
    check(`${tag}: ゲーム置き場タブに NEW`, (await tab.getAttribute('aria-label')).includes('新機能'));
    // ハイドレーション前のクリックは効かないので、選ばれるまで押し直す
    for (let i = 0; i < 10; i++) {
      await tab.click();
      if (await page.getByText('今夜どれ？').isVisible().catch(() => false)) break;
      await page.waitForTimeout(1000);
    }
    await page.getByText('今夜どれ？').waitFor({ timeout: 15000 });
    await page.waitForTimeout(1200);
    check(`${tag}: いま（VC 3 人）`, await page.getByText(/ゲーム に 3 人/).isVisible());
    check(`${tag}: プレイ中のチップ`, await page.getByRole('button', { name: /R\.E\.P\.O\..*2人/ }).isVisible());
    const picks = await page.locator('[data-tour="games-tonight"] button h3').count();
    check(`${tag}: 今夜どれ？の候補`, picks >= 3, `${picks}`);
    check(`${tag}: 横スクロールなし`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await page.screenshot({ path: join(OUT, `games-${tag}-1-top.png`) });
    // 人数を変える
    await page.getByRole('button', { name: '8人+' }).click();
    await page.waitForTimeout(800);
    check(`${tag}: 人数チップ 8人+ が選択`, (await page.getByRole('button', { name: '8人+' }).getAttribute('aria-pressed')) === 'true');
    // 期限つき
    check(`${tag}: 期限つき`, await page.getByText('期限つき').isVisible());
    // 置き場まで
    await page.locator('[data-tour="games-all"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    const total = await page.locator('[data-tour="games-all"] .grid > button').count();
    await page.getByRole('button', { name: /^セール中/ }).click();
    await page.waitForTimeout(400);
    const sale = await page.locator('[data-tour="games-all"] .grid > button').count();
    check(`${tag}: 絞り込み（セール中）`, sale > 0 && sale < total, `${sale}/${total}`);
    await page.screenshot({ path: join(OUT, `games-${tag}-2-grid.png`) });
    // 詳細
    await page.locator('[data-tour="games-all"] .grid > button').first().click();
    const sheet = page.locator('[data-tour="game-detail"]');
    await sheet.waitFor({ timeout: 8000 });
    await page.waitForTimeout(600);
    check(`${tag}: 詳細に人数・価格`, (await sheet.innerText()).includes('価格'));
    await sheet.getByRole('button', { name: 'やりたい' }).scrollIntoViewIfNeeded();
    await sheet.getByRole('button', { name: 'やりたい' }).click();
    await page.waitForTimeout(600);
    check(`${tag}: やりたい を付けられる`, marks.length === 1 && marks[0].kind === 'want' && marks[0].on === true, JSON.stringify(marks));
    check(`${tag}: やりたい が押された表示`, (await sheet.getByRole('button', { name: 'やりたい' }).getAttribute('aria-pressed')) === 'true');
    await page.screenshot({ path: join(OUT, `games-${tag}-3-detail.png`) });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    // 案内（お知らせ一覧から）
    await page.getByRole('button', { name: /^お知らせ/ }).click();
    await page.locator('li').getByRole('button', { name: '使い方を見る' }).first().click();
    const titles = [];
    for (let i = 0; i < 7; i++) {
      const ok = await page.waitForFunction(() => {
        const d = document.querySelector('[data-guide-tour] [role=dialog]');
        return d && getComputedStyle(d).opacity === '1';
      }, null, { timeout: 8000 }).then(() => true).catch(() => false);
      if (!ok) break;
      titles.push(await page.locator('[data-guide-tour] [role=dialog] h2').textContent());
      const last = await page.getByRole('button', { name: '完了' }).count();
      await page.getByRole('button', { name: last ? '完了' : '次へ' }).click();
      await page.waitForTimeout(300);
      if (last) break;
    }
    check(`${tag}: ゲーム置き場の案内が最後まで進む`, titles.length >= 5 && titles.at(-1) === '貼るのはいつも通り', titles.join(' → '));
    check(`${tag}: エラーなし`, errors.filter((e) => !/empty string \("\"\) was passed to the %s attribute/.test(e)).length === 0, errors.slice(0, 2).join(' | '));
  } catch (e) {
    check(`${tag}: flow`, false, e.message.split('\n')[0] + ' / ' + (e.message.match(/waiting for (.*)/) || [])[1]);
    await page.screenshot({ path: join(OUT, `games-${tag}-fail.png`) }).catch(() => {});
  }
  await context.browser().close();
}
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures ? 1 : 0);
