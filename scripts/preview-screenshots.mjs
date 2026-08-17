#!/usr/bin/env node
/**
 * レイアウト検証用スクリーンショット
 *
 * 使い方:
 *   cd frontend && bun run dev            # 別ターミナルで dev サーバー起動 (http://localhost:3000)
 *   node scripts/preview-screenshots.mjs  # → scripts/screenshots/*.png（playwright は frontend の devDependency を使用）
 *
 * /dev-preview をモックセッションで開き、バックエンドAPI・WebSocket を route モックして
 * 複数ビューポートで撮影する。ログイン不要。
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.PREVIEW_BASE || 'http://localhost:3000';
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(OUT, { recursive: true });

const GUILD = '1093915551174234212';
const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const track = (title, artist, id, added) => ({
  title, artist, thumbnail: thumb(id), url: `https://music.youtube.com/watch?v=${id}`,
  added_by: added ? { id: '1', name: 'als0028', image: 'https://cdn.discordapp.com/embed/avatars/1.png' } : null,
});
const CURRENT = track('烏 - Raven', 'Kenshi Yonezu 米津玄師', 'x8VYWazR5mE', true);
const QUEUE = [
  track('夜に駆ける', 'YOASOBI', 'by4SYYWlhEs', true),
  track('アイドル', 'YOASOBI', 'm9SMT5ipbxk', true),
  track('ヨルシカ - 春泥棒（OFFICIAL VIDEO）', 'ヨルシカ', 'Sw1Flgub9s8', false),
  track('雨とカプチーノ', 'ヨルシカ', 'PWbRleMGagU', true),
  track('Lemon', '米津玄師', 'SX_ViT4Ra7k', true),
];
const wsQueue = [{ track: CURRENT, position: 0, isCurrent: true }, ...QUEUE.map((t, i) => ({ track: t, position: i + 1, isCurrent: false }))];

const VIEWPORTS = [
  { name: 'mobile-390x844',   width: 390,  height: 844,  mobile: true },
  { name: 'mobile-landscape-844x390', width: 844, height: 390, mobile: true },
  { name: 'tablet-768x1024',  width: 768,  height: 1024, mobile: true },
  { name: 'laptop-1280x720',  width: 1280, height: 720 },
  { name: 'laptop-1376x870',  width: 1376, height: 870 },
  { name: 'desktop-1920x1080', width: 1920, height: 1080 },
];

const MOCK_SESSION = { user: { id: '000000000000000001', name: 'als0028', email: 'preview@example.com', image: 'https://cdn.discordapp.com/embed/avatars/1.png' }, expires: new Date(Date.now() + 86400000).toISOString() };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function setupMocks(context) {
  // next-auth の SessionProvider がマウント時に取りに来る（バージョンによる）
  await context.route('**/api/auth/session', r => json(r, MOCK_SESSION));
  await context.route('**/api/discord/userGuilds', r => json(r, [{ id: GUILD, name: 'ドデカサーバー', permissions: '0' }]));
  await context.route(`**/bot-voice-status/**`, r => json(r, { channel_id: 'vc1' }));
  await context.route(`**/voice-channels/**`, r => json(r, [{ id: 'vc1', name: 'ロビー' }, { id: 'vc2', name: '作業部屋' }]));
  await context.route(`**/user-voice-status/**`, r => json(r, { channel_id: 'vc1' }));
  await context.route(`**/auto-connect-info/**`, r => json(r, { guild_id: GUILD, channel_id: 'vc1' }));
  await context.route(`**/current-track/**`, r => json(r, CURRENT));
  await context.route(`**/queue/**`, r => json(r, wsQueue));
  await context.route(`**/history/**`, r => json(r, []));
  await context.route(`**/is-playing/**`, r => json(r, { is_playing: true }));
  await context.route(`**/related/**`, r => json(r, { results: QUEUE.map(t => ({ type: 'song', ...t })) }));
  await context.route(`**/uploaded-audio-list/**`, r => json(r, []));
  // WebSocket: 実サーバーには繋がず、初期状態を1回だけ流す
  await context.routeWebSocket(/\/ws\//, ws => {
    ws.send(JSON.stringify({ type: 'update', data: { queue: wsQueue, is_playing: true, history: [], version: 1, timestamp: Date.now() } }));
  });
}

