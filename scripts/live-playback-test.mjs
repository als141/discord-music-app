#!/usr/bin/env node
/**
 * 本番 API を使った実再生テスト（テストサーバー限定）
 *   bot を VC に入れ、曲を追加→一時停止→再開→スキップ→切断 を REST で操作しながら、
 *   同じギルドの WebSocket で状態更新がリアルタイムに届くかを検証する。
 *
 * usage: node scripts/live-playback-test.mjs [guildId] [channelId]
 * 既定: テストサーバー(1080511818658762752) / VC 一般(1080511819103346828)
 * 注意: 実際に Discord の VC に bot が入って音を出す。人がいるサーバーでは実行しないこと。
 */
const API = process.env.API_BASE || 'https://api.atoriba.jp';
const GUILD = process.argv[2] || '1080511818658762752';
const CHANNEL = process.argv[3] || '1080511819103346828';
const SONG = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const SONG2 = 'https://music.youtube.com/watch?v=by4SYYWlhEs';

const t0 = Date.now();
const ts = () => ((Date.now() - t0) / 1000).toFixed(1).padStart(6) + 's';
const events = [];
let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? '  (' + extra + ')' : ''}`); };
const post = (p) => fetch(`${API}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' } });
const postJson = (p, body) => fetch(`${API}${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const summarize = (d) => {
  const cur = (d.queue || []).find(q => q.isCurrent)?.track?.title ?? null;
  return { v: d.version, epoch: (d.epoch || '').slice(0, 6), playing: d.is_playing, current: cur, queue: (d.queue || []).filter(q => !q.isCurrent).length, has_player: d.has_player };
};
const waitFor = async (pred, timeoutMs, label) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const last = events[events.length - 1];
    if (last && pred(last)) return last;
    await sleep(250);
  }
  return null;
};

// --- 事前チェック: bot が既にどこかの VC にいる（＝誰かが使っている）場合は中止 ---
const status = await (await fetch(`${API}/bot-voice-status/${GUILD}`)).json();
if (status.channel_id) { console.log('bot は既に VC に接続中のため中止:', status); process.exit(2); }

// --- WebSocket 観測 ---
const ws = new WebSocket(`${API.replace(/^http/, 'ws')}/ws/${GUILD}`);
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.type === 'update') { const s = summarize(m.data); events.push(s); console.log(`${ts()} WS update`, JSON.stringify(s)); }
  else console.log(`${ts()} WS ${m.type}`);
};
ws.onclose = (e) => console.log(`${ts()} WS closed ${e.code}`);
await new Promise(r => ws.onopen = r);
await sleep(800);
check('WS 初期状態を受信', events.length >= 1, JSON.stringify(events[0]));

try {
  // 1) VC 参加
  let r = await post(`/join-voice-channel/${GUILD}/${CHANNEL}`);
  console.log(`${ts()} join → ${r.status}`, (await r.text()).slice(0, 120));
  check('join-voice-channel 200', r.status === 200);
  const joined = await waitFor(e => e.has_player === true, 15000);
  check('WS: プレイヤー作成が届く（has_player=true）', !!joined, JSON.stringify(joined));

  // 2) 曲追加 → 再生開始
  r = await postJson(`/add-url/${GUILD}`, { url: SONG, user: { id: '0', name: 'live-test', image: '' } });
  console.log(`${ts()} add-url → ${r.status}`);
  const playing = await waitFor(e => e.playing === true && e.current, 60000);
  check('WS: 再生開始が届く（is_playing=true, current あり）', !!playing, JSON.stringify(playing));

  // 3) 2曲目追加 → キュー1
  r = await postJson(`/add-url/${GUILD}`, { url: SONG2, user: { id: '0', name: 'live-test', image: '' } });
  const queued = await waitFor(e => e.queue >= 1, 60000);
  check('WS: キュー追加が届く（queue=1）', !!queued, JSON.stringify(queued));

  // 4) 一時停止 / 再開
  r = await post(`/pause/${GUILD}`); console.log(`${ts()} pause → ${r.status}`);
  const paused = await waitFor(e => e.playing === false && e.current, 10000);
  check('WS: 一時停止が届く（is_playing=false）', !!paused, JSON.stringify(paused));
  r = await post(`/resume/${GUILD}`); console.log(`${ts()} resume → ${r.status}`);
  const resumed = await waitFor(e => e.playing === true, 10000);
  check('WS: 再開が届く（is_playing=true）', !!resumed, JSON.stringify(resumed));

  // 5) スキップ → 2曲目へ
  const before = events[events.length - 1]?.current;
  r = await post(`/skip/${GUILD}`); console.log(`${ts()} skip → ${r.status}`);
  const skipped = await waitFor(e => e.current && e.current !== before && e.queue === 0, 60000);
  check('WS: スキップ後に2曲目が current になる', !!skipped, JSON.stringify(skipped));

  // 6) REST /player-state が WS と一致
  const st = await (await fetch(`${API}/player-state/${GUILD}`)).json();
  const last = events[events.length - 1];
  check('/player-state が WS の最新と一致（version/epoch）', st.version === last.v && (st.epoch || '').slice(0, 6) === last.epoch, `rest v=${st.version} ws v=${last.v}`);
  // version は単調増加
  const versions = events.map(e => e.v);
  check('version が単調増加', versions.every((v, i) => i === 0 || v >= versions[i - 1]), versions.join(','));
} finally {
  // 7) 切断
  const r = await post(`/disconnect-voice-channel/${GUILD}`); console.log(`${ts()} disconnect → ${r.status}`);
  const gone = await waitFor(e => e.has_player === false, 15000);
  check('WS: 切断後 has_player=false が届く', !!gone, JSON.stringify(gone));
  await sleep(500);
  ws.close();
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
