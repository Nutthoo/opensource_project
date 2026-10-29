# monitor-engine (C++ 감지 엔진)

서버 상태 감지 · 반응 속도 측정을 C++17로 구현하고, node-addon-api(napi.h)로 빌드해서 `backend/`에서 `require()`로 호출하는 모듈입니다.

담당: 김재겸 (jaegyumee2): 서버 상태 감지, 서버 반응 속도 측정, 서버 감지 속도 최적화, 모니터링 엔진 연결

## 빌드

```bash
cd engine
npm install        # node-addon-api 설치 후 node-gyp rebuild 까지 자동 실행
npm test           # 로컬 테스트 (ENGINE_ONLINE=1 이면 외부 사이트까지)
```

- Node.js 20 LTS, C++17
- Windows: Visual Studio "C++를 사용한 데스크톱 개발" 워크로드가 필요합니다. VS 2026(18)은 node-gyp 12 이상이어야 인식되므로 devDependency를 `node-gyp@^12`로 고정했습니다(node-gyp 13은 Node 22 이상 전용).
- Linux/macOS: `g++`/`clang++`, `make`, `python3`

## 사용법 (backend)

```js
const engine = require('../engine');

// 단건 검사
const r = await engine.checkHttp('http://example.com', 5000);
// { up: true, status: 'up', method: 'http', statusCode: 200, responseTime: 92.95,
//   dnsMs: 9.64, connectMs: 35.23, ttfbMs: 47.82, ... }

await engine.checkTcp('db.example.com', 5432, 3000);
await engine.ping('8.8.8.8', 2000);

// 주기 모니터링 -> site_status 테이블에 기록
const monitor = new engine.Monitor({ maxTimeoutMs: 10000 });
monitor.start(
  () => db.prepare('SELECT id, url FROM sites').all(),
  (r) => db.prepare('INSERT INTO site_status (site_id, status, response_time) VALUES (?, ?, ?)')
           .run(r.siteId, r.status, r.responseTime == null ? null : Math.round(r.responseTime)),
  60,
);
```

`status`는 `'up'`/`'down'` 문자열이라 `site_status.status` 컬럼과 프론트 `adapter.js`의 `toStatus()`에 그대로 맞습니다.

### 결과 필드

| 필드 | 의미 |
|---|---|
| `up`, `status` | 감지 결과 (`'up'` / `'down'`) |
| `method` | `http`, `tcp`, `icmp`, `tcp-fallback` |
| `responseTime` | 대시보드에 표시할 응답 시간(ms). HTTP는 DNS+handshake+첫 바이트, ping은 RTT |
| `dnsMs` / `connectMs` / `ttfbMs` / `rttMs` | 단계별 시간 |
| `statusCode`, `statusText`, `location` | HTTP 응답 첫 줄, 3xx의 Location |
| `timedOut`, `refused` | 응답 없음 / RST(포트 닫힘) |
| `message` | 사람이 읽을 설명 |

`Monitor` 결과에는 `siteId`, `attempts`, `timeoutMs`, `estimator`, `checkedAt`이 추가로 붙습니다.

## CS168 근거

| 기능 | 구현 | 근거 |
|---|---|---|
| DNS 시간 | `getaddrinfo` 시간 측정 | Lec15 DNS: 연결 전에 이름을 IP로 바꾸는 단계 |
| TCP 상태/속도 | non-blocking `connect` + `select`. 완료 시간 = SYN→SYN-ACK = 약 1 RTT. RST면 `refused` | 교과서 "TCP Handshake", Lec11 |
| HTTP 상태 | `GET <path> HTTP/1.1` + `Host` 헤더를 평문으로 보내고 status line만 읽음. 200s/300s = up, 400s/500s = down | Lec16 HTTP 요청/응답, Status Codes, Headers |
| ICMP ping | Echo Request(type 8)를 만들고, 받은 패킷의 IP 헤더 IHL·protocol로 ICMP 헤더를 찾아 type 0 / 3 / 11 판별. raw 소켓이 실패하면 비특권 소켓, 그다음 TCP fallback | proj1 traceroute (IPv4/ICMP 헤더 파싱, `make_icmp`, `recv_select`), 교과서 IP Header Fields |
| 타임아웃 추정 | `srtt`/`rttvar` EWMA, `timeout = srtt + 4·rttvar` (min/max clamp) | 교과서 "Reliably Delivering a Single Packet": 타이머는 RTT 기준, 이동 평균 + 분산, 짧으면 오판이므로 길게. Lec12 "Detecting Loss" |
| 감지 속도 최적화 | 1) 사이트별 추정 timeout으로 1차 검사: 죽은 서버를 고정 10초가 아니라 RTT 기반 시간 안에 감지 2) 타임아웃난 것만 max timeout으로 재시도해 오판 방지 3) `checkMany`가 C++ 스레드로 동시 검사 (8×400ms → 약 430ms) | 위와 같음 + proj1 `PROBE_ATTEMPT_COUNT` |
| Node 연결 | `Napi::AsyncWorker`로 libuv 스레드에서 실행, Promise 반환 → Express 이벤트 루프를 막지 않음 | node-addon-api |

`k = 4`(분산 가중치)와 `alpha = 1/8`, `beta = 1/4`는 슬라이드에 "moving average"로만 나오는 부분의 구체적인 값으로, TCP에서 쓰는 표준값을 사용했습니다. Internet checksum은 RFC 1071 방식입니다.

## 한계

- HTTPS는 TLS를 직접 구현하지 않아서 TCP 443 handshake까지만 확인합니다(status code 없음, `method: 'tcp'`).
- IPv4만 지원합니다.
- 3xx 리다이렉트는 따라가지 않습니다(서버가 응답 중이므로 up).
- ICMP raw 소켓은 OS 권한에 따라 막힐 수 있고, 이 경우 TCP 80/443 handshake로 대신 판정합니다(`method: 'tcp-fallback'`).
