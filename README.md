```mermaid
flowchart TD
    subgraph Client ["프론트엔드 (사용자 웹 UI)"]
        UI["Vue 3 Dashboard<br/>(반응형 모니터링 화면)"]
    end

    subgraph Backend ["백엔드 (Node.js Application)"]
        Server["Express Web Server<br/>(REST API & 라우팅)"]
        Socket["Socket.IO Server<br/>(실시간 상태 이벤트 방송)"]
        DB_Adapter["SQLite ORM / Driver"]
    end

    subgraph Native Engine ["네이티브 모니터링 엔진"]
        NAPI["N-API / Node-addon-api<br/>(C++ Binding)"]
        Engine["C++ Monitoring Core<br/>(소켓 직접 구현 + Mbed TLS)"]
    end

    subgraph Database ["데이터베이스"]
        DB[(SQLite3 DB<br/>모니터링 이력 & 설정 데이터)]
    end

    subgraph Target ["모니터링 대상 (Target Servers)"]
        Target1["HTTP / HTTPS"]
        Target2["ICMP Ping"]
        Target3["TCP Port Check"]
    end

    UI <-->|WebSocket / HTTP| Server
    Server <--> Socket
    Server <--> DB_Adapter <--> DB
    Server <-->|Native Call| NAPI <--> Engine
    Engine -->|비동기 프로토콜 감지| Target1 & Target2 & Target3
```

## 실행 순서

```bash
# 1. C++ 감지 엔진 빌드 (처음 한 번, C++ 코드가 바뀌었을 때 다시)
cd engine && npm install && cd ..

# 2. 백엔드 (http://localhost:3000)
cd backend && npm install && npm start
```

- 엔진 빌드에는 Windows의 경우 Visual Studio "C++를 사용한 데스크톱 개발"이 필요합니다. 자세한 내용은 `engine/README.md`
- 백엔드 API, 환경 변수, DB 변경 사항은 `backend/README.md`
