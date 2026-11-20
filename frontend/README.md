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
│  ├─ PingChart.vue      응답 속도 그래프 (목록에서 📈 버튼으로 펼침)
│  ├─ SiteDialog.vue     사이트 추가/수정 창
│  └─ CleanupDialog.vue  미방문 사이트 정리 창
├─ pages/
│  └─ DashboardHome.vue
└─ assets/
```

## 백엔드 API

`main` 브랜치 `backend/server.js` 기준 (자세한 내용은 `backend/README.md`). 프론트는 `/api/...`로 호출하고 Vite proxy가 `/api`를 떼서 `localhost:3000`으로 전달함.

| 메서드 | 경로 | 프론트에서 쓰는 곳 |
|---|---|---|
| GET | `/sites` | 사이트 목록 (처음 + 60초마다) |
| POST | `/sites` | 사이트 추가 |
| PUT | `/sites/:id` | 사이트 수정 (name, url, type, port, autoLogin 전체 전송) |
| DELETE | `/sites/:id` | 사이트 삭제 |
| POST | `/sites/:id/visit` | 사이트 클릭 시 방문 기록 (http 사이트만) |
| POST | `/sites/:id/login` | 원격 로그인 (자동 로그인이 켜진 사이트만) |
| POST | `/sites/:id/logout` | 원격 로그아웃 |
| GET | `/heartbeats?limit=100` | 상태바·최근 상태 변화 (처음 + 60초마다) |
| GET | `/sites/unvisited?days=30` | 미방문 사이트 정리 창 (골라서 `DELETE /sites/:id`) |

- 사이트 응답은 `sites` 테이블 컬럼 + `uptime_24`(0~1, 목록 조회에만 있음) + `autoLogin: { enabled, loggedIn }`
- 확인 방식 `type`: `http` / `ping` / `tcp`. TCP는 주소를 `tcp://호스트:포트`로 저장하고 `port`도 함께 보냄
- 확인 주기 `interval`은 백엔드가 아직 저장하지 않음 (모든 사이트 60초, `MONITOR_INTERVAL_SEC`)
- 에러 응답은 `{ "error": "..." }`
- `site_status.status`: `"up"` / `"down"` (프론트는 `0/DOWN`, `1/UP`, `2/PENDING`, `3/MAINTENANCE` 숫자로 변환)
- Socket.IO는 백엔드에 아직 없음. 사용 시 `heartbeat` 이벤트로 `site_status` 한 행 전송

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
| `src/components/PingChart.vue` | `src/components/PingChart.vue` (1.23.X) |
| `src/components/MonitorList.vue` | `src/components/MonitorList.vue` |
| `src/components/MonitorListItem.vue` | `src/components/MonitorListItem.vue` |
| `src/pages/DashboardHome.vue` | `src/pages/DashboardHome.vue` |
