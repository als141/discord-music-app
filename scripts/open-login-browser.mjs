#!/usr/bin/env node
/**
 * 人が Discord ログインするための headed ブラウザを開く（WSLg / X サーバー必要）。
 *   - プロフィールを .tmp/chrome-profile に永続化するので、ログイン後は Playwright から
 *     `chromium.connectOverCDP('http://127.0.0.1:9222')` で同じセッションを操作・検証できる
 *   - 終了はウィンドウを閉じる
 * usage: node scripts/open-login-browser.mjs [url]
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.resolve('frontend/package.json'));
const { chromium } = require('playwright');

const url = process.argv[2] || 'https://discord-music-app.vercel.app/';
const userDataDir = path.resolve('.tmp/chrome-profile');
const cdpPort = Number(process.env.CDP_PORT || 9222);

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: null,
  locale: 'ja-JP',
  args: [`--remote-debugging-port=${cdpPort}`, '--window-size=1280,900'],
});
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(url, { waitUntil: 'domcontentloaded' });
console.log(`[login-browser] opened ${url}`);
console.log(`[login-browser] profile=${userDataDir} cdp=http://127.0.0.1:${cdpPort}`);
context.on('close', () => {
  console.log('[login-browser] closed');
  process.exit(0);
});
