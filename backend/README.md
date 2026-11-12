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
| `DB_PATH` | `backend/sites.db` | DB 파일 위치 (테스트용) |

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/health` | 서버 확인 |
| GET | `/sites` | 사이트 목록. `uptime_24`(최근 24시간 동안 up 비율 0~1, 기록 없으면 `null`) 포함 |
| POST | `/sites` | 사이트 추가 `{ name, url }`. 추가 직후 바로 한 번 검사 |
| PUT | `/sites/:id` | 사이트 수정 `{ name, url }`. 수정 직후 바로 다시 검사 |
| DELETE | `/sites/:id` | 사이트 삭제. 상태 기록도 같이 삭제됨(`ON DELETE CASCADE`) |
| GET | `/heartbeats?limit=100` | 사이트별 최근 상태 기록 (아래) |

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

- **DB 구조 변경**: `site_status`에 `message` 칸과 인덱스(`idx_site_status_site`)를 추가했습니다. 서버를 켜면 기존 `sites.db`에도 자동으로 추가되므로 DB를 지울 필요는 없습니다.
- **`sites.db`, `sites.db-shm`, `sites.db-wal`은 커밋하지 않습니다.** WAL 모드라 `-shm`, `-wal` 파일이 같이 생기는데, 예전에 커밋돼 있던 것을 `.gitignore`에 넣고 저장소에서 뺐습니다.
- **사이트별 검사 주기와 확인 방식은 아직 저장되지 않습니다.** `sites` 테이블에 칸이 없어서, 프론트 사이트 추가 창의 "상태확인방식", "확인주기" 값은 무시되고 모든 사이트를 HTTP(S)로 `MONITOR_INTERVAL_SEC` 간격에 같이 검사합니다. `sites`에 `type`(http/tcp/ping), `port` 칸이 생기면 `getAllSites()` 결과에 그대로 실려서 엔진이 알아서 그 방식으로 검사합니다(`engine/index.js`의 `toTarget()`).
- **`better-sqlite3`는 `~12.9.0`으로 고정했습니다.** 13 버전은 Node 22 이상 전용이라 팀 스택(Node 20)에서 설치가 안 되고, 12.10 이후는 Node 20용 미리 빌드된 파일이 없어서 Visual Studio로 직접 컴파일하려다 실패합니다.
- **실시간 전송(Socket.IO)은 아직 없습니다.** 프론트는 `VITE_USE_SOCKET=false`일 때 30초마다 `/heartbeats`를 다시 불러옵니다.
- 검사 결과 저장은 `monitor.js`의 `save()` 한 곳에서만 합니다. 저장 형식을 바꿀 때는 여기만 고치면 됩니다.
