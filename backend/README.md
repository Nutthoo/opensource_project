# backend

Express + SQLite(better-sqlite3) 서버. 사이트 목록 API, 사이트 자동 로그인, C++ 감지 엔진(`../engine`)으로 사이트 상태를 주기적으로 검사해 저장하는 일을 합니다. 프론트 빌드(`../frontend/dist`)가 있으면 같이 제공합니다.

| 파일 | 하는 일 |
|---|---|
| `server.js` | Express 서버, API 라우트, 입력값 검사, 오류 응답 |
| `db.js` | SQLite 연결, 테이블/칸 준비, 쿼리 |
| `monitor.js` | 사이트별 `interval`에 맞춰 엔진으로 검사하고 결과를 `site_status`에 저장 |
| `cleanup.js` | 오래 방문하지 않은 사이트 자동 삭제(기본 꺼짐) |
| `autologin.js` | 계정 정보 암호화/복호화, Chrome/Edge를 열어 자동 로그인 |

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

- 엔진 빌드가 안 돼 있어도 서버는 뜹니다. 이때는 콘솔에 `[monitor] C++ 엔진을 불러오지 못해서 상태 검사를 끕니다`가 찍히고, 사이트 API만 동작합니다.
- 자동 로그인은 이 PC에 설치된 **Chrome 또는 Edge**를 사용합니다(`playwright-core`, 브라우저를 따로 내려받지 않음). 둘 다 없으면 로그인 요청이 400으로 실패합니다.
- 프론트를 개발할 때는 `frontend`의 Vite 개발 서버가 `/api`를 이 서버로 넘겨 줍니다. 배포용으로 `frontend/dist`를 빌드해 두면 이 서버가 화면까지 같이 제공합니다.
- 데스크톱 앱(루트 `main.js`)은 이 서버를 직접 실행하면서 사용 가능한 포트를 `PORT`로, 사용자 데이터 폴더의 `sites.db`를 `DB_PATH`로 넘겨 줍니다.

## 환경 변수

| 이름 | 기본값 | 설명 |
|---|---|---|
| `PORT` | 3000 | 서버 포트 |
| `MONITOR_INTERVAL_SEC` | 60 | 사이트에 `interval` 값이 없을 때만 쓰는 기본 검사 주기(초). 보통은 사이트별 `interval`을 씀 |
| `STATUS_RETENTION_DAYS` | 30 | 상태 기록 보관 기간(일). 지난 기록은 1시간마다 삭제 |
| `MONITOR_ENABLED` | true | `false`면 상태 검사를 하지 않음 |
| `UNVISITED_DELETE_DAYS` | 0 (꺼짐) | 1 이상이면 그 일수 넘게 방문하지 않은 사이트를 1시간마다 자동 삭제. 기본은 꺼져 있음 |
| `DB_PATH` | `backend/sites.db` | DB 파일 위치 (테스트용, 데스크톱 앱은 사용자 데이터 폴더) |

## API

프론트 빌드는 `/api/...`로 요청하며, 서버가 앞의 `/api`를 떼고 아래 경로로 처리합니다. 그래서 `/sites`와 `/api/sites`는 같은 API입니다.

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/health` | 서버 확인 |
| GET | `/sites` | 사이트 목록. `interval`, `autoLogin`, `uptime_24`(최근 24시간 동안 up 비율 0~1, 기록 없으면 `null`) 포함 |
| GET | `/sites/unvisited?days=30` | 미방문 사이트 후보 목록(삭제는 안 함). 마지막 방문일(없으면 등록일)이 `days`일(1~3650, 기본 30)보다 오래된 사이트를 오래된 순으로 반환. 형식은 `/sites`와 같고, 잘못된 `days`는 400 |
| POST | `/sites` | 사이트 추가 `{ name, url, type?, port?, interval?, autoLogin? }`. 추가 직후 바로 한 번 검사. 응답은 저장된 사이트 전체. 각 값의 규칙은 아래 |
| PUT | `/sites/:id` | 사이트 수정(같은 형식). `type`/`port`/`interval`/`autoLogin`을 안 보내면 기존 값 유지. 수정 직후 바로 다시 검사 |
| DELETE | `/sites/:id` | 사이트 삭제. 상태 기록과 로그인 정보도 같이 삭제됨(`ON DELETE CASCADE`). 그 사이트의 로그인 창이 열려 있으면 닫힘 |
| POST | `/sites/:id/visit` | 사이트 방문 기록: `visit_count` +1, `last_visited_at` 갱신. 응답은 갱신된 사이트 전체. 없는 id면 404 |
| POST | `/sites/:id/login` | 원격 로그인: PC의 Chrome/Edge를 열어 저장된 계정으로 로그인하고 `loggedIn`을 `true`로 기록. 응답은 사이트 전체. 자동 로그인이 꺼진 사이트와 로그인 실패는 400, 없는 id는 404. 동작은 아래 "자동 로그인" 참고 |
| POST | `/sites/:id/logout` | 원격 로그아웃: 열려 있는 로그인 창을 닫고 `loggedIn`을 `false`로 기록. 응답과 오류 규칙은 login과 같음(로그인 실패 제외) |
| GET | `/heartbeats?limit=100` | 사이트별 최근 상태 기록 (아래) |

`name`, `url` 규칙 (추가/수정 공통, 어기면 400):

- 둘 다 문자열이어야 하고, 앞뒤 공백은 지우고 저장함. `name`은 100자, `url`은 2048자 이하
- 주소로 읽을 수 있어야 함. `type`이 `http`면 `http://` 또는 `https://`로 시작해야 하고, `ping`/`tcp`는 `example.com`처럼 스킴 없이도 됨

