const Database = require('better-sqlite3');
const path = require('path');
 
const db = new Database(path.join(__dirname, 'sites.db'));
 
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
 
module.exports = db;