async function shoot(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    isMobile: !!vp.mobile, hasTouch: !!vp.mobile,
    deviceScaleFactor: 1, locale: 'ja-JP',
  });
  await setupMocks(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`${BASE}/dev-preview`, { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.setItem('homeActiveTab', 'home'); });
  await page.waitForTimeout(1500);

  // 1) ホーム
  await page.screenshot({ path: join(OUT, `${vp.name}-home.png`) });

  // 2) プレイヤー（モバイル: ミニプレイヤーをタップ / デスクトップ: 右パネルが常時表示）
  const mini = page.getByRole('button', { name: 'プレイヤーを開く' });
  if (await mini.count()) {
    await mini.first().click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: join(OUT, `${vp.name}-player.png`) });
    if (process.env.DEBUG_LAYOUT) {
      console.log(vp.name, await page.evaluate(() => {
        const e = document.querySelector('.player-sheet-body'); if (!e) return 'no .player-sheet-body';
        const cs = getComputedStyle(e);
        return { mq: matchMedia('(orientation: landscape) and (max-height: 500px)').matches, dir: cs.flexDirection, maxW: cs.maxWidth, h: e.getBoundingClientRect().height };
      }));
    }
    // キューDrawer
    const queueBtn = page.getByRole('button', { name: /キュー/ }).first();
    if (await queueBtn.count()) {
      await queueBtn.click();
      await page.waitForTimeout(700);
      await page.screenshot({ path: join(OUT, `${vp.name}-queue.png`) });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    }
    await page.getByRole('button', { name: 'プレイヤーを閉じる' }).click();
    await page.waitForTimeout(600);
    if (process.env.DEBUG_LAYOUT) {
      console.log(vp.name, 'after close: closeBtn=', await page.getByRole('button', { name: 'プレイヤーを閉じる' }).count(), 'mainKids=', await page.evaluate(() => [...document.querySelector('main').children].map(k => k.className.slice(0, 30))));
    }
  } else {
    // デスクトップ: 関連曲タブ
    const relatedTab = page.getByRole('tab', { name: '関連曲' });
    if (await relatedTab.count()) {
      await relatedTab.first().click();
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(OUT, `${vp.name}-related.png`) });
      await page.getByRole('tab', { name: /キュー/ }).first().click();
    }
  }

  // 3) 検索
  await page.getByRole('button', { name: '検索', exact: true }).click();
  await page.getByPlaceholder('曲名、アーティスト、アルバムを検索').fill('YOASOBI');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(OUT, `${vp.name}-search.png`) });
  if (process.env.DEBUG_LAYOUT) {
    console.log(vp.name, 'search', await page.evaluate(() => {
      const h2 = [...document.querySelectorAll('h2')].map(e => e.textContent).slice(0, 5);
      const sr = document.querySelector('main > div.absolute');
      const kids = sr ? [...sr.children].map(k => k.className.slice(0, 60) + ' h=' + k.getBoundingClientRect().height + ' op=' + getComputedStyle(k).opacity + ' text=' + (k.textContent || '').slice(0, 40)) : [];
      const el = document.elementFromPoint(150, 300);
      const chain = []; let n = el; while (n && chain.length < 6) { chain.push(n.tagName + '.' + String(n.className).slice(0, 40)); n = n.parentElement; }
      return { h2: h2.length, hasOverlay: !!sr, kids: kids.length, mainKids: [...document.querySelector('main').children].map(k => k.className.slice(0, 50)), chain };
    }));
  }

  // 4) サイドメニュー
  await page.getByRole('button', { name: 'メニューを開く' }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, `${vp.name}-menu.png`) });

  // 横スクロールが発生していないか
  const overflow = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    sh: document.documentElement.scrollHeight, ch: document.documentElement.clientHeight,
  }));
  await context.close();
  return { errors, overflow };
}

const browser = await chromium.launch();
let failed = false;
for (const vp of VIEWPORTS) {
  try {
    const { errors, overflow } = await shoot(browser, vp);
    const hOverflow = overflow.sw > overflow.cw;
    const vOverflow = overflow.sh > overflow.ch;
    console.log(`${hOverflow || errors.length ? 'WARN' : 'OK  '} ${vp.name}  scrollW=${overflow.sw}/${overflow.cw} scrollH=${overflow.sh}/${overflow.ch}${vOverflow ? ' (縦スクロールあり)' : ''}${errors.length ? `  console/page errors: ${errors.length}` : ''}`);
    for (const e of errors.slice(0, 5)) console.log('     ', e.slice(0, 200));
    if (hOverflow) failed = true;
  } catch (e) {
    failed = true;
    console.log(`FAIL ${vp.name}: ${e.message.split('\n')[0]}`);
  }
}
await browser.close();
console.log(`screenshots → ${OUT}`);
process.exit(failed ? 1 : 0);
