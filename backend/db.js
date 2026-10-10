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
const getAllSitesStmt = db.prepare('SELECT * FROM sites ORDER BY id DESC');
const getSiteByIdStmt = db.prepare('SELECT * FROM sites WHERE id = ?');
const addSiteStmt = db.prepare('INSERT INTO sites (name, url) VALUES (?, ?)');
const updateSiteStmt = db.prepare('UPDATE sites SET name = ?, url = ? WHERE id = ?');
const deleteSiteStmt = db.prepare('DELETE FROM sites WHERE id = ?');

const insertStatusStmt = db.prepare(`
  INSERT INTO site_status (site_id, status, response_time)
  VALUES (?, ?, ?)
`);


//라우터 및 C++ 엔진 모듈 호출용
module.exports = {
  db,
  getAllSites: () => getAllSitesStmt.all(),
  getSiteById: (id) => getSiteByIdStmt.get(id),
  addSite: (name, url) => addSiteStmt.run(name, url),
  updateSite: (id, name, url) => updateSiteStmt.run(name, url, id),
  deleteSite: (id) => deleteSiteStmt.run(id),
  insertStatus: (siteId, status, responseTime) => insertStatusStmt.run(siteId, status, responseTime)
};