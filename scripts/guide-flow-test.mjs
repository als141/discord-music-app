#!/usr/bin/env node
/**
 * お知らせ・新機能カード・画面案内（曲置き場ツアー）・更新通知の E2E テスト
 *
 * 使い方:
 *   cd frontend && NEXT_PUBLIC_BUILD_ID=test-a NEXT_PUBLIC_API_URL=https://api.atoriba.jp bunx next dev -p 3100
 *   PREVIEW_BASE=http://localhost:3100 node scripts/guide-flow-test.mjs
 *
 * /dev-preview（モックセッション）を開き、API と WebSocket は route モック。ログイン不要。
 * スクリーンショットは scripts/screenshots/guide-*.png
 */
import { createRequire } from 'node:module';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { chromium } = require('playwright');
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.PREVIEW_BASE || 'http://localhost:3100';
const OUT = process.env.SHOT_DIR || join(dirname(fileURLToPath(import.meta.url)), 'screenshots');
mkdirSync(OUT, { recursive: true });

const GUILD = '1093915551174234212';
const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
const track = (title, artist, id) => ({ title, artist, thumbnail: thumb(id), url: `https://music.youtube.com/watch?v=${id}`, added_by: null });
const CURRENT = track('夜に駆ける', 'YOASOBI', 'by4SYYWlhEs');
const wsQueue = [{ track: CURRENT, position: 0, isCurrent: true }];
const user = (id, name) => ({ id, name, image: `https://cdn.discordapp.com/embed/avatars/${id % 5}.png` });
const SHELF = {
  channels: [{ id: 'c1', name: '曲置き場', count: 3 }, { id: 'c2', name: '一般', count: 2 }],
  tracks: [
    ['Sw1Flgub9s8', '春泥棒', 'ヨルシカ', 'c1', 1], ['m9SMT5ipbxk', 'アイドル', 'YOASOBI', 'c1', 2], ['x8VYWazR5mE', 'KICK BACK', '米津玄師', 'c1', 3],
    ['PWbRleMGagU', '雨とカプチーノ', 'ヨルシカ', 'c2', 1], ['SX_ViT4Ra7k', 'Lemon', '米津玄師', 'c2', 2],
  ].map(([vid, title, artist, ch, u], i) => ({
    id: i + 1, video_id: vid, url: `https://www.youtube.com/watch?v=${vid}`, title, artist, thumbnail: thumb(vid),
    channel_id: ch, channel_name: ch === 'c1' ? '曲置き場' : '一般', posted_by: user(u, ['kairi', 'yuki', 'als0028'][u - 1]),
    posted_at: new Date(Date.now() - (i + 1) * 3600e3).toISOString(),
  })),
};
const MOCK_SESSION = { user: { id: '000000000000000001', name: 'als0028', email: 'preview@example.com', image: 'https://cdn.discordapp.com/embed/avatars/1.png' }, expires: new Date(Date.now() + 86400000).toISOString() };
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function newContext(browser, vp, state) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.mobile, hasTouch: !!vp.mobile,
    deviceScaleFactor: 1, locale: 'ja-JP',
  });
  await context.addInitScript(() => { try { localStorage.setItem('homeActiveTab', 'home'); } catch {} });
  await context.route('**/api/auth/session', (r) => json(r, MOCK_SESSION));
  await context.route('**/api/discord/userGuilds', (r) => json(r, [{ id: GUILD, name: 'ドデカサーバー', permissions: '0' }]));
  await context.route('**/api/version', (r) => json(r, { buildId: state.serverBuild, version: '1.1.0' }));
  await context.route('**/bot-guilds**', (r) => json(r, [{ id: GUILD, name: 'ドデカサーバー' }]));
  await context.route('**/bot-voice-status/**', (r) => json(r, { channel_id: 'vc1' }));
  await context.route('**/voice-channels/**', (r) => json(r, [{ id: 'vc1', name: 'ロビー' }]));
  await context.route('**/user-voice-status/**', (r) => json(r, { channel_id: 'vc1' }));
  await context.route('**/auto-connect-info/**', (r) => json(r, { guild_id: GUILD, channel_id: 'vc1' }));
  await context.route('**/current-track/**', (r) => json(r, CURRENT));
  await context.route('**/queue/**', (r) => json(r, wsQueue));
  await context.route('**/history/**', (r) => json(r, []));
  await context.route('**/history-stats/**', (r) => json(r, { guild_id: GUILD, days: 30, total_plays: 0, top_users: [], top_tracks: [] }));
  await context.route('**/is-playing/**', (r) => json(r, { is_playing: true }));
  await context.route('**/uploaded-audio-list/**', (r) => json(r, []));
  await context.route('**/recommendations**', (r) => json(r, []));
  await context.route('**/shared-tracks/**', (r) => json(r, SHELF));
  await context.route('**/add-url/**', (r) => { state.addUrlCalls++; return json(r, { message: 'ok' }); });
  await context.routeWebSocket(/\/ws\//, (ws) => {
    ws.send(JSON.stringify({ type: 'update', data: { queue: wsQueue, is_playing: true, history: [], version: 1, epoch: 'e1', has_player: true, timestamp: Date.now() } }));
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon|i\.ytimg|cdn\.discordapp/.test(m.text())) errors.push(m.text()); });
  return { context, page, errors };
}

