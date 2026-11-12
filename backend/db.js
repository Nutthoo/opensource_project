const Database = require('better-sqlite3');
const path = require('path');

// database.sqlite / sites.db 생성 및 연결
const db = new Database(path.join(__dirname, 'sites.db'));

// 성능 및 외래키 제약조건 설정
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 1. 사이트 목록 테이블
db.exec(`
  CREATE TABLE IF NOT EXISTS sites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    visit_count INTEGER NOT NULL DEFAULT 0,
    last_visited_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

// 2. 서버 상태/응답속도 기록 테이블 
db.exec(`
  CREATE TABLE IF NOT EXISTS site_status (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    response_time INTEGER,
    checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (site_id) REFERENCES sites (id) ON DELETE CASCADE
  )
`);

// site_status.message: 장애 원인 표시용 (예: "404 Not Found", "응답 타임아웃", "인증서 검증 실패")
// 이미 만들어진 sites.db 에도 칸이 생기도록 없을 때만 추가
const statusColumns = db.prepare('PRAGMA table_info(site_status)').all().map((c) => c.name);
if (!statusColumns.includes('message')) {
  db.exec('ALTER TABLE site_status ADD COLUMN message TEXT');
}
// 사이트별 최근 기록 조회(/heartbeats)와 24시간 가동률 계산용
db.exec('CREATE INDEX IF NOT EXISTS idx_site_status_site ON site_status (site_id, id)');

// 3. 방문 이력 및 로그인 설정 테이블
db.exec(`
  CREATE TABLE IF NOT EXISTS site_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id INTEGER NOT NULL UNIQUE,
    last_visited_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    login_credentials TEXT,
    FOREIGN KEY (site_id) REFERENCES sites (id) ON DELETE CASCADE
  )
`);

//쿼리 템플릿
// uptime_24: 최근 24시간 동안 up 이었던 비율 (0~1, 기록이 없으면 null)
const getAllSitesStmt = db.prepare(`
  SELECT s.*,
    (SELECT AVG(st.status = 'up') FROM site_status st
      WHERE st.site_id = s.id AND st.checked_at >= datetime('now', '-1 day')) AS uptime_24
  FROM sites s
  ORDER BY s.id DESC
`);
const getSiteByIdStmt = db.prepare('SELECT * FROM sites WHERE id = ?');
const addSiteStmt = db.prepare('INSERT INTO sites (name, url) VALUES (?, ?)');
const updateSiteStmt = db.prepare('UPDATE sites SET name = ?, url = ? WHERE id = ?');
const deleteSiteStmt = db.prepare('DELETE FROM sites WHERE id = ?');

const insertStatusStmt = db.prepare(`
  INSERT INTO site_status (site_id, status, response_time, message)
  VALUES (?, ?, ?, ?)
`);

// 사이트마다 최근 limit 개 (오래된 것부터)
const getRecentStatusStmt = db.prepare(`
  SELECT site_id, status, response_time, message, checked_at FROM (
    SELECT site_id, status, response_time, message, checked_at, id,
      ROW_NUMBER() OVER (PARTITION BY site_id ORDER BY id DESC) AS rn
    FROM site_status
  )
  WHERE rn <= ?
  ORDER BY site_id, id
`);

const pruneStatusStmt = db.prepare(`
  DELETE FROM site_status WHERE checked_at < datetime('now', ?)
`);


//라우터 및 C++ 엔진 모듈 호출용
module.exports = {
  db,
  getAllSites: () => getAllSitesStmt.all(),
  getSiteById: (id) => getSiteByIdStmt.get(id),
  addSite: (name, url) => addSiteStmt.run(name, url),
  updateSite: (id, name, url) => updateSiteStmt.run(name, url, id),
  deleteSite: (id) => deleteSiteStmt.run(id),
  insertStatus: (siteId, status, responseTime, message = null) =>
    insertStatusStmt.run(siteId, status, responseTime, message),
  // { [siteId]: [ {site_id, status, response_time, message, checked_at}, ... ] }
  getRecentStatus: (limit) => {
    const map = {};
    for (const row of getRecentStatusStmt.all(limit)) (map[row.site_id] ||= []).push(row);
    return map;
  },
  // days 일보다 오래된 상태 기록 삭제 (기록이 계속 쌓여 DB 가 커지는 것 방지)
  pruneStatus: (days) => pruneStatusStmt.run(`-${days} days`)
};