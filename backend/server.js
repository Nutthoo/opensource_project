const express = require('express');
const {
  getAllSites, getSiteById, addSite, updateSite, deleteSite, visitSite, getStaleSites,
  loginSite, logoutSite, getRecentStatus
} = require('./db');
const monitor = require('./monitor');
const cleanup = require('./cleanup');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

const SITE_TYPES = ['http', 'ping', 'tcp'];
const NAME_MAX = 100;
const URL_MAX = 2048;

function parseUrl(url) {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `http://${url}`);
  } catch {
    return null;
  }
}

function portFromUrl(url) {
  const parsed = parseUrl(url);
  if (!parsed) return null;
  if (parsed.port) return Number(parsed.port);
  if (parsed.protocol === 'https:') return 443;
  if (parsed.protocol === 'http:') return 80;
  return null;
}

function readSiteFields(body, current = {}) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!name || !url) {
    return { error: 'name과 url이 필요합니다 (문자열)' };
  }
  if (name.length > NAME_MAX) {
    return { error: `name은 ${NAME_MAX}자 이하여야 합니다` };
  }
  if (url.length > URL_MAX) {
    return { error: `url은 ${URL_MAX}자 이하여야 합니다` };
  }
  const parsed = parseUrl(url);
  if (!parsed || !parsed.hostname) {
    return { error: '올바른 주소 형식이 아닙니다' };
  }

  let type = body.type ?? current.type ?? 'http';
  if (type === 'port') type = 'tcp';
  if (!SITE_TYPES.includes(type)) {
    return { error: 'type은 http, ping, tcp(또는 port) 중 하나여야 합니다' };
  }
  if (type === 'http' && !/^https?:\/\//i.test(url)) {
    return { error: 'http 방식은 http:// 또는 https:// 로 시작하는 주소가 필요합니다' };
  }

  let port = null;
  if (type === 'tcp') {
    port = Number(body.port ?? portFromUrl(url) ?? current.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { error: 'tcp 방식은 1~65535 사이의 port가 필요합니다 (주소에 :포트를 붙이거나 port 값을 보내주세요)' };
    }
  }

  const autoLogin = typeof body.autoLogin?.enabled === 'boolean' ? body.autoLogin.enabled : undefined;

  return { name, url, type, port, autoLogin };
}

// 1. 사이트 목록 조회
app.get('/sites', (req, res) => {
  const sites = getAllSites();
  res.json(sites);
});

app.get('/sites/unvisited', (req, res) => {
  const days = req.query.days === undefined ? 30 : Number(req.query.days);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    return res.status(400).json({ error: 'days는 1~3650 사이의 정수여야 합니다' });
  }
  res.json(getStaleSites(days));
});

// 2. 사이트 추가
app.post('/sites', (req, res) => {
  const fields = readSiteFields(req.body);
  if (fields.error) {
    return res.status(400).json({ error: fields.error });
  }
  const result = addSite(fields.name, fields.url, fields.type, fields.port, fields.autoLogin === true);
  const id = Number(result.lastInsertRowid);
  res.status(201).json(getSiteById(id));
  monitor.checkNow({ id, url: fields.url, type: fields.type, port: fields.port });
});

// 3. 사이트 수정
app.put('/sites/:id', (req, res) => {
  const current = getSiteById(req.params.id);
  if (!current) {
    return res.status(404).json({ error: '사이트를 찾을 수 없습니다' });
  }
  const fields = readSiteFields(req.body, current);
  if (fields.error) {
    return res.status(400).json({ error: fields.error });
  }
  const result = updateSite(current.id, fields.name, fields.url, fields.type, fields.port, fields.autoLogin);
  if (result.changes === 0) {
    return res.status(404).json({ error: '사이트를 찾을 수 없습니다' });
  }
  res.json(getSiteById(current.id));
  // 주소가 바뀌었을 수 있으니 이전 응답 시간 추정값은 버리고 바로 다시 검사
  monitor.forget(current.id);
  monitor.checkNow({ id: current.id, url: fields.url, type: fields.type, port: fields.port });
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

function loginRoute(action) {
  return (req, res) => {
    const site = getSiteById(req.params.id);
    if (!site) {
      return res.status(404).json({ error: '사이트를 찾을 수 없습니다' });
    }
    if (!site.autoLogin.enabled) {
      return res.status(400).json({ error: '자동 로그인이 켜져 있지 않은 사이트입니다' });
    }
    action(site.id);
    res.json(getSiteById(site.id));
  };
}

app.post('/sites/:id/login', loginRoute(loginSite));
app.post('/sites/:id/logout', loginRoute(logoutSite));

// 5. 서버 상태 기록 (C++ 엔진이 저장한 site_status)
// 응답: { "1": [{ site_id, status, response_time, message, checked_at }, ...], ... }
// 사이트마다 최근 limit 개, 오래된 것부터. 프론트 adapter.js 의 toHeartbeatMap() 형식
app.get('/heartbeats', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
  res.json(getRecentStatus(limit));
});

app.use((err, req, res, next) => {
  if (res.headersSent) {
    console.error('[server] 응답을 보낸 뒤 오류:', err);
    return;
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '요청 본문이 올바른 JSON이 아닙니다' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: '요청 본문이 너무 큽니다' });
  }
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({ error: '이미 등록된 URL입니다' });
  }
  if (err.code === 'SQLITE_BUSY' || err.code === 'SQLITE_LOCKED') {
    return res.status(503).json({ error: '데이터베이스가 바쁩니다. 잠시 후 다시 시도해 주세요' });
  }
  console.error('[server] 처리 중 오류:', err);
  res.status(500).json({ error: '서버 오류가 발생했습니다' });
});

app.listen(PORT, () => {
  console.log(`서버 실행 중: http://localhost:${PORT}`);
  monitor.start();
  cleanup.start();
});
