// C++ 감지 엔진(engine/)을 주기적으로 돌려서 결과를 site_status 에 저장
//
// 엔진이 빌드되지 않은 PC 에서도 서버는 뜨도록, 엔진을 못 불러오면 경고만 찍고 모니터링을 끈다.
// (엔진 빌드: cd engine && npm install)
const { getAllSites, insertStatus, pruneStatus } = require('./db');

const INTERVAL_SEC = Number(process.env.MONITOR_INTERVAL_SEC) || 60;  // 검사 주기
const RETENTION_DAYS = Number(process.env.STATUS_RETENTION_DAYS) || 30; // 상태 기록 보관 기간
const ENABLED = process.env.MONITOR_ENABLED !== 'false';

let engine = null;
let monitor = null;

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
  // 장애일 때는 응답 시간이 의미가 없어서 null (그래프에서 빠짐)
  const responseTime = result.up && result.responseTime != null ? Math.round(result.responseTime) : null;
  try {
    insertStatus(result.siteId, result.status, responseTime, result.message || null);
  } catch (err) {
    // 검사 도중 사이트가 삭제되면 외래키 때문에 실패할 수 있음: 무시
    if (err.code !== 'SQLITE_CONSTRAINT_FOREIGNKEY') console.error('[monitor] 상태 저장 실패:', err.message);
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
  monitor.start(getAllSites, save, INTERVAL_SEC);

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

  console.log(`[monitor] 상태 검사 시작: ${INTERVAL_SEC}초 간격, 기록 ${RETENTION_DAYS}일 보관`);
}

// 사이트를 추가/수정한 직후 다음 주기를 기다리지 않고 바로 한 번 검사
function checkNow(site) {
  if (!monitor) return;
  monitor
    .check(site)
    .then(save)
    .catch((err) => console.error('[monitor] 즉시 검사 실패:', err.message));
}

// 사이트 삭제 / 주소 변경 시 그 사이트의 응답 시간 추정값을 버림
function forget(siteId) {
  if (monitor) monitor.forget(Number(siteId));
}

module.exports = { start, checkNow, forget, isRunning: () => monitor !== null };
