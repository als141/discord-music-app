#!/usr/bin/env node
/**
 * 曲置き場タブ（曲を置く → いまのおすすめ → みんなの置き場）の画面テスト（/dev-preview + モック）。
 *   cd frontend && NEXT_PUBLIC_BUILD_ID=test-a NEXT_PUBLIC_API_URL=https://api.atoriba.jp bunx next dev -p 3100
 *   RECO_DIR=path PREVIEW_BASE=http://localhost:3100 node scripts/shelf-ui-test.mjs
 * RECO_DIR には backend の reco.service で作った feed_a.json（流れてる曲あり）・feed_b.json（曲を置いた後）・
 * shelf.json・placed.json（置いた曲）を置く
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
const D = process.env.RECO_DIR;
// feed_big.json（120 曲）があれば、?limit= に合わせて先頭から切って返す（上の並びは limit で変わらない）
const feedBig = (() => { try { return JSON.parse(readFileSync(join(D, 'feed_big.json'), 'utf8')); } catch { return null; } })();
const feedA = feedBig ? { ...feedBig, items: feedBig.items.slice(0, 18) } : JSON.parse(readFileSync(join(D, 'feed_a.json'), 'utf8'));
const feedAt = (limit) => (feedBig ? { ...feedBig, items: feedBig.items.slice(0, limit), has_more: limit < feedBig.items.length } : feedA);
const feedB = JSON.parse(readFileSync(join(D, 'feed_b.json'), 'utf8'));
const shelf = JSON.parse(readFileSync(join(D, 'shelf.json'), 'utf8'));
const placed = JSON.parse(readFileSync(join(D, 'placed.json'), 'utf8'));
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
      localStorage.setItem('homeActiveTab', 'games');   // SSR の既定と同じ（違うと /dev-preview だけハイドレーションの警告）
    }
    localStorage.setItem('guild-storage', JSON.stringify({ state: { activeServerId: guild, activeChannelId: null, mutualServers: [{ id: guild, name: 'ドデカサーバー' }] }, version: 0 }));
    localStorage.setItem('irina-device', JSON.stringify({ state: { nudge: { lastShownAt: Date.now(), count: 9 } }, version: 1 }));
    document.addEventListener('DOMContentLoaded', () => {
      const st = document.createElement('style');
      st.textContent = 'nextjs-portal{display:none!important}';
      document.head.appendChild(st);
    });
  }, { guild: GUILD });
  const calls = { added: [], feedback: [], boxPosts: [], boxDeletes: [], feedGets: 0, shelfGets: 0 };
  const state = { placed: false, shelfItems: shelf.items.map((x) => ({ ...x })) };
  await context.route('**/api/auth/session', (r) => json(r, { user: { id: '000000000000000001', name: 'tester', image: null }, expires: new Date(Date.now() + 864e5).toISOString() }));
  await context.route('**/api/irina-token', (r) => json(r, { token: 'x.y.z', expiresAt: Date.now() + 9e5 }));
  await context.route('**/api/discord/userGuilds', (r) => json(r, [{ id: GUILD, name: 'ドデカサーバー', permissions: '0' }]));
  await context.route(/\/reco\/\d+\/feed/, (r) => {
    calls.feedGets++;
    const limit = Number(new URL(r.request().url()).searchParams.get('limit')) || 18;
    calls.lastLimit = limit;
    json(r, state.placed ? feedB : feedAt(limit));
  });
  await context.route(/\/reco\/\d+\/shelf/, (r) => {
    calls.shelfGets++;
    json(r, { items: state.shelfItems, total: state.shelfItems.length });
  });
  await context.route(/\/reco\/\d+\/feedback/, (r) => {
    calls.feedback.push(JSON.parse(r.request().postData() || '{}'));
    json(r, { ok: true });
  });
  await context.route(/\/reco\/\d+\/box(\/\d+)?$/, (r) => {
    const req = r.request();
    if (req.method() === 'DELETE') {
      const id = Number(req.url().split('/').pop());
      calls.boxDeletes.push(id);
      state.shelfItems = state.shelfItems.filter((b) => b.box_id !== id);
      return json(r, { ok: true });
    }
    if (req.method() === 'GET') return json(r, { items: [] });
    const body = JSON.parse(req.postData() || '{}');
    calls.boxPosts.push(body);
    if (!/youtu/.test(body.text)) return json(r, { results: [{ url: body.text, ok: false, error: 'YouTube・YouTube Music・ニコニコ・Spotify・Apple Music のリンクを置けます' }] });
    state.placed = true;
    const item = { ...placed, mine: true };
    state.shelfItems = [...[{ key: item.key, url: item.url, title: item.title, artist: item.artist, thumb: item.thumb, source: 'アプリ', platform: 'youtube', who: { name: '自分', image: null }, at: new Date().toISOString(), box_id: item.id, mine: true }], ...state.shelfItems.filter((x) => x.key !== item.key)];
    return json(r, { results: [{ url: body.text, ok: true, item }] });
  });
  await context.route(/api\.atoriba\.jp\/add-url/, (r) => {
    calls.added.push(JSON.parse(r.request().postData() || '{}'));
    json(r, { message: 'ok' });
  });
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
  return { context, page, errors, calls, state };
}