`type`, `port` 규칙:

- `type`: `http`(기본값) / `ping` / `tcp`. 프론트 사이트 추가 창이 보내는 `port`는 `tcp`로 바꿔서 저장함. 그 외 값은 400
- `tcp`는 포트가 필요함. 포트는 요청의 `port` → 주소에 적힌 `:포트`(`tcp://example.com:3306` → 3306) → 이미 저장된 포트(수정할 때) → http 80 / https 443 순서로 정함. 1~65535가 아니거나 못 찾으면 400
- `http`, `ping`은 `port`를 무시하고 `null`로 저장함

`interval` 규칙 (확인 주기):

- 초 단위 정수, 5~86400. 벗어나면 400
- POST에서 안 보내면 60, PUT에서 안 보내면 기존 값 유지

`autoLogin` 규칙 (모든 사이트 응답에 들어감):

```json
"autoLogin": {
  "enabled": true,
  "loggedIn": false,
  "hasCredentials": true,
  "username": "myid",
  "loginUrl": "https://example.com/login",
  "userSelector": "",
  "passSelector": "",
  "submitSelector": ""
}
```

- 요청에서는 `autoLogin: { enabled, loginUrl?, username?, password?, userSelector?, passSelector?, submitSelector? }`로 보냄. `enabled`가 불리언이 아니면 무시하고 기존 값을 유지함
- `enabled`: 자동 로그인 사용 여부. **`type`이 `http`인 사이트만** 켤 수 있고, 다른 방식이면 `false`로 저장됨. `false`로 끄면 로그인 상태도 같이 해제되고 열려 있던 로그인 창이 닫힘
- `loginUrl`: 로그인 페이지 주소. 비우면 사이트 주소로 접속함
- `userSelector`, `passSelector`, `submitSelector`: 아이디 칸, 비밀번호 칸, 로그인 버튼의 CSS 선택자. 비우면 흔한 형태를 자동으로 찾음
- `password`는 **응답에 실리지 않음**. 저장돼 있는지는 `hasCredentials`로만 알 수 있음. 수정할 때 `password`를 비워 보내면 기존 비밀번호를 유지함
- `loggedIn`: 서버가 기록하는 로그인 상태. `POST /sites/:id/login`, `/logout`으로 바뀌고, 자동 로그인을 끄면 `false`가 됨

오류 응답 (모두 `{ "error": "메시지" }` 형식):

| 코드 | 언제 |
|---|---|
| 400 | 입력값이 잘못됨(위 규칙), 요청 본문이 올바른 JSON이 아님, 자동 로그인이 꺼진 사이트에 login/logout, 로그인 실패(계정 정보 없음, Chrome/Edge 없음 등) |
| 404 | 없는 사이트 id |
| 409 | 이미 등록된 URL (`sites.url`이 UNIQUE). 수정할 때도 같고, 이때 다른 값도 바뀌지 않음 |
| 413 | 요청 본문이 너무 큼 |
| 503 | DB가 바쁨(`SQLITE_BUSY`/`SQLITE_LOCKED`). 잠시 후 다시 시도 |
| 500 | 그 외 서버 오류. 원인은 서버 콘솔에 `[server] 처리 중 오류`로 찍힘 |

사이트 추가/수정은 사이트 저장과 `autoLogin` 저장을 하나의 트랜잭션으로 묶어서, 중간에 실패하면 둘 다 취소됩니다(반쯤 저장되지 않음).

`frontend/dist`가 있으면 위 API에 해당하지 않는 GET 요청은 `index.html`로 응답합니다(화면 이동용).

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

## 상태 검사 주기

