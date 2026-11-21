const express = require('express');
const path = require('path');
const fs = require('fs');
const {
  getAllSites, getSiteById, getSiteCredentials, addSite, updateSite, deleteSite, visitSite, getStaleSites,
  loginSite, logoutSite, getRecentStatus
} = require('./db');
const monitor = require('./monitor');
const cleanup = require('./cleanup');
const { performAutoLogin, closeAutoLogin } = require('./autologin');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json());

// 프론트엔드 빌드본이 /api/... 로 요청하는 경로를 기존 라우트(/sites, /heartbeats 등)로 연결
app.use((req, res, next) => {
  if (req.url === '/api' || req.url.startsWith('/api/')) {
    req.url = req.url.replace(/^\/api/, '') || '/';
  }
  next();
});

const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
}

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

function explicitPortFromUrl(url) {
  const parsed = parseUrl(url);
  return parsed && parsed.port ? Number(parsed.port) : null;
}

function defaultPortFromUrl(url) {
  const parsed = parseUrl(url);
  if (!parsed) return null;
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
    port = Number(body.port ?? explicitPortFromUrl(url) ?? current.port ?? defaultPortFromUrl(url));
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { error: 'tcp 방식은 1~65535 사이의 port가 필요합니다 (주소에 :포트를 붙이거나 port 값을 보내주세요)' };
    }
  }

  const rawInterval = body.interval ?? current.interval ?? 60;
  const interval = Number(rawInterval);
  if (!Number.isInteger(interval) || interval < 5 || interval > 86400) {
    return { error: 'interval(확인 주기)은 5~86400 사이의 정수(초)여야 합니다' };
  }

  let autoLogin = undefined;
  if (body.autoLogin && typeof body.autoLogin.enabled === 'boolean') {
    autoLogin = {
      enabled: type === 'http' && body.autoLogin.enabled,
      loginUrl: typeof body.autoLogin.loginUrl === 'string' ? body.autoLogin.loginUrl.trim() : '',
      username: typeof body.autoLogin.username === 'string' ? body.autoLogin.username.trim() : '',
      password: typeof body.autoLogin.password === 'string' ? body.autoLogin.password : '',
      userSelector: typeof body.autoLogin.userSelector === 'string' ? body.autoLogin.userSelector.trim() : '',
      passSelector: typeof body.autoLogin.passSelector === 'string' ? body.autoLogin.passSelector.trim() : '',
      submitSelector: typeof body.autoLogin.submitSelector === 'string' ? body.autoLogin.submitSelector.trim() : '',
    };
  }

  return { name, url, type, port, interval, autoLogin };
}

// 1. 사이트 목록 조회
app.get('/sites', (req, res) => {
  res.json(getAllSites());
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
  const result = addSite(fields.name, fields.url, fields.type, fields.port, fields.interval, fields.autoLogin || false);
  const id = Number(result.lastInsertRowid);
  const created = getSiteById(id);
  res.status(201).json(created);
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
  const result = updateSite(current.id, fields.name, fields.url, fields.type, fields.port, fields.interval, fields.autoLogin);
  if (result.changes === 0) {
    return res.status(404).json({ error: '사이트를 찾을 수 없습니다' });
  }
  if (fields.autoLogin && !fields.autoLogin.enabled) {
    closeAutoLogin(current.id);
  }
  res.json(getSiteById(current.id));
  monitor.forget(current.id);
  monitor.checkNow({ id: current.id, url: fields.url, type: fields.type, port: fields.port });
});

// 4. 사이트 삭제
app.delete('/sites/:id', async (req, res) => {
  const result = deleteSite(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: '사이트를 찾을 수 없습니다' });
  }
  monitor.forget(req.params.id);
  await closeAutoLogin(req.params.id);
  res.status(204).end();
});

app.post('/sites/:id/visit', (req, res) => {
  const result = visitSite(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: '사이트를 찾을 수 없습니다' });
  }
  res.json(getSiteById(req.params.id));
});

// 실제 웹페이지에 접속해 아이디/비밀번호를 자동 입력하는 로그인 라우트
app.post('/sites/:id/login', async (req, res) => {
  const site = getSiteById(req.params.id);
  if (!site) {
    return res.status(404).json({ error: '사이트를 찾을 수 없습니다' });
  }
  if (!site.autoLogin.enabled) {
    return res.status(400).json({ error: '자동 로그인이 켜져 있지 않은 사이트입니다' });
  }

  const credentials = getSiteCredentials(site.id);
  try {
    await performAutoLogin(site, credentials);
    loginSite(site.id);
    res.json(getSiteById(site.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/sites/:id/logout', async (req, res) => {
  const site = getSiteById(req.params.id);
  if (!site) {
    return res.status(404).json({ error: '사이트를 찾을 수 없습니다' });
  }
  if (!site.autoLogin.enabled) {
    return res.status(400).json({ error: '자동 로그인이 켜져 있지 않은 사이트입니다' });
  }
  await closeAutoLogin(site.id);
  logoutSite(site.id);
  res.json(getSiteById(site.id));
});

// 5. 서버 상태 기록
app.get('/heartbeats', (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
  res.json(getRecentStatus(limit));
});

if (fs.existsSync(frontendDist)) {
  app.get('*', (req, res, next) => {
    if (req.method !== 'GET') return next();
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

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