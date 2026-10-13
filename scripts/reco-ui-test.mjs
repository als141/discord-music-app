#!/usr/bin/env node
/**
 * 曲置き場タブの「ドデカのおすすめ」「曲置き箱」の画面テスト（/dev-preview + モック）。
 *   cd frontend && NEXT_PUBLIC_BUILD_ID=test-a NEXT_PUBLIC_API_URL=https://api.atoriba.jp bunx next dev -p 3100
 *   RECO_FIXTURE=path/to/feed.json PREVIEW_BASE=http://localhost:3100 node scripts/reco-ui-test.mjs
 * RECO_FIXTURE は GET /reco/{guild}/feed の応答（backend の reco.service.feed の出力）
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
const feed = JSON.parse(readFileSync(process.env.RECO_FIXTURE, 'utf8'));
const GUILD = '1093915551174234212';

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
    if (!sessionStorage.getItem('ui-test-init')) {
      sessionStorage.setItem('ui-test-init', '1');
      localStorage.setItem('irina.tabs.v14', '1');
      localStorage.setItem('homeActiveTab', 'games');   // SSR の既定と同じ（違うと /dev-preview だけハイドレーションの警告が出る）
    }
    localStorage.setItem('guild-storage', JSON.stringify({ state: { activeServerId: guild, activeChannelId: null, mutualServers: [{ id: guild, name: 'ドデカサーバー' }] }, version: 0 }));
    localStorage.setItem('irina-device', JSON.stringify({ state: { nudge: { lastShownAt: Date.now(), count: 9 } }, version: 1 }));
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = 'nextjs-portal{display:none!important}';
      document.head.appendChild(st);
    });
  }, { guild: GUILD });
  const calls = { added: [], feedback: [], boxPosts: [], boxDeletes: [], feedGets: 0 };
  let box = [
    { id: 11, key: 'yt:aaaaaaaaaaa', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', title: 'まだ誰も知らない曲', artist: 'テスト', thumb: null, platform: 'youtube', who: { id: '000000000000000001', name: 'tester', image: null }, added_at: new Date(Date.now() - 3 * 3600e3).toISOString(), mine: true },
    { id: 10, key: 'nico:sm15630734', url: 'https://www.nicovideo.jp/watch/sm15630734', title: '千本桜', artist: '黒うさP', thumb: null, platform: 'niconico', who: { id: '2', name: 'M2', image: null }, added_at: new Date(Date.now() - 3 * 86400e3).toISOString(), mine: false },
  ];
  await context.route('**/api/auth/session', (r) => json(r, { user: { id: '000000000000000001', name: 'tester', image: null }, expires: new Date(Date.now() + 864e5).toISOString() }));
  await context.route('**/api/irina-token', (r) => json(r, { token: 'x.y.z', expiresAt: Date.now() + 9e5 }));
  await context.route('**/api/discord/userGuilds', (r) => json(r, [{ id: GUILD, name: 'ドデカサーバー', permissions: '0' }]));
  await context.route(/\/reco\/\d+\/feed/, (r) => {
    calls.feedGets++;
    json(r, { ...feed, stats: { ...feed.stats, box: box.length } });
  });
  await context.route(/\/reco\/\d+\/feedback/, (r) => {
    calls.feedback.push(JSON.parse(r.request().postData() || '{}'));
    json(r, { ok: true });
  });
  await context.route(/\/reco\/\d+\/box(\/\d+)?$/, (r) => {
    const req = r.request();
    if (req.method() === 'GET') return json(r, { items: box });
    if (req.method() === 'DELETE') {
      const id = Number(req.url().split('/').pop());
      calls.boxDeletes.push(id);
      box = box.filter((b) => b.id !== id);
      return json(r, { ok: true });
    }
    const body = JSON.parse(req.postData() || '{}');
    calls.boxPosts.push(body);
    if (!/youtu/.test(body.text)) return json(r, { results: [{ url: body.text, ok: false, error: 'YouTube・YouTube Music・ニコニコ・Spotify・Apple Music のリンクを置けます' }] });
    const item = { id: 12, key: 'yt:dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Never Gonna Give You Up', artist: 'Rick Astley', thumb: null, platform: 'youtube', who: { id: '000000000000000001', name: 'tester', image: null }, added_at: new Date().toISOString(), mine: true };
    box = [item, ...box];
    return json(r, { results: [{ url: body.text, ok: true, item }] });
  });
  await context.route(/api\.atoriba\.jp\/add-url/, (r) => {
    calls.added.push(JSON.parse(r.request().postData() || '{}'));
    json(r, { message: 'ok' });
  });
  await context.route(/\/scene\/\d+\/songs/, (r) => json(r, { songs: [], updated_at: null }));
  await context.route(/\/games\/\d+\/board/, (r) => json(r, {}, 404));
  await context.route(/\/me\/steam/, (r) => json(r, { linked: false, name: null, avatar: null, games: null, private: false }));
  await context.route(/\/me\/device/, (r) => json(r, { device: {}, prefs: {}, push_enabled: false, is_admin: false }));
  for (const p of ['bot-guilds', 'voice-channels', 'bot-voice-status', 'auto-connect-info', 'current-track', 'queue', 'history', 'history-stats', 'is-playing', 'uploaded-audio-list', 'recommendations', 'shared-tracks', 'user-voice-status', 'player-state']) {
    await context.route(new RegExp(`api\\.atoriba\\.jp/${p}`), (r) => json(r, p === 'history-stats' ? { guild_id: GUILD, days: 30, total_plays: 0, top_users: [], top_tracks: [] } : p === 'shared-tracks' ? { channels: [], tracks: [] } : p === 'bot-guilds' ? [{ id: GUILD, name: 'ドデカサーバー' }] : []));
  }
  await context.routeWebSocket(/\/ws\//, () => {});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|ytimg|nimg|googleusercontent|cdn\.discordapp/.test(m.text())) errors.push(m.text()); });
  return { context, page, errors, calls };
}