- 사이트마다 `interval`(초)이 저장되고, `monitor.js`가 1초마다 각 사이트의 마지막 검사 시각을 보고 `interval`이 지난 사이트만 검사합니다(최소 5초). 같은 사이트의 검사가 끝나기 전에는 겹쳐서 검사하지 않습니다.
- 사이트를 추가하거나 수정하면 주기를 기다리지 않고 바로 한 번 검사합니다.
- 검사 결과 저장은 `monitor.js`의 `save()` 한 곳에서만 합니다. 저장 형식을 바꿀 때는 여기만 고치면 됩니다.

## 자동 로그인

- 사이트 추가/수정 때 보낸 계정 정보는 **암호화(AES-256-CBC)** 해서 `site_sessions.login_credentials`에 저장합니다. 암호화 키는 Windows 사용자 이름과 컴퓨터 이름으로 만들어서, 같은 PC·같은 계정에서만 복호화됩니다. DB 파일을 다른 PC로 옮기면 저장된 계정 정보를 읽지 못합니다. 이 PC에서 파일이 그대로 읽히지 않게 하는 정도의 보호이고, 강한 비밀 보관은 아닙니다.
- `POST /sites/:id/login`을 부르면 서버가 Chrome/Edge 창을 화면에 열어 로그인 페이지에서 아이디와 비밀번호를 입력하고 로그인 버튼을 누릅니다. 화면에 로그인 칸이 없으면 "로그인" 링크를 찾아 눌러 봅니다.
- **2차 인증, 캡차, 보안 확인은 자동으로 넘지 않습니다.** 사용자가 열린 창에서 직접 진행합니다.
- 로그인 칸이 화면에 나타날 때까지 기다리는 제한 시간이 없어서, 칸이 나타나지 않으면 이 요청은 계속 대기할 수 있습니다. 브라우저를 닫으면 대기가 끝납니다.
- 로그아웃은 열려 있던 로그인 창을 닫는 방식입니다. 사이트에서 실제로 로그아웃하는 것은 아닙니다.
- `loggedIn`은 서버가 기록하는 값이라, 사용자가 로그인 창을 직접 닫아도 자동으로 `false`가 되지 않습니다. 로그인 창을 닫아 입력이 끝나지 못한 경우에도 현재는 `true`로 기록됩니다.

## 유의할 점

- **DB 구조 변경**: `site_status`에 `message` 칸과 인덱스(`idx_site_status_site`)를 추가했습니다. `sites`에는 `type`(확인 방식, 기본 `http`), `port`(TCP 포트, 없으면 `null`), `interval`(확인 주기 초, 기본 60) 칸을 추가했습니다. `site_sessions`에는 `auto_login`(자동 로그인 사용 여부 0/1), `logged_in`(로그인 상태 0/1), `logged_in_at`(마지막 로그인 시각) 칸을 추가했고, 처음부터 있던 `login_credentials` 칸에 암호화된 계정 정보를 저장합니다. 서버를 켜면 기존 `sites.db`에도 없는 칸만 자동으로 추가되므로 DB를 지울 필요는 없습니다.
- **`sites.db`, `sites.db-shm`, `sites.db-wal`은 커밋하지 않습니다.** WAL 모드라 `-shm`, `-wal` 파일이 같이 생기는데, 예전에 커밋돼 있던 것을 `.gitignore`에 넣고 저장소에서 뺐습니다.
- **`getAllSites()` 결과에 `type`, `port`가 그대로 실려서** 엔진이 그 방식(HTTP/ping/TCP)으로 검사합니다(`engine/index.js`의 `toTarget()`).
- **`better-sqlite3`는 `~12.9.0`으로 고정했습니다.** 13 버전은 Node 22 이상 전용이라 팀 스택(Node 20)에서 설치가 안 되고, 12.10 이후는 Node 20용 미리 빌드된 파일이 없어서 Visual Studio로 직접 컴파일하려다 실패합니다.
- **실시간 전송(Socket.IO)은 아직 없습니다.** 프론트는 `VITE_USE_SOCKET=false`일 때 5초마다 사이트 목록과 `/heartbeats`를 다시 불러옵니다.
- **미방문 사이트 자동 삭제는 기본으로 꺼져 있습니다.** 사이트가 말없이 사라지지 않도록 `UNVISITED_DELETE_DAYS`를 정해야만 동작합니다(`cleanup.js`). 데스크톱 앱은 이 값을 따로 넣어 주지 않으므로 PC 환경 변수로 지정하지 않으면 꺼진 채로 동작합니다. 기준은 `sites.last_visited_at`이고, 한 번도 안 갔으면 `created_at`을 씁니다. 삭제할 때 그 사이트의 상태 기록도 같이 지워지고 콘솔에 삭제한 사이트 이름이 찍힙니다. 프론트의 "미방문 사이트 삭제 화면"은 `GET /sites/unvisited`로 후보를 받아 `DELETE /sites/:id`로 지우면 됩니다.
