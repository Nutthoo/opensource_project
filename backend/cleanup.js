const { getStaleSites, deleteSite } = require('./db');
const monitor = require('./monitor');

const DELETE_DAYS = Number(process.env.UNVISITED_DELETE_DAYS) || 0;

function run() {
  try {
    for (const site of getStaleSites(DELETE_DAYS)) {
      deleteSite(site.id);
      monitor.forget(site.id);
      console.log(`[cleanup] ${DELETE_DAYS}일 이상 미방문 사이트 삭제: ${site.name} (${site.url})`);
    }
  } catch (err) {
    console.error('[cleanup] 미방문 사이트 정리 실패:', err.message);
  }
}

function start() {
  if (DELETE_DAYS < 1) {
    console.log('[cleanup] UNVISITED_DELETE_DAYS 가 없거나 1보다 작아서 미방문 사이트 자동 삭제는 꺼져 있습니다.');
    return;
  }
  run();
  setInterval(run, 3600 * 1000).unref();
  console.log(`[cleanup] 미방문 사이트 자동 삭제 시작: ${DELETE_DAYS}일 이상 안 간 사이트를 1시간마다 정리`);
}

module.exports = { start, run };
