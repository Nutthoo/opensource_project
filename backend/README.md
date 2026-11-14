# backend

Express + SQLite(better-sqlite3) 서버. 사이트 목록 API와, C++ 감지 엔진(`../engine`)으로 사이트 상태를 주기적으로 검사해 저장하는 일을 합니다.

## 실행

엔진을 먼저 빌드해야 상태 검사가 동작합니다. (한 번만, C++ 코드가 바뀌었을 때 다시)

```bash
cd engine
npm install          # Windows는 Visual Studio "C++를 사용한 데스크톱 개발" 필요. 첫 빌드 1~2분

cd ../backend
npm install
npm start            # http://localhost:3000
npm test             # 엔진 연동 테스트 (임시 DB 사용, 실제 sites.db 는 안 건드림)
```

엔진 빌드가 안 돼 있어도 서버는 뜹니다. 이때는 콘솔에 `[monitor] C++ 엔진을 불러오지 못해서 상태 검사를 끕니다`가 찍히고, 사이트 API만 동작합니다.

## 환경 변수

| 이름 | 기본값 | 설명 |
|---|---|---|
| `PORT` | 3000 | 서버 포트 |
| `MONITOR_INTERVAL_SEC` | 60 | 상태 검사 주기(초) |
| `STATUS_RETENTION_DAYS` | 30 | 상태 기록 보관 기간(일). 지난 기록은 1시간마다 삭제 |
| `MONITOR_ENABLED` | true | `false`면 상태 검사를 하지 않음 |
| `UNVISITED_DELETE_DAYS` | 0 (꺼짐) | 1 이상이면 그 일수 넘게 방문하지 않은 사이트를 1시간마다 자동 삭제. 기본은 꺼져 있음 |
| `DB_PATH` | `backend/sites.db` | DB 파일 위치 (테스트용) |

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/health` | 서버 확인 |
| GET | `/sites` | 사이트 목록. `uptime_24`(최근 24시간 동안 up 비율 0~1, 기록 없으면 `null`) 포함 |
| GET | `/sites/unvisited?days=30` | 미방문 사이트 후보 목록(삭제는 안 함). 마지막 방문일(없으면 등록일)이 `days`일(1~3650, 기본 30)보다 오래된 사이트를 오래된 순으로 반환. 형식은 `/sites`와 같고, 잘못된 `days`는 400 |
| POST | `/sites` | 사이트 추가 `{ name, url, type?, port?, autoLogin?: { enabled } }`. 추가 직후 바로 한 번 검사. 응답은 저장된 사이트 전체(`type`, `port`, `visit_count`, `autoLogin` 포함). `type`/`port`/`autoLogin` 규칙은 아래 |
| PUT | `/sites/:id` | 사이트 수정 `{ name, url, type?, port?, autoLogin?: { enabled } }`. `type`/`port`/`autoLogin`을 안 보내면 기존 값 유지. 수정 직후 바로 다시 검사 |
| DELETE | `/sites/:id` | 사이트 삭제. 상태 기록도 같이 삭제됨(`ON DELETE CASCADE`) |
| POST | `/sites/:id/visit` | 사이트 방문 기록: `visit_count` +1, `last_visited_at` 갱신. 응답은 갱신된 사이트 전체. 없는 id면 404 |
| POST | `/sites/:id/login` | 원격 로그인(데모): 로그인 상태를 `true`로 바꿈. 응답은 사이트 전체(`autoLogin: { enabled, loggedIn }`). 자동 로그인이 꺼진 사이트는 400, 없는 id는 404 |
| POST | `/sites/:id/logout` | 원격 로그아웃(데모): 로그인 상태를 `false`로 바꿈. 응답과 오류 규칙은 login과 같음 |
| GET | `/heartbeats?limit=100` | 사이트별 최근 상태 기록 (아래) |

`name`, `url` 규칙 (추가/수정 공통, 어기면 400):

- 둘 다 문자열이어야 하고, 앞뒤 공백은 지우고 저장함. `name`은 100자, `url`은 2048자 이하
- 주소로 읽을 수 있어야 함. `type`이 `http`면 `http://` 또는 `https://`로 시작해야 하고, `ping`/`tcp`는 `example.com`처럼 스킴 없이도 됨

`type`, `port` 규칙:

- `type`: `http`(기본값) / `ping` / `tcp`. 프론트 사이트 추가 창이 보내는 `port`는 `tcp`로 바꿔서 저장함. 그 외 값은 400
- `tcp`는 포트가 필요함. `port`를 보내면 그 값, 안 보내면 주소에서 읽음(`tcp://example.com:3306` → 3306, `:포트`가 없으면 http 80 / https 443). 1~65535가 아니거나 못 찾으면 400
- `http`, `ping`은 `port`를 무시하고 `null`로 저장함

`autoLogin` 규칙 (모든 사이트 응답에 `autoLogin: { "enabled": false, "loggedIn": false }` 형식으로 들어감):

- `enabled`: 자동 로그인 사용 여부. 사이트 추가/수정 때 `autoLogin: { enabled: true/false }`로 정함. 안 보내면 기존 값 유지(처음엔 `false`). `false`로 끄면 로그인 상태도 같이 해제됨
- `loggedIn`: 현재 로그인 상태. `POST /sites/:id/login`, `/logout`으로만 바뀜. `enabled`가 `false`인 사이트에는 400

오류 응답 (모두 `{ "error": "메시지" }` 형식):

