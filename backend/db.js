const Database = require('better-sqlite3');
const path = require('path');
const { encryptCredentials, decryptCredentials } = require('./autologin');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'sites.db');
const db = new Database(dbPath);

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

const siteColumns = db.prepare('PRAGMA table_info(sites)').all().map((c) => c.name);
if (!siteColumns.includes('type')) {
  db.exec("ALTER TABLE sites ADD COLUMN type TEXT NOT NULL DEFAULT 'http'");
}
if (!siteColumns.includes('port')) {
  db.exec('ALTER TABLE sites ADD COLUMN port INTEGER');
}
if (!siteColumns.includes('interval')) {
  db.exec('ALTER TABLE sites ADD COLUMN interval INTEGER NOT NULL DEFAULT 60');
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

const statusColumns = db.prepare('PRAGMA table_info(site_status)').all().map((c) => c.name);
if (!statusColumns.includes('message')) {
  db.exec('ALTER TABLE site_status ADD COLUMN message TEXT');
}
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

// 쿼리 템플릿
const LOGIN_COLUMNS = 'COALESCE(ss.auto_login, 0) AS auto_login, COALESCE(ss.logged_in, 0) AS logged_in, ss.login_credentials AS login_credentials';
const LOGIN_JOIN = 'LEFT JOIN site_sessions ss ON ss.site_id = s.id';

function withLogin(row) {
  if (!row) return row;
  const { auto_login, logged_in, login_credentials, ...site } = row;
  const creds = decryptCredentials(login_credentials);
  return {
    ...site,
    autoLogin: {
      enabled: auto_login === 1,
      loggedIn: logged_in === 1,
      hasCredentials: Boolean(creds?.username && creds?.password),
      username: creds?.username || '',
      loginUrl: creds?.loginUrl || '',
      userSelector: creds?.userSelector || '',
      passSelector: creds?.passSelector || '',
      submitSelector: creds?.submitSelector || '',
    },
  };
}

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
const getRawCredentialsStmt = db.prepare('SELECT login_credentials FROM site_sessions WHERE site_id = ?');

const addSiteStmt = db.prepare('INSERT INTO sites (name, url, type, port, interval) VALUES (?, ?, ?, ?, ?)');
const updateSiteStmt = db.prepare('UPDATE sites SET name = ?, url = ?, type = ?, port = ?, interval = ? WHERE id = ?');
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
const upsertSessionStmt = db.prepare(`
  INSERT INTO site_sessions (site_id, auto_login, login_credentials) VALUES (?, ?, ?)
  ON CONFLICT (site_id) DO UPDATE SET
    auto_login = excluded.auto_login,
    logged_in = CASE WHEN excluded.auto_login = 1 THEN site_sessions.logged_in ELSE 0 END,
    login_credentials = COALESCE(excluded.login_credentials, site_sessions.login_credentials)
`);
const loginSiteStmt = db.prepare(`
  UPDATE site_sessions SET logged_in = 1, logged_in_at = datetime('now')
  WHERE site_id = ? AND auto_login = 1
`);
const logoutSiteStmt = db.prepare(`
  UPDATE site_sessions SET logged_in = 0
  WHERE site_id = ? AND auto_login = 1
`);

function mergeCredentials(siteId, incoming) {
  if (!incoming) return null;
  const existingRow = siteId ? getRawCredentialsStmt.get(siteId) : null;
  const prev = decryptCredentials(existingRow?.login_credentials) || {};
  const next = {
    loginUrl: incoming.loginUrl ?? prev.loginUrl ?? '',
    username: incoming.username ?? prev.username ?? '',
    // 수정 시 비밀번호를 비워두면 기존 비밀번호 유지
    password: incoming.password ? incoming.password : (prev.password || ''),
    userSelector: incoming.userSelector ?? prev.userSelector ?? '',
    passSelector: incoming.passSelector ?? prev.passSelector ?? '',
    submitSelector: incoming.submitSelector ?? prev.submitSelector ?? '',
  };
  return encryptCredentials(next);
}

const addSiteTx = db.transaction((name, url, type, port, interval, autoLogin) => {
  const result = addSiteStmt.run(name, url, type, port, interval);
  const enabled = typeof autoLogin === 'object' ? Boolean(autoLogin.enabled) : Boolean(autoLogin);
  if (enabled) {
    const encrypted = typeof autoLogin === 'object' ? mergeCredentials(null, autoLogin) : null;
    upsertSessionStmt.run(result.lastInsertRowid, 1, encrypted);
  }
  return result;
});

const updateSiteTx = db.transaction((id, name, url, type, port, interval, autoLogin) => {
  const result = updateSiteStmt.run(name, url, type, port, interval, id);
  if (result.changes === 0) return result;
  if (autoLogin !== undefined) {
    const enabled = typeof autoLogin === 'object' ? Boolean(autoLogin.enabled) : Boolean(autoLogin);
    const encrypted = typeof autoLogin === 'object' ? mergeCredentials(id, autoLogin) : null;
    upsertSessionStmt.run(id, enabled ? 1 : 0, encrypted);
  }
  return result;
});

const insertStatusStmt = db.prepare(`
  INSERT INTO site_status (site_id, status, response_time, message)
  VALUES (?, ?, ?, ?)
`);

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

module.exports = {
  db,
  getAllSites: () => getAllSitesStmt.all().map(withLogin),
  getSiteById: (id) => withLogin(getSiteByIdStmt.get(id)),
  getSiteCredentials: (id) => {
    const row = getRawCredentialsStmt.get(id);
    return decryptCredentials(row?.login_credentials);
  },
  addSite: (name, url, type = 'http', port = null, interval = 60, autoLogin = false) =>
    addSiteTx(name, url, type, port, interval, autoLogin),
  updateSite: (id, name, url, type = 'http', port = null, interval = 60, autoLogin) =>
    updateSiteTx(id, name, url, type, port, interval, autoLogin),
  deleteSite: (id) => deleteSiteStmt.run(id),
  visitSite: (id) => visitSiteStmt.run(id),
  getStaleSites: (days) => getStaleSitesStmt.all(`-${days} days`).map(withLogin),
  loginSite: (siteId) => loginSiteStmt.run(siteId),
  logoutSite: (siteId) => logoutSiteStmt.run(siteId),
  insertStatus: (siteId, status, responseTime, message = null) =>
    insertStatusStmt.run(siteId, status, responseTime, message),
  getRecentStatus: (limit) => {
    const map = {};
    for (const row of getRecentStatusStmt.all(limit)) (map[row.site_id] ||= []).push(row);
    return map;
  },
  pruneStatus: (days) => pruneStatusStmt.run(`-${days} days`),
};