/** 案内カードの見出しが出るまで待つ。失敗時はいま出ている見出しを添える */
async function waitHeading(page, name, timeout = 8000) {
  try {
    await page.getByRole('heading', { name }).waitFor({ timeout });
  } catch {
    const now = await page.locator('[role=dialog] h2').allTextContents().catch(() => []);
    throw new Error(`見出し「${name}」が出ない（表示中: ${now.join(' | ') || 'なし'}）`);
  }
}

/** 案内カードが表示し終わる（位置が決まって不透明になる）まで待ち、かかった時間を返す */
async function waitReady(page, label, limitMs = 1500) {
  const t0 = Date.now();
  const title = label.match(/「(.+)」/)?.[1];
  await page.waitForFunction((t) => {
    const d = document.querySelector('[data-guide-tour] [role=dialog]');
    return d && getComputedStyle(d).opacity === '1' && d.querySelector('h2')?.textContent === t;
  }, title, { timeout: 8000 });
  const ms = Date.now() - t0;
  check(`${label}: 表示まで ${limitMs}ms 以内`, ms <= limitMs, `${ms}ms`);
  await page.waitForTimeout(200);
}

const guideState = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('irina-guide') || '{}').state || {});
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

async function mainFlow(browser, vp) {
  const state = { serverBuild: 'test-a', addUrlCalls: 0 };
  const { context, page, errors } = await newContext(browser, vp, state);
  const tag = vp.name;
  await page.goto(`${BASE}/dev-preview`, { waitUntil: 'domcontentloaded' });

  // 1) 新機能カード
  const promo = page.getByRole('region', { name: '新機能のお知らせ' });
  await promo.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  check(`${tag}: 新機能カードが出る`, await promo.isVisible());
  const bell = page.getByRole('button', { name: /^お知らせ/ });
  check(`${tag}: ベルに未読 2 件`, (await bell.getAttribute('aria-label'))?.includes('未読 2 件'), await bell.getAttribute('aria-label'));
  check(`${tag}: 曲置き場タブに NEW`, (await page.locator('[data-tour="tab-shelf"]').getAttribute('aria-label'))?.includes('新機能'));
  check(`${tag}: 横スクロールなし（カード表示中）`, await noOverflow(page));
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, `guide-${tag}-1-promo.png`) });

  // 2) 案内開始
  await promo.getByRole('button', { name: '使い方を見る' }).click();
  const dialog = page.getByRole('dialog');
  await waitHeading(page, 'ここが曲置き場', 8000);
  await waitReady(page, `${tag}: 「ここが曲置き場」`);
  check(`${tag}: 案内 1/4 が出る`, await dialog.isVisible());
  check(`${tag}: 新機能カードは消える`, !(await promo.isVisible()));
  const tabBox = await page.locator('[data-tour="tab-shelf"]').boundingBox();
  const cardBox = await dialog.boundingBox();
  check(`${tag}: カードがタブの下に出る`, cardBox.y > tabBox.y + tabBox.height, `tab.bottom=${Math.round(tabBox.y + tabBox.height)} card.top=${Math.round(cardBox.y)}`);
  check(`${tag}: 主ボタンにフォーカス`, await page.evaluate(() => document.activeElement?.textContent === '次へ'));
  await page.screenshot({ path: join(OUT, `guide-${tag}-2-step1.png`) });

  // 切り抜きの外は押せない（検索ボタンを押しても検索パネルが開かない）
  const searchBtn = await page.getByRole('button', { name: '検索', exact: true }).boundingBox();
  await page.mouse.click(searchBtn.x + searchBtn.width / 2, searchBtn.y + searchBtn.height / 2);
  await page.waitForTimeout(300);
  check(`${tag}: 案内中は外側を押せない`, !(await page.getByPlaceholder('曲名、アーティスト、アルバムを検索').isVisible()));

  // 3) タブそのものを押して進む（interactive）
  await page.mouse.click(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2);
  await waitHeading(page, 'チャンネルで切り替え', 8000);
  await waitReady(page, `${tag}: 「チャンネルで切り替え」`);
  check(`${tag}: タブを押すと 2/4 へ`, true);
  check(`${tag}: 曲置き場タブが選択された`, (await page.locator('[data-tour="tab-shelf"]').getAttribute('aria-selected')) === 'true');
  await page.screenshot({ path: join(OUT, `guide-${tag}-3-step2.png`) });

  // 4) カードの説明。カードを押してもキューに入らない
  await page.getByRole('button', { name: '次へ' }).click();
  await waitHeading(page, '押すとキューに追加', 8000);
  await waitReady(page, `${tag}: 「押すとキューに追加」`);
  const firstCard = await page.locator('[data-tour="shelf-first-card"]').boundingBox();
  await page.mouse.click(firstCard.x + firstCard.width / 2, firstCard.y + firstCard.height / 3);
  await page.waitForTimeout(400);
  check(`${tag}: 案内中にカードを押しても追加されない`, state.addUrlCalls === 0, `add-url=${state.addUrlCalls}`);
  await page.screenshot({ path: join(OUT, `guide-${tag}-4-step3.png`) });

  // 戻る → 次へ
  await page.getByRole('button', { name: '戻る' }).click();
  await waitHeading(page, 'チャンネルで切り替え', 8000);
  await waitReady(page, `${tag}: 「チャンネルで切り替え」`);
  await page.keyboard.press('ArrowRight');
  await waitHeading(page, '押すとキューに追加', 8000);
  check(`${tag}: 戻る / → キーで移動`, true);

  // 5) 最後
  await page.getByRole('button', { name: '次へ' }).click();
  await waitHeading(page, 'Discord に貼るだけ', 8000);
  await waitReady(page, `${tag}: 「Discord に貼るだけ」`);
  await page.screenshot({ path: join(OUT, `guide-${tag}-5-step4.png`) });
  await page.getByRole('button', { name: '完了' }).click();
  await page.waitForTimeout(300);
  check(`${tag}: 完了で案内が閉じる`, (await page.locator('[data-guide-tour]').count()) === 0);
  const st = await guideState(page);
  check(`${tag}: 完了が記録される`, st.tours?.shelf?.outcome === 'completed', JSON.stringify(st.tours));
  check(`${tag}: 曲置き場の分は既読（残りは今回の通知の告知 1 件）`, (await bell.getAttribute('aria-label')).includes('未読 1 件'), await bell.getAttribute('aria-label'));
  check(`${tag}: NEW が消える`, !(await page.locator('[data-tour="tab-shelf"]').getAttribute('aria-label')).includes('新機能'));

  // 6) 再読み込みしても新機能カードは出ない
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  check(`${tag}: 再読み込み後は新機能カードが出ない`, !(await promo.isVisible()));

  // 7) お知らせ一覧
  await page.getByRole('button', { name: /^お知らせ/ }).click();
  await page.getByText('Irina Ver. 1.2.0').waitFor({ timeout: 5000 });
  await page.waitForTimeout(500);
  const items = await page.locator('li h3').allTextContents();
  check(`${tag}: お知らせ一覧に 6 件（新しい順）`, items.length === 6 && items.includes('曲置き場'), items.join(' / '));
  await page.screenshot({ path: join(OUT, `guide-${tag}-6-center.png`) });
  // 一覧から案内を始められる
  await page.getByRole('button', { name: '使い方を見る' }).click();
  await waitHeading(page, 'ここが曲置き場', 8000);
  check(`${tag}: 一覧から案内を開始`, true);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check(`${tag}: Esc で案内をやめる`, (await page.locator('[data-guide-tour]').count()) === 0);
  check(`${tag}: やめたことが記録される`, (await guideState(page)).tours?.shelf?.outcome === 'skipped');

  // 8) 更新の知らせ
  state.serverBuild = 'test-b';
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const upd = page.getByRole('region', { name: 'アップデート' });
  await upd.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {});
  check(`${tag}: 新しいビルドで「新しいバージョン」が出る`, await upd.isVisible());
  await page.waitForTimeout(350);
  await page.screenshot({ path: join(OUT, `guide-${tag}-7-update.png`) });
  const nav = page.waitForEvent('framenavigated', { timeout: 8000 }).then(() => true).catch(() => false);
  await upd.getByRole('button', { name: '更新' }).click();
  check(`${tag}: 「更新」で読み込み直す`, await nav);

  check(`${tag}: コンソールエラーなし`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function dismissFlow(browser, vp) {
  const state = { serverBuild: 'test-a', addUrlCalls: 0 };
  const { context, page, errors } = await newContext(browser, vp, state);
  const tag = `${vp.name}-dismiss`;
  await page.goto(`${BASE}/dev-preview`, { waitUntil: 'domcontentloaded' });
  const promo = page.getByRole('region', { name: '新機能のお知らせ' });
  await promo.waitFor({ state: 'visible', timeout: 15000 });
  await promo.getByRole('button', { name: '閉じる' }).click();
  await page.waitForTimeout(400);
  check(`${tag}: × でカードが消える`, !(await promo.isVisible()));
  check(`${tag}: × で既読になる（残りは今回の通知の告知 1 件）`, (await page.getByRole('button', { name: /^お知らせ/ }).getAttribute('aria-label')).includes('未読 1 件'));
  check(`${tag}: NEW は残る（まだ開いていない）`, (await page.locator('[data-tour="tab-shelf"]').getAttribute('aria-label')).includes('新機能'));

  // 曲置き場の「使い方」から案内（途中のステップの対象が無い場合の飛ばしは別途）
  await page.locator('[data-tour="tab-shelf"]').click();
  await page.getByRole('button', { name: '使い方' }).click();
  await waitHeading(page, 'ここが曲置き場', 8000);
  check(`${tag}: 曲置き場の「使い方」から案内`, true);
  await page.getByRole('button', { name: '案内を閉じる' }).click();
  await page.waitForTimeout(300);
  check(`${tag}: × で案内を閉じる`, (await page.locator('[data-guide-tour]').count()) === 0);
  check(`${tag}: コンソールエラーなし`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

async function emptyShelfFlow(browser, vp) {
  // 曲置き場が空でも案内が止まらない（対象の無いステップは飛ばす）
  const state = { serverBuild: 'test-a', addUrlCalls: 0 };
  const { context, page, errors } = await newContext(browser, vp, state);
  await context.route('**/shared-tracks/**', (r) => json(r, { channels: [], tracks: [] }));
  const tag = `${vp.name}-empty`;
  await page.goto(`${BASE}/dev-preview`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-tour="tab-shelf"]').waitFor({ timeout: 15000 });
  await page.evaluate(() => {});
  await page.getByRole('button', { name: /Ver\. 1\.2\.0/ }).click();
  await page.getByRole('button', { name: '使い方を見る' }).click();
  await waitHeading(page, 'ここが曲置き場', 8000);
  await page.getByRole('button', { name: '次へ' }).click();
  const t0 = Date.now();
  await waitHeading(page, 'Discord に貼るだけ', 15000);
  check(`${tag}: 対象の無いステップを飛ばして最後へ`, true, `${Date.now() - t0}ms`);
  check(`${tag}: コンソールエラーなし`, errors.length === 0, errors.slice(0, 3).join(' | '));
  await context.close();
}

const VIEWPORTS = [
  { name: 'mobile-390x844', width: 390, height: 844, mobile: true },
  { name: 'desktop-1376x870', width: 1376, height: 870 },
];

const browser = await chromium.launch();
try {
  for (const vp of VIEWPORTS) {
    await mainFlow(browser, vp).catch((e) => check(`${vp.name}: main flow`, false, e.message.split('\n')[0]));
    await dismissFlow(browser, vp).catch((e) => check(`${vp.name}: dismiss flow`, false, e.message.split('\n')[0]));
  }
  await emptyShelfFlow(browser, VIEWPORTS[0]).catch((e) => check('empty shelf flow', false, e.message.split('\n')[0]));
} finally {
  await browser.close();
}
console.log(results.join('\n'));
console.log(`\n${results.length - failures}/${results.length} passed`);
process.exit(failures ? 1 : 0);