for (const vp of [{ name: 'mobile-390x844', width: 390, height: 844, mobile: true }, { name: 'desktop-1376x870', width: 1376, height: 870 }]) {
  const { context, page, errors, calls, state: state0 } = await setup(vp);
  const tag = vp.name;
  try {
    await page.goto(`${BASE}/dev-preview`, { waitUntil: 'domcontentloaded' });
    const shelfTab = page.locator('[data-tour="tab-shelf"]');
    await shelfTab.waitFor({ timeout: 30000 });
    for (let i = 0; i < 12; i++) {
      await shelfTab.click();
      if (await page.locator('[data-tour="reco-feed"]').isVisible().catch(() => false)) break;
      await page.waitForTimeout(1000);
    }
    const feed = page.locator('[data-tour="reco-feed"]');
    const rows = feed.locator('[role="listitem"]');
    await rows.first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    const order = await page.locator('[data-tour="place-bar"], [data-tour="reco-feed"], [data-tour="shelf-list"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-tour')));
    check(`${tag}: 置く → おすすめ → 置き場の順`, order.join(',') === 'place-bar,reco-feed,shelf-list', order.join(','));
    check(`${tag}: 気分のチップが無い（一面）`, (await feed.locator('[role="tab"]').count()) === 0);
    check(`${tag}: 見出しが「流れてる…に合わせて」`, (await page.getByTestId('reco-caption').innerText()).includes(feedA.context.label), feedA.context.label);
    const firstText = await rows.first().innerText();
    check(`${tag}: 1 行目は「続けて」`, firstText.includes('続けて') && firstText.includes(feedA.items[0].title.slice(0, 4)), feedA.items[0].title);
    const texts = await rows.evaluateAll((els) => els.map((e) => e.innerText));
    const kinds = ['続けて', '懐かしい', '新曲', '界隈'].filter((t) => texts.some((x) => x.includes(t)));
    check(`${tag}: いろいろ混ざって一面に`, kinds.length >= 3, kinds.join('・'));
    const expectRows = vp.mobile ? Math.min(10, feedA.items.length) : feedA.items.length;
    check(`${tag}: 行の数（スマホ 10・PC 全部）`, (await rows.count()) === expectRows, `${await rows.count()}`);
    await page.screenshot({ path: join(OUT, `shelf-${tag}-1-top.png`) });
    // もっと見る: 20 曲ずつ。足りなければ limit を増やして取り直す（上の並びは変わらない）
    if (feedBig) {
      const firstKeys = await rows.evaluateAll((els) => els.slice(0, 5).map((e) => e.innerText.split('\n')[0]));
      const more = feed.getByRole('button', { name: 'もっと見る' });
      let clicks = 0;
      while ((await more.count()) && clicks < 10) {
        await more.click();
        clicks++;
        await page.waitForTimeout(700);
      }
      const total = await rows.count();
      check(`${tag}: もっと見るで全部（120 曲）まで`, total === feedBig.items.length && calls.lastLimit >= feedBig.items.length, `${total} 曲・${clicks} 回・limit ${calls.lastLimit}`);
      check(`${tag}: 増やしても上の並びは同じ`, JSON.stringify(await rows.evaluateAll((els) => els.slice(0, 5).map((e) => e.innerText.split('\n')[0]))) === JSON.stringify(firstKeys));
      check(`${tag}: 最後に「ここまでの 120 曲」`, (await feed.innerText()).includes(`ここまでの ${feedBig.items.length} 曲`));
      await page.screenshot({ path: join(OUT, `shelf-${tag}-1b-all.png`), fullPage: false });
      await feed.getByRole('button', { name: 'たたむ' }).click();
      await page.waitForTimeout(500);
      check(`${tag}: たたむで元の数に`, (await rows.count()) === (vp.mobile ? 10 : 18), `${await rows.count()}`);
      await feed.getByRole('button', { name: 'すべて表示' }).click();
      await page.waitForTimeout(900);
      check(`${tag}: すべて表示で 1 回で全部`, (await rows.count()) === feedBig.items.length, `${await rows.count()}`);
      await feed.getByRole('button', { name: 'たたむ' }).click();
      await page.waitForTimeout(500);
      await page.evaluate(() => document.querySelector('[data-tour="reco-feed"]')?.scrollIntoView());
    }
    // 押した行はその場で「キューに追加しました」、並びは動かない
    const third = feedA.items[2];
    await rows.nth(2).getByRole('button', { name: /をキューに追加$/ }).click();
    await page.waitForTimeout(700);
    const closer = page.getByRole('button', { name: 'プレイヤーを閉じる' });
    if (vp.mobile && (await closer.isVisible().catch(() => false))) {
      await closer.click();
      await page.waitForTimeout(600);
    }
    check(`${tag}: 押すと add-url`, calls.added.some((b) => b.url === third.url), JSON.stringify(calls.added.at(-1)));
    const r2 = await rows.nth(2).innerText();
    check(`${tag}: 押した行がその場で「追加しました」`, r2.includes('キューに追加しました') && r2.includes(third.title.slice(0, 4)), r2.replace(/\n/g, ' / '));
    check(`${tag}: 流したことを記録`, calls.feedback.some((f) => f.key === third.key && f.action === 'play'));
    // 外す
    const fourth = feedA.items[3];
    await rows.nth(3).hover().catch(() => {});
    await rows.nth(3).getByRole('button', { name: /をおすすめから外す$/ }).click();
    await page.waitForTimeout(500);
    check(`${tag}: ×で外すと消える`, !(await feed.innerText()).includes(fourth.title), fourth.title);
    // 曲を置く（貼り付けただけ）→ 見出しとおすすめが入れ替わる・置き場の先頭に
    const bar = page.locator('[data-tour="place-bar"]');
    await bar.scrollIntoViewIfNeeded();
    await bar.getByLabel('曲のリンク').fill('https://example.com/x');
    await bar.getByRole('button', { name: '置く' }).click();
    await page.waitForTimeout(500);
    check(`${tag}: 対応外のリンクはその場でエラー`, (await bar.innerText()).includes('置けます'));
    const feedsBefore = calls.feedGets;
    await bar.getByLabel('曲のリンク').fill('');
    await bar.getByLabel('曲のリンク').evaluate((el, text) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, 'https://www.youtube.com/watch?v=agRKS958D2g');
    await page.waitForTimeout(2000);
    check(`${tag}: 貼っただけで置ける`, calls.boxPosts.at(-1)?.text === 'https://www.youtube.com/watch?v=agRKS958D2g', JSON.stringify(calls.boxPosts.at(-1)));
    check(`${tag}: 「置きました」と流すボタン`, (await bar.innerText()).includes('置きました') && (await bar.getByRole('button', { name: '流す' }).count()) === 1);
    check(`${tag}: 置くとおすすめを取り直す`, calls.feedGets > feedsBefore, `${feedsBefore}→${calls.feedGets}`);
    const cap = await page.getByTestId('reco-caption').innerText();
    check(`${tag}: 見出しが「置いた…に合わせて」に変わる`, cap.includes(feedB.context.label), cap);
    check(`${tag}: 置いた曲から広げた曲が上に`, (await rows.first().innerText()).includes(feedB.items[0].title.slice(0, 4)), feedB.items[0].reason);
    await page.screenshot({ path: join(OUT, `shelf-${tag}-2-placed.png`) });
    // まとめて流す
    const before = calls.added.length;
    await feed.getByRole('button', { name: 'まとめて流す' }).click();
    await page.waitForTimeout(2400);
    check(`${tag}: まとめて流す`, calls.added.length - before === 5, `${calls.added.length - before}`);
    // みんなの置き場
    const list = page.locator('[data-tour="shelf-list"]');
    await list.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    const ltext = await list.innerText();
    check(`${tag}: 置き場に Discord とアプリが 1 本で`, ltext.includes('#曲置き場') && ltext.includes('アプリ'));
    const firstShelf = await list.locator('[role="listitem"]').first().innerText();
    check(`${tag}: 置いた曲が置き場の先頭（自分）`, firstShelf.includes(placed.title.slice(0, 5)) && firstShelf.includes('自分'), firstShelf.replace(/\n/g, ' / '));
    const othersApp = state0.shelfItems.filter((x) => x.source === 'アプリ' && !x.mine);
    const allText = await list.innerText();
    check(`${tag}: ほかの人がアプリで置いた曲は名前を出さない`, othersApp.length === 0 || othersApp.every((x) => !x.who), `${othersApp.length}`);
    check(`${tag}: Discord の曲は貼った人が出る`, /#曲置き場/.test(allText) && state0.shelfItems.some((x) => x.source === '#曲置き場' && x.who && allText.includes(x.who.name)));
    check(`${tag}: 置き場は 12 曲＋もっと見る`, (await list.locator('[role="listitem"]').count()) === 12 && (await list.getByRole('button', { name: /^もっと見る/ }).count()) === 1);
    await page.screenshot({ path: join(OUT, `shelf-${tag}-3-list.png`) });
    await list.locator('[role="listitem"]').first().hover().catch(() => {});
    await list.getByRole('button', { name: /を取り出す$/ }).first().click();
    await page.waitForTimeout(600);
    check(`${tag}: 自分の曲を取り出す → DELETE`, calls.boxDeletes.length === 1 && calls.boxDeletes[0] === placed.id, JSON.stringify(calls.boxDeletes));
    check(`${tag}: 横スクロールなし`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    // 使い方
    await page.getByRole('button', { name: /^お知らせ/ }).click();
    await page.locator('li', { hasText: '曲置き場が新しくなりました' }).getByRole('button', { name: '使い方を見る' }).first().click();
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
    check(`${tag}: 使い方が最後まで進む`, titles.join(' → ') === 'ここが曲置き場 → リンクを貼るだけで置ける → いまのおすすめ → みんなの置き場', titles.join(' → '));
    check(`${tag}: エラーなし`, errors.length === 0, errors.slice(0, 2).join(' | '));
  } catch (e) {
    check(`${tag}: flow`, false, e.message.split('\n')[0]);
    await page.screenshot({ path: join(OUT, `shelf-${tag}-fail.png`) }).catch(() => {});
  }
  await context.browser().close();
}
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures ? 1 : 0);
