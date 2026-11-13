const express = require('express');
const { getAllSites, getSiteById, addSite, updateSite, deleteSite, visitSite, getRecentStatus } = require('./db');
const monitor = require('./monitor');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 1. 사이트 목록 조회
app.get('/sites', (req, res) => {
  const sites = getAllSites();
  res.json(sites);
});

// 2. 사이트 추가
app.post('/sites', (req, res) => {
  const { name, url } = req.body;
  if (!name || !url) {
    return res.status(400).json({ error: 'name과 url이 필요합니다' });
  }
  try {
    const result = addSite(name, url);
    const id = Number(result.lastInsertRowid);
    res.status(201).json({ id, name, url });
    monitor.checkNow({ id, url });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: '이미 등록된 URL입니다' });
    }
    res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
});

// 3. 사이트 수정
app.put('/sites/:id', (req, res) => {
  const { name, url } = req.body;
  if (!name || !url) {
    return res.status(400).json({ error: 'name과 url이 필요합니다' });
  }
  try {
    const result = updateSite(req.params.id, name, url);
    if (result.changes === 0) {
      return res.status(404).json({ error: '사이트를 찾을 수 없습니다' });
    }
    const id = Number(req.params.id);
    res.json({ id, name, url });
    // 주소가 바뀌었을 수 있으니 이전 응답 시간 추정값은 버리고 바로 다시 검사
    monitor.forget(id);
    monitor.checkNow({ id, url });
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: '이미 등록된 URL입니다' });
    }
    res.status(500).json({ error: '서버 오류가 발생했습니다' });
  }
});

// 4. 사이트 삭제
app.delete('/sites/:id', (req, res) => {
  const result = deleteSite(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: '사이트를 찾을 수 없습니다' });
  }
  monitor.forget(req.params.id);
  res.status(204).end();
});

app.post('/sites/:id/visit', (req, res) => {
  const result = visitSite(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: '사이트를 찾을 수 없습니다' });
  }
  res.json(getSiteById(req.params.id));
});

// 5. 서버 상태 기록 (C++ 엔진이 저장한 site_status)
// 응답: { "1": [{ site_id, status, response_time, message, checked_at }, ...], ... }
// 사이트마다 최근 limit 개, 오래된 것부터. 프론트 adapter.js 의 toHeartbeatMap() 형식
app.get('/heartbeats', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
  res.json(getRecentStatus(limit));
});

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
  monitor.start();
});