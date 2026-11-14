// 백엔드 + C++ 엔진 연동 테스트: npm test
// 임시 DB 와 로컬 테스트 서버만 쓰므로 실제 sites.db 와 인터넷 연결은 필요 없음.
// (engine 폴더에서 npm install 로 엔진을 먼저 빌드해야 함)
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const dbPath = path.join(os.tmpdir(), `sites-test-${process.pid}.db`);
const PORT = 3900 + (process.pid % 100);
const api = (p, opts) => fetch(`http://127.0.0.1:${PORT}${p}`, opts);
const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 감시 대상: /ok... 는 200, 나머지(/gone)는 404
const target = http.createServer((req, res) => res.writeHead(req.url.startsWith('/ok') ? 200 : 404).end());

async function waitFor(fn, ms = 10000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await sleep(200);
  }
  throw new Error('시간 초과');
}

(async () => {
  await new Promise((r) => target.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${target.address().port}`;

  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: dbPath, MONITOR_INTERVAL_SEC: '2' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => (log += d));
  server.stderr.on('data', (d) => (log += d));

  let failed = false;
  try {
    await waitFor(() => api('/health').then((r) => r.ok));
    assert.match(log, /상태 검사 시작/, '엔진이 안 불러와짐:\n' + log);

    // 사이트 추가 -> 바로 검사되어 heartbeat 가 생김
    const ok = await (await api('/sites', json({ name: 'ok', url: `${base}/ok` }))).json();
    const gone = await (await api('/sites', json({ name: 'gone', url: `${base}/gone` }))).json();
    const beats = await waitFor(async () => {
      const b = await (await api('/heartbeats?limit=10')).json();
      return b[ok.id] && b[gone.id] ? b : null;
    });
    const a = beats[ok.id].at(-1);
    const b = beats[gone.id].at(-1);
    assert.strictEqual(a.status, 'up');
    assert.ok(a.response_time >= 0);
    assert.match(a.message, /200/);
    assert.strictEqual(b.status, 'down');
    assert.strictEqual(b.response_time, null);
    assert.match(b.message, /404/);
    assert.ok(a.checked_at);
    console.log('  ✓ 사이트 추가 직후 검사, /heartbeats 형식');

    // 주기 검사로 기록이 쌓이고, limit 이 지켜짐
    await waitFor(async () => {
      const b2 = await (await api('/heartbeats?limit=2')).json();
      return b2[ok.id].length === 2 ? b2 : null;
    });
    console.log('  ✓ 주기 검사 (2초) 와 limit');

    // /sites 에 24시간 가동률
    const sites = await (await api('/sites')).json();
    assert.strictEqual(sites.find((s) => s.id === ok.id).uptime_24, 1);
    assert.strictEqual(sites.find((s) => s.id === gone.id).uptime_24, 0);
    console.log('  ✓ /sites uptime_24');

    // 주소 수정 -> 바로 다시 검사 (url 은 UNIQUE 라 ok 사이트와 다른 주소로)
    const put = await api(`/sites/${gone.id}`, { ...json({ name: 'gone', url: `${base}/ok2` }), method: 'PUT' });
    assert.strictEqual(put.status, 200);
    await waitFor(async () => {
      const b3 = await (await api('/heartbeats?limit=1')).json();
      return b3[gone.id][0].status === 'up';
    });
    console.log('  ✓ 주소 수정 후 재검사');

    // 삭제 -> 기록도 같이 삭제 (ON DELETE CASCADE)
    assert.strictEqual((await api(`/sites/${ok.id}`, { method: 'DELETE' })).status, 204);
    const b4 = await (await api('/heartbeats')).json();
    assert.strictEqual(b4[ok.id], undefined);
    console.log('  ✓ 삭제 시 기록 정리');
  } catch (e) {
    failed = true;
    console.log('  ✗', e.message);
    console.log(log);
  } finally {
    server.kill();
    target.close();
    await sleep(300);
    for (const f of [dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) fs.rmSync(f, { force: true });
  }
  console.log(failed ? '\n실패' : '\n전부 통과');
  process.exit(failed ? 1 : 0);
})();
