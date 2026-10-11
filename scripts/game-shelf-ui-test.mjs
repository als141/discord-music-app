#!/usr/bin/env node
/**
 * ゲーム置き場タブの画面テスト（/dev-preview + モック）。
 *   cd frontend && NEXT_PUBLIC_BUILD_ID=test-a NEXT_PUBLIC_API_URL=https://api.atoriba.jp bunx next dev -p 3100
 *   BOARD_FIXTURE=path/to/board.json PREVIEW_BASE=http://localhost:3100 node scripts/game-shelf-ui-test.mjs
 * BOARD_FIXTURE は GET /games/{guild}/board の応答（backend の game_shelf.build_board＋scene.build_games の出力）。
 * SONGS_FIXTURE（任意）は GET /scene/{guild}/songs の応答（scene.build_songs）。あれば曲置き場の「界隈の新曲」も確かめる
 * RESEARCH_FIXTURE（任意）は GET /research/{guild}/feed の応答（daily 1 件以上・question を含む）。あれば調査タブも確かめる
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
const songs = process.env.SONGS_FIXTURE ? JSON.parse(readFileSync(process.env.SONGS_FIXTURE, 'utf8')) : null;
const research = process.env.RESEARCH_FIXTURE ? JSON.parse(readFileSync(process.env.RESEARCH_FIXTURE, 'utf8')) : null;
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
    // 最初の読み込みだけ（読み込み直したときは、そのとき保存されているタブのまま）
    if (!sessionStorage.getItem('ui-test-init')) {
      sessionStorage.setItem('ui-test-init', '1');
      localStorage.setItem('homeActiveTab', 'home');
    }
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
  // 調査: フィード・質問・一覧に無い古い調査（id 999）
  const asked = [];
  let feed = research ? structuredClone(research) : { reports: [], questions_left: 3, daily_limit: 3 };
  await context.route(/\/research\/\d+\/feed/, (r) => json(r, feed));
  await context.route(/\/research\/\d+\/ask/, (r) => {
    const body = JSON.parse(r.request().postData() || '{}');
    asked.push(body);
    const rep = { id: 500 + asked.length, guild_id: GUILD, kind: 'question', title: body.question, markdown: null, sources: [], status: 'running', question: body.question, asked_by: '000000000000000001', asked_by_name: 'tester', model: null, sec: null, created_at: new Date().toISOString(), done_at: null, posted_at: null };
    feed = { ...feed, reports: [rep, ...feed.reports], questions_left: feed.questions_left - 1 };
    json(r, rep);
  });
  await context.route(/\/research\/\d+\/item\/\d+/, (r) => {
    const id = Number(r.request().url().split('/').pop());
    const base = (research?.reports || []).find((x) => x.kind === 'daily');
    json(r, base ? { ...base, id, title: '今週の新作 10/5', kind: 'weekly_new', markdown: '## 今週の新作\n- テスト用の古い調査（一覧に無い）\n\n**イリーナ**「古いのも読めるわよ」' } : {}, base ? 200 : 404);
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
  return { context, page, errors, marks, added, asked };
}

for (const vp of [{ name: 'mobile-390x844', width: 390, height: 844, mobile: true }, { name: 'desktop-1376x870', width: 1376, height: 870 }]) {
  const { context, page, errors, marks, added, asked } = await setup(vp);
  const tag = vp.name;
  try {
    await page.goto(`${BASE}/dev-preview`, { waitUntil: 'domcontentloaded' });
    const tab = page.locator('[data-tour="tab-games"]');
    await tab.waitFor({ timeout: 20000 });
    const navTabs = page.locator('nav[aria-label="メインナビゲーション"] [role="tab"]');
    const firstTab = await navTabs.first().getAttribute('data-tour');
    check(`${tag}: 先頭のタブが調査`, firstTab === 'tab-research', firstTab);
    // Ver. 1.6.0: 前のタブを覚えていても 1 回だけ調査から始まる
    check(`${tag}: 初回は調査タブが開く`, (await page.locator('[data-tour="tab-research"]').getAttribute('aria-selected')) === 'true');
    if (research) {
      const daily = page.locator('[data-tour="research-daily"]');
      await daily.waitFor({ timeout: 15000 });
      await page.waitForTimeout(800);
      const irinaLine = (research.reports.find((x) => x.kind === 'daily').markdown.match(/^\*\*イリーナ\*\*\s*[「『]?(.{6})/m) || [])[1];
      check(`${tag}: 調査にイリーナの一言`, !!irinaLine && (await daily.getByText(irinaLine, { exact: false }).count()) > 0, irinaLine);
      const tonightH = daily.locator('h3', { hasText: /^今夜/ }).first();
      check(`${tag}: 「今夜」の節がローズ`, (await tonightH.count()) > 0 && (await tonightH.getAttribute('class')).includes('text-primary'));
      const links = await daily.locator('a[target="_blank"]').count();
      check(`${tag}: 出典リンク`, links >= 3, `${links}`);
      check(`${tag}: 「**イリーナ**」の行は本文に残らない`, !(await daily.innerText()).includes('**イリーナ**'));
      await page.screenshot({ path: join(OUT, `research-${tag}-1-daily.png`) });
      const askSec = page.locator('[data-tour="research-ask"]');
      await askSec.scrollIntoViewIfNeeded();
      check(`${tag}: 調べ中の質問`, (await askSec.getByText('調べ中…').count()) > 0);
      check(`${tag}: 調べられなかった質問`, (await askSec.getByText(/調べられませんでした/).count()) > 0);
      const left0 = research.questions_left;
      check(`${tag}: 残り回数`, (await askSec.getByText(`今日はあと ${left0} 回`).count()) === 1);
      // 例を押すと入力欄に入る → 調べる
      await askSec.getByRole('button', { name: '4人でできる安い協力ホラー', exact: true }).click();
      check(`${tag}: 例が入力欄に入る`, (await askSec.getByLabel('調べてほしいこと').inputValue()) === '4人でできる安い協力ホラー');
      await askSec.getByRole('button', { name: /調べる/ }).click();
      await page.waitForTimeout(800);
      check(`${tag}: 質問を送る`, asked.length === 1 && asked[0].question === '4人でできる安い協力ホラー', JSON.stringify(asked));
      check(`${tag}: 送った質問が一覧の先頭に`, (await askSec.locator('ul[aria-label="みんなの質問"] li').first().innerText()).includes('4人でできる安い協力ホラー'));
      check(`${tag}: 残り回数が減る`, (await askSec.getByText(`今日はあと ${left0 - 1} 回`).count()) === 1);
      check(`${tag}: 入力欄が空に`, (await askSec.getByLabel('調べてほしいこと').inputValue()) === '');
      // 答えの出た質問を開く
      const done = research.reports.find((x) => x.kind === 'question' && x.status === 'done');
      if (done) {
        await askSec.locator('ul[aria-label="みんなの質問"] button', { hasText: done.question.slice(0, 12) }).first().click();
        const d = page.locator('[data-tour="research-detail"]');
        await d.waitFor({ timeout: 8000 });
        await page.waitForTimeout(600);
        check(`${tag}: 質問の答えが開く`, (await d.locator('a[target="_blank"]').count()) >= 1);
        await page.screenshot({ path: join(OUT, `research-${tag}-2-answer.png`) });
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
      }
      check(`${tag}: 調査で横スクロールなし`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    }
    // 「音楽」の中のライブラリ（前はタブ）
    for (let i = 0; i < 6; i++) {
      await page.locator('[data-tour="tab-home"]').click();
      if (await page.locator('[data-tour="music-library"]').isVisible().catch(() => false)) break;
      await page.waitForTimeout(800);
    }
    await page.locator('[data-tour="music-library"]').click();
    await page.waitForTimeout(600);
    check(`${tag}: ライブラリを開くと「音楽」タブが選択のまま`, (await page.locator('[data-tour="tab-home"]').getAttribute('aria-selected')) === 'true');
    check(`${tag}: タブは 4 つ（ライブラリはタブに無い）`, (await navTabs.count()) === 4, `${await navTabs.count()}`);
    await page.getByRole('button', { name: '音楽', exact: true }).last().click();
    await page.waitForTimeout(600);
    check(`${tag}: 戻ると音楽`, await page.locator('[data-tour="music-library"]').isVisible());
    // スマホでも 4 つのタブが 1 行に収まる（最後のタブが画面の中）
    const lastTabBox = await navTabs.last().boundingBox();
    check(`${tag}: タブが画面に収まる`, !!lastTabBox && lastTabBox.x + lastTabBox.width <= vp.width, JSON.stringify(lastTabBox));
    // ハイドレーション前のクリックは効かないので、選ばれるまで押し直す
    for (let i = 0; i < 10; i++) {
      await tab.click();
      if (await page.getByText('今夜どれ？').isVisible().catch(() => false)) break;
      await page.waitForTimeout(1000);
    }
    await page.getByText('今夜どれ？').waitFor({ timeout: 15000 });
    await page.waitForTimeout(1200);
    check(`${tag}: いま（VC 3 人）`, await page.getByText(/ゲーム に 3 人/).isVisible());
    check(`${tag}: プレイ中の表示`, await page.locator('[data-tour="games-now"]').getByText(/R\.E\.P\.O\./).first().isVisible());
    if (board.scene) {
      const scene = page.locator('[data-tour="games-scene"]');
      check(`${tag}: 界隈で話題`, await scene.isVisible());
      const streamerCards = await scene.locator('[aria-label="配信者がいまやってるゲーム"]').locator('button, a').count();
      const freshCards = await scene.locator('[aria-label="話題の新作・インディー"] button').count();
      check(`${tag}: 配信者がいまやってる・話題の新作`, streamerCards >= 3 && freshCards >= 3, `${streamerCards}/${freshCards}`);
      // 置き場に無い話題作を開く → 「界隈では」と やりたい
      const notOnShelf = board.scene.fresh.find((e) => !e.on_shelf);
      if (notOnShelf) {
        await scene.locator('[aria-label="話題の新作・インディー"] button', { hasText: notOnShelf.card.name }).first().click();
        const d = page.locator('[data-tour="game-detail"]');
        await d.waitFor({ timeout: 8000 });
        await page.waitForTimeout(500);
        check(`${tag}: 話題作の詳細に「界隈では」`, (await d.innerText()).includes('界隈では'));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(400);
      }
    }
    // VC に 2 人以上なら「今夜どれ？」が「界隈で話題」より上（答えを先に）
    if (board.now.voice.length >= 2 && board.scene) {
      const yT = (await page.locator('[data-tour="games-tonight"]').boundingBox())?.y ?? 0;
      const yS = (await page.locator('[data-tour="games-scene"]').boundingBox())?.y ?? 0;
      check(`${tag}: VC に人がいると今夜どれ？が先`, yT < yS, `${Math.round(yT)} < ${Math.round(yS)}`);
    }
    const picks = await page.locator('[data-tour="games-tonight"] [data-tour="games-first-pick"], [data-tour="games-tonight"] [aria-label="今夜の候補"] button').count();
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
    const wantBox = await sheet.getByRole('button', { name: 'やりたい' }).boundingBox();
    check(`${tag}: 詳細の操作がスクロールせずに見える`, !!wantBox && wantBox.y + wantBox.height <= vp.height, JSON.stringify(wantBox));
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
    await page.locator('li', { hasText: 'ゲーム置き場と曲置き場' }).getByRole('button', { name: '使い方を見る' }).first().click();
    const titles = [];
    for (let i = 0; i < 10; i++) {
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
    check(`${tag}: ゲーム置き場の案内が最後まで進む`, titles.length >= 6 && titles.includes('界隈で話題') && titles.at(-1) === '貼るのはいつも通り', titles.join(' → '));
    if (research) {
      await page.waitForTimeout(600);
      await page.getByRole('button', { name: /^お知らせ/ }).click();
      await page.locator('li', { hasText: 'イリーナの調査' }).getByRole('button', { name: '使い方を見る' }).first().click();
      const rt = [];
      for (let i = 0; i < 8; i++) {
        const ok = await page.waitForFunction(() => {
          const d = document.querySelector('[data-guide-tour] [role=dialog]');
          return d && getComputedStyle(d).opacity === '1';
        }, null, { timeout: 8000 }).then(() => true).catch(() => false);
        if (!ok) break;
        rt.push(await page.locator('[data-guide-tour] [role=dialog] h2').textContent());
        const last = await page.getByRole('button', { name: '完了' }).count();
        await page.getByRole('button', { name: last ? '完了' : '次へ' }).click();
        await page.waitForTimeout(300);
        if (last) break;
      }
      check(`${tag}: 調査の案内が最後まで進む`, rt.join(' → ') === 'ここが調査 → 今日の調査 → 聞けば調べる → Discord でも', rt.join(' → '));
      // 通知・Discord の埋め込みのリンク（一覧に無い古い調査）。/dev-preview はセッションを渡して SSR するので、
      // 保存しているタブと SSR の既定（調査）が違うとハイドレーションの警告が出る（本番はセッション取得まで描かないので出ない）
      await page.evaluate(() => localStorage.setItem('homeActiveTab', 'research'));
      await page.goto(`${BASE}/dev-preview?tab=research&r=999`, { waitUntil: 'domcontentloaded' });
      const d = page.locator('[data-tour="research-detail"]');
      const opened = await d.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
      check(`${tag}: ?tab=research&r= で調査が開く`, opened && (await d.innerText()).includes('テスト用の古い調査'));
      await page.screenshot({ path: join(OUT, `research-${tag}-3-deeplink.png`) });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
    if (songs && songs.songs.length) {
      await page.locator('[data-tour="tab-shelf"]').click();
      const sec = page.locator('[data-tour="shelf-scene"]');
      await sec.waitFor({ timeout: 10000 });
      check(`${tag}: 曲置き場に「界隈の新曲」`, (await sec.locator('button[aria-label$="をキューに追加"]').count()) >= 3);
      check(`${tag}: 曲置き場に「みんなが貼った」`, await page.getByRole('heading', { name: 'みんなが貼った' }).isVisible());
      await page.screenshot({ path: join(OUT, `games-${tag}-4-songs.png`) });
      await sec.locator('button[aria-label$="をキューに追加"]').first().click();
      await page.waitForTimeout(1200);
      const want = songs.songs[0].play_video_id;
      check(`${tag}: 界隈の新曲を押すとキューに追加`, added.some((b) => JSON.stringify(b).includes(want)), JSON.stringify(added).slice(0, 120));
    }
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
