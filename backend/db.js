const Database = require('better-sqlite3');
const path = require('path');

// database.sqlite / sites.db 생성 및 연결
// DB_PATH: 테스트할 때 실제 sites.db 를 건드리지 않도록 다른 파일을 쓸 수 있게 함
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'sites.db'));

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

// [DB 구조 변경] sites 테이블에 type(확인 방식: http/ping/tcp), port(TCP 포트 번호) 칸 추가 - backend(JeongSeungjin0), 2026-11-13
const siteColumns = db.prepare('PRAGMA table_info(sites)').all().map((c) => c.name);
if (!siteColumns.includes('type')) {
  db.exec("ALTER TABLE sites ADD COLUMN type TEXT NOT NULL DEFAULT 'http'");
}
if (!siteColumns.includes('port')) {
  db.exec('ALTER TABLE sites ADD COLUMN port INTEGER');
}

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

// [DB 구조 변경] site_sessions 테이블에 auto_login(자동 로그인 사용 여부 0/1), logged_in(현재 로그인 상태 0/1), logged_in_at(마지막 로그인 시각) 칸 추가 - backend(JeongSeungjin0), 2026-11-13
const sessionColumns = db.prepare('PRAGMA table_info(site_sessions)').all().map((c) => c.name);
if (!sessionColumns.includes('auto_login')) {
  db.exec('ALTER TABLE site_sessions ADD COLUMN auto_login INTEGER NOT NULL DEFAULT 0');
}
if (!sessionColumns.includes('logged_in')) {
  db.exec('ALTER TABLE site_sessions ADD COLUMN logged_in INTEGER NOT NULL DEFAULT 0');
}
if (!sessionColumns.includes('logged_in_at')) {
  db.exec('ALTER TABLE site_sessions ADD COLUMN logged_in_at TEXT');
}

//쿼리 템플릿
const LOGIN_COLUMNS = 'COALESCE(ss.auto_login, 0) AS auto_login, COALESCE(ss.logged_in, 0) AS logged_in';
const LOGIN_JOIN = 'LEFT JOIN site_sessions ss ON ss.site_id = s.id';

function withLogin(row) {
  if (!row) return row;
  const { auto_login, logged_in, ...site } = row;
  return { ...site, autoLogin: { enabled: auto_login === 1, loggedIn: logged_in === 1 } };
}

// uptime_24: 최근 24시간 동안 up 이었던 비율 (0~1, 기록이 없으면 null)
const getAllSitesStmt = db.prepare(`
  SELECT s.*, ${LOGIN_COLUMNS},
    (SELECT AVG(st.status = 'up') FROM site_status st
      WHERE st.site_id = s.id AND st.checked_at >= datetime('now', '-1 day')) AS uptime_24
  FROM sites s
  ${LOGIN_JOIN}
  ORDER BY s.id DESC
`);
const getSiteByIdStmt = db.prepare(`
  SELECT s.*, ${LOGIN_COLUMNS}
  FROM sites s
  ${LOGIN_JOIN}
  WHERE s.id = ?
`);
const addSiteStmt = db.prepare('INSERT INTO sites (name, url, type, port) VALUES (?, ?, ?, ?)');
const updateSiteStmt = db.prepare('UPDATE sites SET name = ?, url = ?, type = ?, port = ? WHERE id = ?');
const deleteSiteStmt = db.prepare('DELETE FROM sites WHERE id = ?');
const visitSiteStmt = db.prepare(`
  UPDATE sites
  SET visit_count = visit_count + 1, last_visited_at = datetime('now')
  WHERE id = ?
`);
const getStaleSitesStmt = db.prepare(`
  SELECT s.*, ${LOGIN_COLUMNS},
    (SELECT AVG(st.status = 'up') FROM site_status st
      WHERE st.site_id = s.id AND st.checked_at >= datetime('now', '-1 day')) AS uptime_24
  FROM sites s
  ${LOGIN_JOIN}
  WHERE COALESCE(s.last_visited_at, s.created_at) < datetime('now', ?)
  ORDER BY COALESCE(s.last_visited_at, s.created_at)
`);
const setAutoLoginStmt = db.prepare(`
  INSERT INTO site_sessions (site_id, auto_login) VALUES (?, ?)
  ON CONFLICT (site_id) DO UPDATE SET
    auto_login = excluded.auto_login,
    logged_in = CASE WHEN excluded.auto_login = 1 THEN site_sessions.logged_in ELSE 0 END
`);
const loginSiteStmt = db.prepare(`
  UPDATE site_sessions SET logged_in = 1, logged_in_at = datetime('now')
  WHERE site_id = ? AND auto_login = 1
`);
const logoutSiteStmt = db.prepare(`
  UPDATE site_sessions SET logged_in = 0
  WHERE site_id = ? AND auto_login = 1
`);

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
  getAllSites: () => getAllSitesStmt.all().map(withLogin),
  getSiteById: (id) => withLogin(getSiteByIdStmt.get(id)),
  addSite: (name, url, type = 'http', port = null) => addSiteStmt.run(name, url, type, port),
  updateSite: (id, name, url, type = 'http', port = null) => updateSiteStmt.run(name, url, type, port, id),
  deleteSite: (id) => deleteSiteStmt.run(id),
  visitSite: (id) => visitSiteStmt.run(id),
  getStaleSites: (days) => getStaleSitesStmt.all(`-${days} days`).map(withLogin),
  setAutoLogin: (siteId, enabled) => setAutoLoginStmt.run(siteId, enabled ? 1 : 0),
  loginSite: (siteId) => loginSiteStmt.run(siteId),
  logoutSite: (siteId) => logoutSiteStmt.run(siteId),
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