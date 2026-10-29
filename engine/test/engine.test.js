// node test/engine.test.js  (외부 네트워크 테스트는 ENGINE_ONLINE=1 일 때만)
const assert = require('assert');
const http = require('http');
const net = require('net');
const engine = require('..');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function startServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/ok') return res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    if (req.url === '/moved') return res.writeHead(301, { Location: '/ok' }).end();
    if (req.url === '/error') return res.writeHead(500).end();
    if (req.url.startsWith('/slow')) {
      const ms = Number(new URL(req.url, 'http://x').searchParams.get('ms')) || 500;
      return setTimeout(() => res.writeHead(200).end('slow'), ms);
    }
    res.writeHead(404).end();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function closedPort() {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

let server, base;

test('HTTP 200 -> up, status code 와 시간 분해', async () => {
  const r = await engine.checkHttp(`${base}/ok`, 3000);
  assert.strictEqual(r.up, true);
  assert.strictEqual(r.status, 'up');
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.statusText, 'OK');
  assert.strictEqual(r.method, 'http');
  for (const k of ['dnsMs', 'connectMs', 'ttfbMs', 'responseTime']) assert.ok(r[k] >= 0, k);
});

test('HTTP 301 -> up, Location 헤더', async () => {
  const r = await engine.checkHttp(`${base}/moved`, 3000);
  assert.strictEqual(r.statusCode, 301);
  assert.strictEqual(r.up, true);
  assert.strictEqual(r.location, '/ok');
});

test('HTTP 404 / 500 -> down', async () => {
  const a = await engine.checkHttp(`${base}/nope`, 3000);
  const b = await engine.checkHttp(`${base}/error`, 3000);
  assert.deepStrictEqual([a.statusCode, a.up, b.statusCode, b.up], [404, false, 500, false]);
});

test('응답 지연 > timeout -> timedOut, down', async () => {
  const r = await engine.checkHttp(`${base}/slow?ms=1500`, 300);
  assert.strictEqual(r.up, false);
  assert.strictEqual(r.timedOut, true);
  assert.ok(r.responseTime < 1000, `responseTime ${r.responseTime}`);
});

test('닫힌 포트 -> RST (refused), down', async () => {
  const port = await closedPort();
  const r = await engine.checkTcp('127.0.0.1', port, 3000);
  assert.strictEqual(r.up, false);
  assert.strictEqual(r.refused, true);
  assert.strictEqual(r.timedOut, false);
});

test('TCP handshake 성공 -> up', async () => {
  const r = await engine.checkTcp('127.0.0.1', server.address().port, 3000);
  assert.strictEqual(r.up, true);
  assert.ok(r.connectMs >= 0);
});

test('DNS 실패 -> down', async () => {
  const r = await engine.checkHttp('http://no-such-host.invalid/', 3000);
  assert.strictEqual(r.up, false);
  assert.match(r.message, /DNS/);
});

test('잘못된 URL / 인자', async () => {
  const r = await engine.checkHttp('ftp://example.com', 1000);
  assert.strictEqual(r.up, false);
  assert.throws(() => engine.checkHttp(123), TypeError);
});

test('ping localhost (ICMP 또는 권한 없으면 tcp-fallback)', async () => {
  const r = await engine.ping('127.0.0.1', 2000);
  assert.ok(['icmp', 'tcp-fallback'].includes(r.method), r.method);
  if (r.method === 'icmp') assert.strictEqual(r.up, true);
  console.log(`      method=${r.method} up=${r.up} rttMs=${r.rttMs} ${r.message}`);
});

test('checkMany: 느린 서버 8개를 동시에 검사', async () => {
  const targets = Array.from({ length: 8 }, () => ({ type: 'http', url: `${base}/slow?ms=400`, timeoutMs: 3000 }));
  const t0 = Date.now();
  const out = await engine.checkMany(targets, 16);
  const elapsed = Date.now() - t0;
  assert.strictEqual(out.length, 8);
  assert.ok(out.every((r) => r.up));
  assert.ok(elapsed < 1500, `순차였다면 3200ms, 실제 ${elapsed}ms`);
  console.log(`      8 x 400ms -> ${elapsed}ms`);
});