for (const vp of [{ name: 'mobile-390x844', width: 390, height: 844, mobile: true }, { name: 'desktop-1376x870', width: 1376, height: 870 }]) {
  const { context, page, errors, calls } = await setup(vp);
  const tag = vp.name;
  try {
    await page.goto(`${BASE}/dev-preview`, { waitUntil: 'domcontentloaded' });
    // ハイドレーション前のクリックは効かないので、曲置き場が開くまで押し直す
    const shelfTab = page.locator('[data-tour="tab-shelf"]');
    await shelfTab.waitFor({ timeout: 30000 });
    for (let i = 0; i < 12; i++) {
      await shelfTab.click();
      if (await page.locator('[data-tour="reco-panel"]').isVisible().catch(() => false)) break;
      await page.waitForTimeout(1000);
    }
    const panel = page.locator('[data-tour="reco-panel"]');
    await panel.waitFor({ timeout: 30000 });
    await panel.locator('[role="listitem"]').first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(800);
    check(`${tag}: 曲置き場の先頭がおすすめ`, (await page.locator('[data-tour="reco-panel"], [data-tour="song-box"], [data-tour="shelf-scene"]').first().getAttribute('data-tour')) === 'reco-panel');
    check(`${tag}: 記録の数`, (await panel.innerText()).includes(`${feed.stats.songs}曲・${feed.stats.people}人`));
    const moods = panel.locator('[data-tour="reco-moods"] [role="tab"]');
    check(`${tag}: 気分が 4 つ`, (await moods.count()) === 4);
    check(`${tag}: 最初は 6 曲`, (await panel.locator('[role="listitem"]').count()) === Math.min(6, feed.moods.now.length));
    const first = feed.moods.now[0];
    check(`${tag}: 1 曲目の題名と理由`, (await panel.locator('[role="listitem"]').first().innerText()).includes(first.title.slice(0, 8)) && (await panel.innerText()).includes(first.reason.slice(0, 6)), first.title);
    await page.screenshot({ path: join(OUT, `reco-${tag}-1-now.png`) });
    // 押すとキューへ（フルスクリーンは開かない）＋反応
    await panel.locator('[role="listitem"]').first().getByRole('button', { name: /をキューに追加$/ }).click();
    await page.waitForTimeout(900);
    check(`${tag}: 押すと add-url に URL`, calls.added.some((b) => b.url === first.url), JSON.stringify(calls.added).slice(0, 120));
    check(`${tag}: 流したことを記録`, calls.feedback.some((f) => f.key === first.key && f.action === 'play' && f.mood === 'now'));
    // 何も流れていないときに足すとスマホは再生画面が開く（既存の動き）。閉じて続ける
    const closer = page.getByRole('button', { name: 'プレイヤーを閉じる' });
    if (vp.mobile && (await closer.isVisible().catch(() => false))) {
      await closer.click();
      await page.waitForTimeout(600);
    }
    // 外す
    const second = feed.moods.now[1];
    await panel.locator('[role="listitem"]').nth(1).getByRole('button', { name: /をおすすめから外す$/ }).click();
    await page.waitForTimeout(400);
    check(`${tag}: ×で外すと消える`, !(await panel.innerText()).includes(second.title), second.title);
    check(`${tag}: 外したことを記録`, calls.feedback.some((f) => f.key === second.key && f.action === 'dismiss'));
    // 懐かしい
    await moods.nth(1).click();
    await page.waitForTimeout(500);
    const mem = feed.moods.memories[0];
    check(`${tag}: 懐かしいに切り替わる`, (await panel.innerText()).includes(mem.reason.replace(/ · .*/, '').slice(0, 8)), mem.reason);
    await panel.getByRole('button', { name: /^あと \d+ 曲$/ }).click();
    await page.waitForTimeout(300);
    check(`${tag}: もっと見るで 12 曲`, (await panel.locator('[role="listitem"]').count()) === Math.min(12, feed.moods.memories.length));
    await page.screenshot({ path: join(OUT, `reco-${tag}-2-memories.png`), fullPage: false });
    // ニコニコ
    await moods.nth(3).click();
    await page.waitForTimeout(400);
    await panel.locator('[role="listitem"]').first().getByRole('button', { name: /をキューに追加$/ }).click();
    await page.waitForTimeout(800);
    check(`${tag}: ニコニコは nicovideo の URL で追加`, calls.added.some((b) => /nicovideo\.jp\/watch\/(sm|nm|so)\d+/.test(b.url)), JSON.stringify(calls.added.at(-1)));
    // 5 曲流す
    await moods.nth(2).click();
    await page.waitForTimeout(300);
    const before = calls.added.length;
    await panel.getByRole('button', { name: '5曲流す' }).click();
    await page.waitForTimeout(2600);
    check(`${tag}: 5曲流す`, calls.added.length - before === Math.min(5, feed.moods.new.length), `${calls.added.length - before}`);
    // 曲置き箱
    const boxSec = page.locator('[data-tour="song-box"]');
    await boxSec.scrollIntoViewIfNeeded();
    check(`${tag}: 箱に置かれた曲`, (await boxSec.locator('[role="listitem"]').count()) === 2);
    check(`${tag}: 自分の曲だけ取り出せる`, (await boxSec.getByRole('button', { name: /を取り出す$/ }).count()) === 1);
    const feedsBefore = calls.feedGets;
    await boxSec.getByLabel('曲のリンク').fill('https://example.com/x');
    await boxSec.getByRole('button', { name: '置く' }).click();
    await page.waitForTimeout(600);
    check(`${tag}: 対応外のリンクはエラー表示`, (await boxSec.innerText()).includes('置けます'));
    await boxSec.getByLabel('曲のリンク').fill('https://youtu.be/dQw4w9WgXcQ');
    await boxSec.getByRole('button', { name: '置く' }).click();
    await page.waitForTimeout(1200);
    check(`${tag}: 置く → POST`, calls.boxPosts.at(-1)?.text === 'https://youtu.be/dQw4w9WgXcQ');
    check(`${tag}: 置いた曲が先頭に`, (await boxSec.locator('[role="listitem"]').first().innerText()).includes('Never Gonna Give You Up'));
    check(`${tag}: 置くとおすすめを取り直す`, calls.feedGets > feedsBefore, `${feedsBefore}→${calls.feedGets}`);
    check(`${tag}: 入力欄が空に`, (await boxSec.getByLabel('曲のリンク').inputValue()) === '');
    await page.screenshot({ path: join(OUT, `reco-${tag}-3-box.png`) });
    await boxSec.getByRole('button', { name: /を取り出す$/ }).first().click();
    await page.waitForTimeout(600);
    check(`${tag}: 取り出す → DELETE`, calls.boxDeletes.length === 1 && calls.boxDeletes[0] === 12, JSON.stringify(calls.boxDeletes));
    check(`${tag}: 横スクロールなし`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    // お知らせ一覧から使い方
    await page.getByRole('button', { name: /^お知らせ/ }).click();
    await page.locator('li', { hasText: 'ドデカのおすすめと曲置き箱' }).getByRole('button', { name: '使い方を見る' }).first().click();
    const titles = [];
    for (let i = 0; i < 8; i++) {
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
    check(`${tag}: 使い方が最後まで進む`, titles.join(' → ') === '曲置き場のいちばん上 → 気分で選ぶ → 押すとそのまま流れる → 曲置き箱', titles.join(' → '));
    check(`${tag}: エラーなし`, errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (e) {
    check(`${tag}: flow`, false, e.message.split('\n')[0]);
    await page.screenshot({ path: join(OUT, `reco-${tag}-fail.png`) }).catch(() => {});
  }
  await context.browser().close();
}
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures ? 1 : 0);