| 코드 | 언제 |
|---|---|
| 400 | 입력값이 잘못됨(위 규칙), 요청 본문이 올바른 JSON이 아님, 자동 로그인이 꺼진 사이트에 login/logout |
| 404 | 없는 사이트 id |
| 409 | 이미 등록된 URL (`sites.url`이 UNIQUE). 수정할 때도 같고, 이때 다른 값도 바뀌지 않음 |
| 413 | 요청 본문이 너무 큼 |
| 503 | DB가 바쁨(`SQLITE_BUSY`/`SQLITE_LOCKED`). 잠시 후 다시 시도 |
| 500 | 그 외 서버 오류. 원인은 서버 콘솔에 `[server] 처리 중 오류`로 찍힘 |

사이트 추가/수정은 사이트 저장과 `autoLogin` 저장을 하나의 트랜잭션으로 묶어서, 중간에 실패하면 둘 다 취소됩니다(반쯤 저장되지 않음).

`/heartbeats` 응답 (사이트마다 최근 `limit`개, 오래된 것부터, `limit` 최대 1000):

```json
{
  "1": [
    { "site_id": 1, "status": "up", "response_time": 212, "message": "200 OK", "checked_at": "2026-11-12 08:30:00" }
  ],
  "2": [
    { "site_id": 2, "status": "down", "response_time": null, "message": "404 Not Found", "checked_at": "2026-11-12 08:30:00" }
  ]
}
```

- `status`: `up` / `down`. 판정 기준은 `engine/README.md`의 "up / down 판정 기준" 참고
- `response_time`: ms. `down`이면 `null`
- `message`: 장애 원인 등 (예: `404 Not Found`, `응답 타임아웃 (status line 없음)`, `인증서 검증 실패: ...`, `403 Forbidden (접근 제한, 서버는 응답 중)`)
- `checked_at`: SQLite `CURRENT_TIMESTAMP`라 **UTC**이고 `Z`가 없음. 프론트 `adapter.js`의 `toISO()`가 변환함

## 유의할 점

- **DB 구조 변경**: `site_status`에 `message` 칸과 인덱스(`idx_site_status_site`)를 추가했습니다. `sites`에는 `type`(확인 방식, 기본 `http`)과 `port`(TCP 포트, 없으면 `null`) 칸을 추가했습니다(`db.js`에 변경 주석 표시). `site_sessions`에는 `auto_login`(자동 로그인 사용 여부 0/1), `logged_in`(로그인 상태 0/1), `logged_in_at`(마지막 로그인 시각) 칸을 추가했습니다(`db.js`에 변경 주석 표시). 서버를 켜면 기존 `sites.db`에도 자동으로 추가되므로 DB를 지울 필요는 없습니다.
- **`sites.db`, `sites.db-shm`, `sites.db-wal`은 커밋하지 않습니다.** WAL 모드라 `-shm`, `-wal` 파일이 같이 생기는데, 예전에 커밋돼 있던 것을 `.gitignore`에 넣고 저장소에서 뺐습니다.
- **사이트별 확인 방식(`type`, `port`)은 저장되고, 검사 주기는 아직 저장되지 않습니다.** `getAllSites()` 결과에 `type`, `port`가 그대로 실려서 엔진이 그 방식(HTTP/ping/TCP)으로 검사합니다(`engine/index.js`의 `toTarget()`). 프론트 사이트 추가 창의 "확인주기" 값은 아직 무시되고 모든 사이트를 `MONITOR_INTERVAL_SEC` 간격에 같이 검사합니다. 프론트 `PUT` 요청은 지금 `name`, `url`만 보내므로 수정해도 `type`/`port`는 유지됩니다.
- **`better-sqlite3`는 `~12.9.0`으로 고정했습니다.** 13 버전은 Node 22 이상 전용이라 팀 스택(Node 20)에서 설치가 안 되고, 12.10 이후는 Node 20용 미리 빌드된 파일이 없어서 Visual Studio로 직접 컴파일하려다 실패합니다.
- **실시간 전송(Socket.IO)은 아직 없습니다.** 프론트는 `VITE_USE_SOCKET=false`일 때 30초마다 `/heartbeats`를 다시 불러옵니다.
- **미방문 사이트 자동 삭제는 기본으로 꺼져 있습니다.** 사이트가 말없이 사라지지 않도록 `UNVISITED_DELETE_DAYS`를 정해야만 동작합니다(`cleanup.js`). 기준은 `sites.last_visited_at`이고, 한 번도 안 갔으면 `created_at`을 씁니다. 삭제할 때 그 사이트의 상태 기록도 같이 지워지고 콘솔에 삭제한 사이트 이름이 찍힙니다. 프론트의 "미방문 사이트 삭제 화면"은 `GET /sites/unvisited`로 후보를 받아 `DELETE /sites/:id`로 지우면 됩니다.
- **원격 로그인은 로그인 상태만 바꾸는 데모입니다.** 실제 사이트에 로그인하지 않고, 계정 정보는 저장하지도 응답에 싣지도 않습니다(`site_sessions.login_credentials` 칸은 쓰지 않음). 사이트를 삭제하면 로그인 정보도 같이 삭제됩니다(`ON DELETE CASCADE`). 프론트의 "자동 로그인" 버튼은 `autoLogin.enabled`가 `true`인 사이트에만 보이고, 누르면 `login`/`logout`을 부릅니다.
- 검사 결과 저장은 `monitor.js`의 `save()` 한 곳에서만 합니다. 저장 형식을 바꿀 때는 여기만 고치면 됩니다.