test('RttEstimator: EWMA (alpha=1/8, beta=1/4, k=4)', () => {
  const est = new engine.RttEstimator({ minTimeoutMs: 0, maxTimeoutMs: 100000 });
  assert.strictEqual(est.timeoutMs, 100000);  // 표본 없으면 max
  est.update(100);
  assert.deepStrictEqual([est.srtt, est.rttvar, est.timeoutMs], [100, 50, 300]);
  est.update(200);
  // rttvar = 0.75*50 + 0.25*|100-200| = 62.5, srtt = 0.875*100 + 0.125*200 = 112.5
  assert.deepStrictEqual([est.srtt, est.rttvar, est.timeoutMs], [112.5, 62.5, 362.5]);
  const clamped = new engine.RttEstimator({ minTimeoutMs: 1000, maxTimeoutMs: 5000 });
  clamped.update(10);
  assert.strictEqual(clamped.timeoutMs, 1000);
});

test('Monitor: 추정 timeout 으로 1차 검사, 타임아웃이면 maxTimeout 으로 재시도', async () => {
  const mon = new engine.Monitor({ minTimeoutMs: 200, maxTimeoutMs: 2000, attempts: 2 });
  const site = { id: 1, url: `${base}/ok` };
  for (let i = 0; i < 5; i++) await mon.check(site);
  const est = mon.estimatorFor(1);
  assert.strictEqual(est.samples, 5);
  assert.strictEqual(est.timeoutMs, 200);  // 로컬은 RTT 가 아주 작아 min 으로 clamp

  // 평소보다 느려짐: 1차(200ms) 타임아웃 -> 2차(2000ms)에서 성공 -> DOWN 오판 없음
  const slow = await mon.check({ id: 1, url: `${base}/slow?ms=600` });
  assert.strictEqual(slow.up, true);
  assert.strictEqual(slow.attempts, 2);
  assert.strictEqual(slow.timeoutMs, 2000);
  assert.strictEqual(slow.siteId, 1);
});

test('Monitor.start: 주기 검사 결과를 콜백으로 전달', async () => {
  const mon = new engine.Monitor();
  const got = await new Promise((resolve) => {
    mon.start(() => [{ id: 7, url: `${base}/ok` }, { id: 8, url: `${base}/error` }], (r) => {
      if (r.siteId === 8) resolve(r);
    }, 60);
  });
  mon.stop();
  assert.strictEqual(got.status, 'down');
  assert.strictEqual(got.statusCode, 500);
});

if (process.env.ENGINE_ONLINE) {
  test('[online] http://example.com', async () => {
    const r = await engine.checkHttp('http://example.com', 5000);
    console.log(`      ${r.statusCode} dns=${r.dnsMs} connect=${r.connectMs} ttfb=${r.ttfbMs} total=${r.responseTime}`);
    assert.strictEqual(r.up, true);
  });
  test('[online] HTTPS: TLS handshake + status code + 인증서', async () => {
    const urls = ['https://github.com', 'https://www.naver.com', 'https://example.com'];
    const out = await engine.checkMany(urls.map((url) => ({ type: 'http', url, timeoutMs: 8000 })));
    out.forEach((r, i) => {
      console.log(`      ${urls[i]} ${r.statusCode} ${r.tls.version} tls=${r.tlsMs}ms 인증서 ${r.tls.daysLeft}일 남음`);
      assert.strictEqual(r.method, 'https');
      assert.strictEqual(r.up, true, `${urls[i]}: ${r.message}`);
      assert.strictEqual(r.tls.certValid, true);
      assert.ok(r.tlsMs > 0 && r.statusCode >= 200);
    });
  });
  test('[online] 잘못된 인증서 -> down (만료 / 호스트 불일치 / 자체 서명)', async () => {
    const bad = ['https://expired.badssl.com/', 'https://wrong.host.badssl.com/', 'https://self-signed.badssl.com/'];
    const out = await engine.checkMany(bad.map((url) => ({ type: 'http', url, timeoutMs: 20000 })));
    out.forEach((r, i) => {
      assert.strictEqual(r.up, false, bad[i]);
      assert.strictEqual(r.tls.certValid, false);
      assert.match(r.message, /인증서 검증 실패/);
    });
    assert.ok(out[0].tls.daysLeft < 0);
  });
  test('[online] ignoreTls: 인증서 오류여도 응답 오면 up', async () => {
    const r = await engine.checkHttp('https://expired.badssl.com/', 20000, { ignoreTls: true });
    assert.strictEqual(r.up, true);
    assert.strictEqual(r.statusCode, 200);
    assert.match(r.message, /인증서 오류 무시/);
  });
  test('[online] 응답 없는 IP -> SYN 타임아웃', async () => {
    const r = await engine.checkTcp('10.255.255.1', 80, 800);
    assert.strictEqual(r.timedOut, true);
  });
}

(async () => {
  server = await startServer();
  base = `http://127.0.0.1:${server.address().port}`;
  let failed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      console.log(`  ✓ ${t.name}`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${t.name}\n      ${e.message}`);
    }
  }
  server.close();
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
