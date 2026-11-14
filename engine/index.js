// 모니터링 엔진 연결부: backend 에서 const engine = require('../engine');
const path = require('path');
const native = require('./build/Release/monitor_engine.node');

// HTTPS 인증서 검증용 Mozilla CA 목록 (curl.se/ca/cacert.pem)
native.setCaBundle(path.join(__dirname, 'deps', 'cacert', 'cacert.pem'));

const DEFAULTS = {
  minTimeoutMs: 1000,
  maxTimeoutMs: 10000,
  attempts: 2,      // proj1 traceroute 의 PROBE_ATTEMPT_COUNT 처럼, 한 번 놓쳤다고 바로 DOWN 처리하지 않음
  concurrency: 16,
};

// 사이트 정보 -> C++ Target
// site: { id, url, type?: 'http'|'tcp'|'ping', host?, port?, ignoreTls? }
function toTarget(site, timeoutMs) {
  const type = site.type === 'tcp' || site.type === 'ping' ? site.type : 'http';
  let host = site.host;
  if (!host && site.url) {
    try {
      host = new URL(/^[a-z]+:\/\//i.test(site.url) ? site.url : `http://${site.url}`).hostname;
    } catch {
      host = site.url;
    }
  }
  return {
    type,
    url: site.url || '',
    host: host || '',
    port: Number(site.port) || 0,
    timeoutMs: Math.round(timeoutMs),
    ignoreTls: Boolean(site.ignoreTls),
  };
}

// 응답을 받은 경우(성공, 4xx/5xx, RST)만 RTT 표본으로 쓴다. 타임아웃은 RTT 를 모르니 제외.
function isValidSample(r) {
  return r.responseTime != null && !r.timedOut && (r.up || r.statusCode != null || r.refused);
}

class Monitor {
  constructor(options = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.estimators = new Map();
    this.timer = null;
    this.running = false;
  }

  estimatorFor(siteId) {
    let est = this.estimators.get(siteId);
    if (!est) {
      est = new native.RttEstimator({
        minTimeoutMs: this.options.minTimeoutMs,
        maxTimeoutMs: this.options.maxTimeoutMs,
      });
      this.estimators.set(siteId, est);
    }
    return est;
  }

  forget(siteId) {
    this.estimators.delete(siteId);
  }

  // 여러 사이트를 C++ 쪽 스레드로 한꺼번에 검사.
  // 1차: 사이트별 추정 timeout (srtt + 4*rttvar) 으로 빠르게 감지
  // 2차: 타임아웃난 것만 maxTimeout 으로 재시도 (일시적 지연을 DOWN 으로 오판하지 않게)
  async checkAll(sites) {
    const { attempts, maxTimeoutMs, concurrency } = this.options;
    const results = new Array(sites.length);
    const timeouts = sites.map((s) => this.estimatorFor(s.id).timeoutMs);
    let pending = sites.map((_, i) => i);

    for (let attempt = 1; attempt <= attempts && pending.length; attempt++) {
      const targets = pending.map((i) => toTarget(sites[i], attempt === 1 ? timeouts[i] : maxTimeoutMs));
      const out = await native.checkMany(targets, concurrency);

      const retry = [];
      out.forEach((r, k) => {
        const i = pending[k];
        results[i] = { ...r, attempts: attempt, timeoutMs: targets[k].timeoutMs };
        if (r.timedOut && attempt < attempts) retry.push(i);
      });
      pending = retry;
    }

    const checkedAt = new Date().toISOString();
    return results.map((r, i) => {
      const est = this.estimatorFor(sites[i].id);
      if (isValidSample(r)) est.update(r.responseTime);
      return { siteId: sites[i].id, ...r, estimator: est.toJSON(), checkedAt };
    });
  }

  async check(site) {
    const [r] = await this.checkAll([site]);
    return r;
  }

  // getSites(): 사이트 배열 (동기/비동기 모두 가능), onResult(result): 결과 1건마다 호출
  start(getSites, onResult, intervalSec = 60) {
    this.stop();
    const tick = async () => {
      if (this.running) return;  // 이전 검사가 아직 안 끝났으면 겹치지 않게 건너뜀
      this.running = true;
      try {
        const sites = await getSites();
        const results = await this.checkAll(sites);
        for (const r of results) await onResult(r);
      } catch (err) {
        console.error('[engine] 모니터링 실패:', err);
      } finally {
        this.running = false;
      }
    };
    tick();
    this.timer = setInterval(tick, intervalSec * 1000);
    return () => this.stop();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = {
  checkHttp: native.checkHttp,
  checkTcp: native.checkTcp,
  ping: native.ping,
  checkMany: native.checkMany,
  RttEstimator: native.RttEstimator,
  Monitor,
};
