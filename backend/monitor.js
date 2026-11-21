// C++ 감지 엔진(engine/)을 사이트별 개별 주기(interval)에 맞춰 돌려서 결과를 site_status 에 저장
const { getAllSites, insertStatus, pruneStatus } = require('./db');

const DEFAULT_INTERVAL_SEC = Number(process.env.MONITOR_INTERVAL_SEC) || 60;
const RETENTION_DAYS = Number(process.env.STATUS_RETENTION_DAYS) || 30;
const ENABLED = process.env.MONITOR_ENABLED !== 'false';

let engine = null;
let monitor = null;
let schedulerTimer = null;

// 사이트별 마지막 검사 시각(ms) 및 중복 실행 방지 집합
const lastCheckedAt = new Map();
const inFlight = new Set();

function loadEngine() {
  try {
    return require('../engine');
  } catch (err) {
    console.warn('[monitor] C++ 엔진을 불러오지 못해서 상태 검사를 끕니다.');
    console.warn('[monitor] engine 폴더에서 npm install 로 빌드했는지 확인하세요:', err.message);
    return null;
  }
}

// 엔진 결과 1건 -> site_status 1행
function save(result) {
  const responseTime = result.up && result.responseTime != null ? Math.round(result.responseTime) : null;
  try {
    insertStatus(result.siteId, result.status, responseTime, result.message || null);
  } catch (err) {
    if (err.code !== 'SQLITE_CONSTRAINT_FOREIGNKEY') console.error('[monitor] 상태 저장 실패:', err.message);
  }
}

function runCheck(site) {
  if (!monitor || inFlight.has(site.id)) return;
  inFlight.add(site.id);
  lastCheckedAt.set(site.id, Date.now());

  monitor
    .check(site)
    .then(save)
    .catch((err) => console.error(`[monitor] 검사 실패 (id=${site.id}):`, err.message))
    .finally(() => {
      inFlight.delete(site.id);
    });
}

function tick() {
  let sites = [];
  try {
    sites = getAllSites();
  } catch (err) {
    console.error('[monitor] 사이트 목록 조회 실패:', err.message);
    return;
  }

  const now = Date.now();
  const activeIds = new Set();

  for (const site of sites) {
    activeIds.add(site.id);
    const intervalMs = Math.max(5, Number(site.interval) || DEFAULT_INTERVAL_SEC) * 1000;
    const prev = lastCheckedAt.get(site.id);

    // 서버 시작 후 첫 실행이거나, 설정된 interval 시간이 경과한 경우 검사 실행
    if (prev === undefined || now - prev >= intervalMs) {
      runCheck(site);
    }
  }

  // 삭제된 사이트의 타이머 기록 정리
  for (const id of lastCheckedAt.keys()) {
    if (!activeIds.has(id)) lastCheckedAt.delete(id);
  }
}

function start() {
  if (!ENABLED) {
    console.log('[monitor] MONITOR_ENABLED=false 라서 상태 검사를 하지 않습니다.');
    return;
  }
  engine = loadEngine();
  if (!engine) return;

  monitor = new engine.Monitor();

  // 1초마다 각 사이트의 개별 확인 주기(interval) 도달 여부 확인
  tick();
  schedulerTimer = setInterval(tick, 1000);

  // 오래된 기록 정리: 시작할 때 한 번, 이후 1시간마다
  const prune = () => {
    try {
      pruneStatus(RETENTION_DAYS);
    } catch (err) {
      console.error('[monitor] 오래된 기록 정리 실패:', err.message);
    }
  };
  prune();
  setInterval(prune, 3600 * 1000).unref();

  console.log(`[monitor] 사이트별 개별 주기 상태 검사 시작 (기본 ${DEFAULT_INTERVAL_SEC}초, 기록 ${RETENTION_DAYS}일 보관)`);
}

// 사이트를 추가/수정한 직후 다음 주기를 기다리지 않고 바로 한 번 검사
function checkNow(site) {
  runCheck(site);
}

// 사이트 삭제 / 주소 변경 시 그 사이트의 응답 시간 추정값 및 타이머 초기화
function forget(siteId) {
  const numId = Number(siteId);
  lastCheckedAt.delete(numId);
  if (monitor) monitor.forget(numId);
}

module.exports = { start, checkNow, forget, isRunning: () => monitor !== null };