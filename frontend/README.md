# Frontend

Vue 3 + Vite 기반 대시보드. 대시보드/카드/상태바 UI는 [Uptime Kuma](https://github.com/louislam/uptime-kuma)를 기반으로 함.

## 실행

```bash
npm install
cp .env.example .env
npm run dev
```

http://localhost:5173

| `.env` | 설명 |
|---|---|
| `VITE_USE_MOCK=true` | mock 데이터로 실행 |
| `VITE_USE_MOCK=false` | 백엔드(`localhost:3000`) 연결 |
| `VITE_USE_SOCKET=true` | Socket.IO 실시간 업데이트 사용 |

`.env` 변경 후에는 dev 서버 재시작 필요.

## 구조

```
src/
├─ api/
│  ├─ client.js          API 호출
│  ├─ adapter.js         응답 필드 변환
│  └─ mock.js            mock 데이터
├─ stores/
│  └─ monitorStore.js    전역 상태
├─ components/
│  ├─ Status.vue
│  ├─ Uptime.vue
│  ├─ HeartbeatBar.vue
│  ├─ MonitorList.vue
│  ├─ MonitorListItem.vue
│  └─ AddSiteDialog.vue
├─ pages/
│  └─ DashboardHome.vue
└─ assets/
```

## 백엔드 API

`backend` 브랜치 `server.js` 기준. 프론트는 `/api/...`로 호출하고 Vite proxy가 `/api`를 떼서 `localhost:3000`으로 전달함.

| 메서드 | 경로 | 상태 |
|---|---|---|
| GET | `/sites` | 구현됨 |
| POST | `/sites` | 구현됨 |
| PUT | `/sites/:id` | 구현됨 |
| DELETE | `/sites/:id` | 구현됨 |
| POST | `/sites/:id/visit` | 필요 (`visit_count + 1`, `last_visited_at` 갱신 후 사이트 반환) |
| GET | `/heartbeats?limit=100` | 필요 (`site_status` 행 배열) |
| POST | `/sites/:id/login` | 필요 |
| POST | `/sites/:id/logout` | 필요 |

- 사이트 응답은 `sites` 테이블 컬럼 그대로 사용 (`visit_count`, `last_visited_at` 등)
- 에러 응답은 `{ "error": "..." }`
- `site_status.status`: `0/DOWN`, `1/UP`, `2/PENDING`, `3/MAINTENANCE` (숫자, 문자 모두 가능)
- Socket.IO 사용 시 `heartbeat` 이벤트로 `site_status` 한 행 전송

## 출처

아래 파일은 Uptime Kuma(MIT License, Copyright (c) 2021 Louis Lam)의 코드를 가져와 수정함. 라이선스 전문은 `LICENSE-uptime-kuma`.

| 파일 | 원본 |
|---|---|
| `src/assets/vars.scss` | `src/assets/vars.scss` |
| `src/assets/app.scss` | `src/assets/app.scss` (일부) |
| `src/util.js` | `src/util.ts` (상태 상수) |
| `src/components/Status.vue` | `src/components/Status.vue` |
| `src/components/Uptime.vue` | `src/components/Uptime.vue` |
| `src/components/HeartbeatBar.vue` | `src/components/HeartbeatBar.vue` (1.23.X) |
| `src/components/MonitorList.vue` | `src/components/MonitorList.vue` |
| `src/components/MonitorListItem.vue` | `src/components/MonitorListItem.vue` |
| `src/pages/DashboardHome.vue` | `src/pages/DashboardHome.vue` |
