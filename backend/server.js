const express = require('express');
const db = require('./db');
 
const app = express();
const PORT = 3000;
 
app.use(express.json());
 
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});
 
// 사이트 목록 조회
app.get('/sites', (req, res) => {
  const sites = db.prepare('SELECT * FROM sites ORDER BY id DESC').all();
  res.json(sites);
});
 
// 사이트 추가
app.post('/sites', (req, res) => {
  const { name, url } = req.body;
  if (!name || !url) {
    return res.status(400).json({ error: 'name과 url이 필요합니다' });
  }
  try {
    const result = db
      .prepare('INSERT INTO sites (name, url) VALUES (?, ?)')
      .run(name, url);
    res.status(201).json({ id: result.lastInsertRowid, name, url });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: '이미 등록된 URL입니다' });
    }
    res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
});
 
// 사이트 수정
app.put('/sites/:id', (req, res) => {
  const { name, url } = req.body;
  if (!name || !url) {
    return res.status(400).json({ error: 'name과 url이 필요합니다' });
  }
  try {
    const result = db
      .prepare('UPDATE sites SET name = ?, url = ? WHERE id = ?')
      .run(name, url, req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: '사이트를 찾을 수 없습니다' });
    }
    res.json({ id: Number(req.params.id), name, url });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: '이미 등록된 URL입니다' });
    }
    res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
});
 
// 사이트 삭제
app.delete('/sites/:id', (req, res) => {
  const result = db.prepare('DELETE FROM sites WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: '사이트를 찾을 수 없습니다' });
  }
  res.status(204).end();
});
 
app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
});