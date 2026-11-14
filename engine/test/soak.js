// 장시간 실행 테스트: node test/soak.js [분, 기본 3] [간격초, 기본 5]
// 같은 사이트들을 계속 검사하면서 메모리, 열린 핸들 수, 실패 수가 늘지 않는지 본다.
const engine = require('..');

const minutes = Number(process.argv[2]) || 3;
const intervalSec = Number(process.argv[3]) || 5;

const urls = [
  'https://www.google.com', 'https://github.com', 'https://www.naver.com', 'https://www.daum.net',
  'https://www.youtube.com', 'https://www.coupang.com', 'https://www.acmicpc.net', 'https://velog.io',
  'http://example.com', 'https://no-such-host.invalid/',
];
const sites = urls.map((url, i) => ({ id: i + 1, url }));
const monitor = new engine.Monitor();

const mb = (n) => (n / 1024 / 1024).toFixed(1);
const start = Date.now();
let rounds = 0;
let firstRss = 0;

function report(results, roundMs) {
  const up = results.filter((r) => r.up).length;
  const mem = process.memoryUsage();
  const handles = process._getActiveHandles().length;
  if (!firstRss) firstRss = mem.rss;
  const avg = results.filter((r) => r.up).reduce((s, r) => s + r.responseTime, 0) / Math.max(up, 1);
  console.log(
    `#${String(rounds).padStart(3)}  ${String(roundMs).padStart(5)}ms  up ${up}/${results.length}  평균 ${avg.toFixed(0)}ms  ` +
      `rss ${mb(mem.rss)}MB  heap ${mb(mem.heapUsed)}MB  handles ${handles}`,
  );
}

(async () => {
  console.log(`${minutes}분 동안 ${intervalSec}초 간격, 사이트 ${sites.length}개\n`);
  while (Date.now() - start < minutes * 60000) {
    const t0 = Date.now();
    const results = await monitor.checkAll(sites);
    rounds++;
    report(results, Date.now() - t0);
    for (const r of results.filter((x) => Date.now() - t0 > intervalSec * 1000 && !x.up)) {
      console.log(`      느린 라운드: site ${r.siteId} ${r.message}`);
    }
    await new Promise((r) => setTimeout(r, Math.max(0, intervalSec * 1000 - (Date.now() - t0))));
  }
  const last = process.memoryUsage().rss;
  console.log(`\n${rounds}회 검사, rss ${mb(firstRss)}MB -> ${mb(last)}MB`);
  console.log('추정 timeout(ms):', sites.map((s) => Math.round(monitor.estimatorFor(s.id).timeoutMs)).join(', '));
})();
