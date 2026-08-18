#!/usr/bin/env node
/**
 * 同時に複数曲を追加したときの堅牢性テスト（テストサーバー限定・本番API）
 *  - 6 件を同時に POST /add-url（うち1件は無効URL）
 *  - 期待: 有効な5曲が「追加した順」でキューに入る / 無効URLは消える / pending が残らない / version 単調増加
 * usage: node scripts/concurrent-add-test.mjs
 */
const API = process.env.API_BASE || 'https://api.atoriba.jp';
const GUILD = process.argv[2] || '1080511818658762752';
const CHANNEL = process.argv[3] || '1080511819103346828';
const URLS = [
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  'https://music.youtube.com/watch?v=by4SYYWlhEs',
  'https://www.youtube.com/watch?v=x8VYWazR5mE',
  'https://www.youtube.com/watch?v=this_is_not_a_video_id_zzz', // 無効
  'https://music.youtube.com/watch?v=m9SMT5ipbxk',
  'https://www.youtube.com/watch?v=Sw1Flgub9s8',
];
const EXPECT_IDS = ['dQw4w9WgXcQ', 'by4SYYWlhEs', 'x8VYWazR5mE', 'm9SMT5ipbxk', 'Sw1Flgub9s8'];
const t0 = Date.now(); const ts = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's';
let pass = 0, fail = 0;
const check = (n, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${n}${extra ? '  (' + extra + ')' : ''}`); };
const post = (p, body) => fetch(`${API}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const vid = (u) => (u.match(/(?:v=|youtu\.be\/)([0-9A-Za-z_-]{11})/) || [])[1] || null;

const status = await (await fetch(`${API}/bot-voice-status/${GUILD}`)).json();
if (status.channel_id) { console.log('bot は既に VC に接続中のため中止:', status); process.exit(2); }

const events = [];
const ws = new WebSocket(`${API.replace(/^http/, 'ws')}/ws/${GUILD}`);
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.type === 'update') { const d = m.data; const q = d.queue || []; events.push({ v: d.version, ids: q.map(x => vid(x.track.url)), pending: q.filter(x => x.track.pending).length, loading: d.is_loading }); } };
await new Promise(r => ws.onopen = r);
await sleep(500);

try {
  let r = await post(`/join-voice-channel/${GUILD}/${CHANNEL}`); check('join 200', r.status === 200);
  await sleep(1500);
  console.log(`${ts()} 6件同時に add-url`);
  const results = await Promise.all(URLS.map(u => post(`/add-url/${GUILD}`, { url: u, user: { id: '0', name: 'concurrent-test', image: '' } })));
  check('全 add-url が 200', results.every(x => x.status === 200), results.map(x => x.status).join(','));
  await sleep(1500);
  const early = events[events.length - 1];
  check('直後にプレースホルダがキューに並ぶ（即時フィードバック）', early && early.ids.length >= 5, JSON.stringify(early));
  // pending が消えるまで待つ（最大 120 秒）
  const start = Date.now(); let last = null;
  while (Date.now() - start < 120000) { last = events[events.length - 1]; if (last && last.pending === 0 && last.ids.length >= 5) { await sleep(3000); last = events[events.length - 1]; if (last.pending === 0) break; } await sleep(500); }
  console.log(`${ts()} 最終キュー:`, JSON.stringify(last));
  check('pending が残っていない', last && last.pending === 0);
  check('無効URLが除外され有効5曲が入っている', last && last.ids.length === 5, `ids=${last?.ids.join(',')}`);
  check('追加した順序が保たれている', last && JSON.stringify(last.ids) === JSON.stringify(EXPECT_IDS), `got=${last?.ids.join(',')}`);
  const versions = events.map(e => e.v);
  check('version が単調増加', versions.every((v, i) => i === 0 || v >= versions[i - 1]));
  const st = await (await fetch(`${API}/player-state/${GUILD}`)).json();
  check('/player-state も同じ内容', st.queue.map(x => vid(x.track.url)).join(',') === last.ids.join(','));
} finally {
  await post(`/disconnect-voice-channel/${GUILD}`); await sleep(800); ws.close();
}
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
