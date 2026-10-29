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
- TLS 라이브러리(Mbed TLS)는 `deps/`에 소스로 들어 있어서 따로 설치할 것이 없습니다. 첫 빌드는 Mbed TLS까지 컴파일하느라 1~2분 걸립니다.

## 사용법 (backend)

```js
const engine = require('../engine');

// 단건 검사
const r = await engine.checkHttp('https://github.com', 5000);
// { up: true, status: 'up', method: 'https', statusCode: 200, responseTime: 120.4,
//   dnsMs: 9.6, connectMs: 35.2, tlsMs: 16.7, ttfbMs: 47.8,
//   tls: { version: 'TLSv1.3', certValid: true, certError: null,
//          expiresAt: '2026-11-29T23:59:59Z', daysLeft: 31 }, ... }

// 인증서 오류가 있어도 응답만 오면 up 으로 볼 때 (사내 사이트 등)
await engine.checkHttp('https://self-signed.example', 5000, { ignoreTls: true });

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
| `method` | `http`, `https`, `tcp`, `icmp`, `tcp-fallback` |
| `responseTime` | 대시보드에 표시할 응답 시간(ms). HTTP(S)는 DNS + TCP/TLS handshake + 첫 바이트, ping은 RTT |
| `dnsMs` / `connectMs` / `tlsMs` / `ttfbMs` / `rttMs` | 단계별 시간 |
| `tls` | HTTPS일 때 `{ version, certValid, certError, expiresAt, daysLeft }`, 아니면 `null` |
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
| HTTPS | TCP handshake 뒤에 TLS handshake(SNI, 인증서 체인·이름·만료 검증)를 하고 그 위로 같은 HTTP 요청. 인증서가 잘못되면 down | Lec18 TLS (TCP 위의 보안 계층, 인증서로 서버 신원 확인) |
| ICMP ping | Echo Request(type 8)를 만들고, 받은 패킷의 IP 헤더 IHL·protocol로 ICMP 헤더를 찾아 type 0 / 3 / 11 판별. raw 소켓이 실패하면 비특권 소켓, 그다음 TCP fallback | proj1 traceroute (IPv4/ICMP 헤더 파싱, `make_icmp`, `recv_select`), 교과서 IP Header Fields |
| 타임아웃 추정 | `srtt`/`rttvar` EWMA, `timeout = srtt + 4·rttvar` (min/max clamp) | 교과서 "Reliably Delivering a Single Packet": 타이머는 RTT 기준, 이동 평균 + 분산, 짧으면 오판이므로 길게. Lec12 "Detecting Loss" |
| 감지 속도 최적화 | 1) 사이트별 추정 timeout으로 1차 검사: 죽은 서버를 고정 10초가 아니라 RTT 기반 시간 안에 감지 2) 타임아웃난 것만 max timeout으로 재시도해 오판 방지 3) `checkMany`가 C++ 스레드로 동시 검사 (8×400ms → 약 430ms) | 위와 같음 + proj1 `PROBE_ATTEMPT_COUNT` |
| Node 연결 | `Napi::AsyncWorker`로 libuv 스레드에서 실행, Promise 반환 → Express 이벤트 루프를 막지 않음 | node-addon-api |

`k = 4`(분산 가중치)와 `alpha = 1/8`, `beta = 1/4`는 슬라이드에 "moving average"로만 나오는 부분의 구체적인 값으로, TCP에서 쓰는 표준값을 사용했습니다. Internet checksum은 RFC 1071 방식입니다.

## 함께 들어 있는 오픈소스

| 이름 | 위치 | 용도 | 라이선스 |
|---|---|---|---|
| Mbed TLS 3.6.7 (LTS) | `deps/mbedtls` (`include/`, `library/`만) | HTTPS용 TLS | Apache-2.0 (`deps/mbedtls/LICENSE`) |
| Mozilla CA 목록 (curl.se/ca/cacert.pem, 2026-10-20) | `deps/cacert/cacert.pem` | 인증서 검증용 루트 CA | MPL-2.0 |

- 루트 CA는 `cacert.pem`, `SSL_CERT_FILE` 환경변수, OS 루트 저장소를 모두 읽습니다. Windows는 루트 인증서를 처음 필요할 때 내려받기 때문에 PC마다 저장소 내용이 달라서, OS 저장소만으로는 처음 보는 사이트(예: example.com) 검증이 실패할 수 있었습니다.
- `cacert.pem`은 몇 달에 한 번 https://curl.se/ca/cacert.pem 에서 새로 받아 교체하면 됩니다.
- Mbed TLS는 여러 스레드에서 동시에 TLS를 쓰므로 `src/tls/mbedtls_user_config.h`에서 스레드 안전 모드(`MBEDTLS_THREADING_C`)를 켰습니다.

## 한계

- IPv4만 지원합니다.
- 3xx 리다이렉트는 따라가지 않습니다(서버가 응답 중이므로 up).
- ICMP raw 소켓은 OS 권한에 따라 막힐 수 있고, 이 경우 TCP 80/443 handshake로 대신 판정합니다(`method: 'tcp-fallback'`).
