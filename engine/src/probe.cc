#include "probe.h"

#include <algorithm>
#include <atomic>
#include <cctype>
#include <chrono>
#include <cstring>
#include <thread>

#include "net_compat.h"

namespace engine {

namespace {

using Clock = std::chrono::steady_clock;

double msSince(Clock::time_point t0) {
    return std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
}

int remainingMs(Clock::time_point deadline) {
    auto left = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - Clock::now()).count();
    return left > 0 ? static_cast<int>(left) : 0;
}

timeval toTimeval(int ms) {
    timeval tv;
    tv.tv_sec = ms / 1000;
    tv.tv_usec = (ms % 1000) * 1000;
    return tv;
}

// proj1 util.recv_select 와 같은 역할: 읽을 패킷이 올 때까지 최대 ms 만큼 기다림
bool waitReadable(socket_t s, int ms) {
    fd_set rset;
    FD_ZERO(&rset);
    FD_SET(s, &rset);
    timeval tv = toTimeval(ms);
    return select(static_cast<int>(s) + 1, &rset, nullptr, nullptr, &tv) > 0;
}

// non-blocking connect 의 완료(= handshake 끝) 를 기다림
// 반환: 1 연결됨, 0 타임아웃, -1 실패(err 에 원인)
int waitConnected(socket_t s, int ms, int& err) {
    fd_set wset, eset;
    FD_ZERO(&wset);
    FD_ZERO(&eset);
    FD_SET(s, &wset);
    FD_SET(s, &eset);  // Windows 는 연결 실패(RST)를 except set 으로 알려줌
    timeval tv = toTimeval(ms);
    int n = select(static_cast<int>(s) + 1, nullptr, &wset, &eset, &tv);
    if (n == 0) return 0;
    if (n < 0) {
        err = lastError();
        return -1;
    }
    int soErr = 0;
    socklen_t len = sizeof(soErr);
    getsockopt(s, SOL_SOCKET, SO_ERROR, reinterpret_cast<char*>(&soErr), &len);
    if (soErr != 0) {
        err = soErr;
        return -1;
    }
    return 1;
}

std::string describeConnectError(int err) {
#ifdef _WIN32
    if (err == WSAECONNREFUSED) return "연결 거부 (RST): 호스트는 살아있지만 포트가 닫혀 있음";
    if (err == WSAENETUNREACH || err == WSAEHOSTUNREACH) return "네트워크/호스트 도달 불가";
#else
    if (err == ECONNREFUSED) return "연결 거부 (RST): 호스트는 살아있지만 포트가 닫혀 있음";
    if (err == ENETUNREACH || err == EHOSTUNREACH) return "네트워크/호스트 도달 불가";
#endif
    return "연결 실패 (error " + std::to_string(err) + ")";
}

// TCP 3-way handshake 를 수행하고 걸린 시간을 잰다.
// connect() 는 SYN 을 보내고 SYN-ACK 를 받은 뒤 ACK 를 보내면 완료되므로 대략 1 RTT.
// 성공하면 연결된 소켓을 sockOut 으로 돌려준다 (HTTP 요청에 재사용).
bool tcpHandshake(const std::string& ip, int port, Clock::time_point deadline,
                  socket_t& sockOut, ProbeResult& r) {
    socket_t s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (s == kInvalidSocket) {
        r.message = "socket() 실패";
        return false;
    }
    setNonBlocking(s);

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(static_cast<unsigned short>(port));
    inet_pton(AF_INET, ip.c_str(), &addr.sin_addr);

    auto t0 = Clock::now();
    int rc = connect(s, reinterpret_cast<sockaddr*>(&addr), sizeof(addr));
    int err = 0;
    int state = 1;
    if (rc != 0) {
        err = lastError();
        if (isInProgress(err)) {
            state = waitConnected(s, remainingMs(deadline), err);
        } else {
            state = -1;
        }
    }

    if (state == 1) {
        r.connectMs = msSince(t0);
        sockOut = s;
        return true;
    }
    if (state == 0) {
        r.timedOut = true;
        r.message = "TCP handshake 타임아웃 (SYN-ACK 없음)";
    } else {
#ifdef _WIN32
        r.refused = err == WSAECONNREFUSED;
#else
        r.refused = err == ECONNREFUSED;
#endif
        if (r.refused) r.connectMs = msSince(t0);  // RST 도 SYN 에 대한 응답이므로 왕복 시간
        r.message = describeConnectError(err);
    }
    closeSocket(s);
    return false;
}

bool iequalsPrefix(const std::string& line, const char* prefix) {
    size_t n = std::strlen(prefix);
    if (line.size() < n) return false;
    for (size_t i = 0; i < n; ++i) {
        if (std::tolower(static_cast<unsigned char>(line[i])) != std::tolower(static_cast<unsigned char>(prefix[i])))
            return false;
    }
    return true;
}

std::string trim(const std::string& s) {
    size_t b = s.find_first_not_of(" \t\r\n");
    size_t e = s.find_last_not_of(" \t\r\n");
    return b == std::string::npos ? "" : s.substr(b, e - b + 1);
}

// "HTTP/1.1 200 OK\r\nDate: ...\r\nLocation: ...\r\n\r\n" 에서 status line 과 Location 을 꺼냄
bool parseResponseHead(const std::string& head, ProbeResult& r) {
    size_t eol = head.find("\r\n");
    std::string statusLine = head.substr(0, eol);
    if (statusLine.compare(0, 5, "HTTP/") != 0) return false;

    size_t sp1 = statusLine.find(' ');
    if (sp1 == std::string::npos) return false;
    size_t sp2 = statusLine.find(' ', sp1 + 1);
    std::string code = statusLine.substr(sp1 + 1, sp2 == std::string::npos ? std::string::npos : sp2 - sp1 - 1);
    r.statusCode = std::atoi(code.c_str());
    r.statusText = sp2 == std::string::npos ? "" : trim(statusLine.substr(sp2 + 1));

    size_t pos = eol;
    while (pos != std::string::npos && pos + 2 < head.size()) {
        size_t next = head.find("\r\n", pos + 2);
        std::string line = head.substr(pos + 2, next == std::string::npos ? std::string::npos : next - pos - 2);
        if (line.empty()) break;
        if (iequalsPrefix(line, "location:")) r.location = trim(line.substr(9));
        pos = next;
    }
    return r.statusCode > 0;
}

std::atomic<unsigned short> g_icmpSeq{0};

unsigned short icmpIdentifier() {
#ifdef _WIN32
    return static_cast<unsigned short>(GetCurrentProcessId() & 0xFFFF);
#else
    return static_cast<unsigned short>(getpid() & 0xFFFF);
#endif
}

// ICMP 를 못 쓰는 환경(관리자 권한 없음)에서는 TCP handshake 로 대신 살아있는지 본다
ProbeResult tcpFallback(const std::string& host, int timeoutMs, const std::string& why) {
    ProbeResult r = checkTcp(host, 80, timeoutMs);
    if (!r.up && !r.refused && !r.ip.empty()) {
        ProbeResult r443 = checkTcp(host, 443, timeoutMs);
        if (r443.up || r443.refused) r = r443;
    }
    // ping 은 "호스트가 살아있나" 를 보는 것이므로 RST 응답도 살아있는 것으로 본다
    if (r.refused) r.up = true;
    r.method = "tcp-fallback";
    r.rttMs = r.connectMs;
    r.message = why + (r.message.empty() ? "" : " / " + r.message);
    return r;
}

}  // namespace

ParsedUrl parseUrl(const std::string& url) {
    ParsedUrl u;
    std::string rest = url;
    size_t sep = rest.find("://");
    if (sep == std::string::npos) {
        u.scheme = "http";
    } else {
        u.scheme = rest.substr(0, sep);
        std::transform(u.scheme.begin(), u.scheme.end(), u.scheme.begin(),
                       [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        rest = rest.substr(sep + 3);
    }
    if (u.scheme != "http" && u.scheme != "https") return u;

    size_t slash = rest.find_first_of("/?#");
    std::string authority = rest.substr(0, slash);
    u.path = slash == std::string::npos ? "/" : rest.substr(slash);
    if (u.path[0] != '/') u.path = "/" + u.path;
    size_t hash = u.path.find('#');
    if (hash != std::string::npos) u.path = u.path.substr(0, hash);

    size_t at = authority.rfind('@');
    if (at != std::string::npos) authority = authority.substr(at + 1);

    size_t colon = authority.rfind(':');
    if (colon != std::string::npos) {
        u.host = authority.substr(0, colon);
        u.port = std::atoi(authority.substr(colon + 1).c_str());
    } else {
        u.host = authority;
        u.port = u.scheme == "https" ? 443 : 80;
    }
    u.ok = !u.host.empty() && u.port > 0 && u.port < 65536;
    return u;
}

bool resolveIPv4(const std::string& host, std::string& ipOut, double& dnsMs, std::string& err) {
    netInit();
    addrinfo hints{};
    hints.ai_family = AF_INET;
    hints.ai_socktype = SOCK_STREAM;
    addrinfo* res = nullptr;

    auto t0 = Clock::now();
    int rc = getaddrinfo(host.c_str(), nullptr, &hints, &res);
    dnsMs = msSince(t0);
    if (rc != 0 || !res) {
        err = "DNS 조회 실패: " + host;
        return false;
    }
    char buf[INET_ADDRSTRLEN] = {0};
    auto* sin = reinterpret_cast<sockaddr_in*>(res->ai_addr);
    inet_ntop(AF_INET, &sin->sin_addr, buf, sizeof(buf));
    ipOut = buf;
    freeaddrinfo(res);
    return true;
}

ProbeResult checkTcp(const std::string& host, int port, int timeoutMs) {
    ProbeResult r;
    r.method = "tcp";
    auto t0 = Clock::now();
    auto deadline = t0 + std::chrono::milliseconds(timeoutMs);

    if (!resolveIPv4(host, r.ip, r.dnsMs, r.message)) return r;

    socket_t s = kInvalidSocket;
    if (tcpHandshake(r.ip, port, deadline, s, r)) {
        r.up = true;
        r.message = "TCP " + std::to_string(port) + " 연결 성공";
        closeSocket(s);
    }
    r.totalMs = msSince(t0);
    return r;
}

ProbeResult checkHttp(const std::string& url, int timeoutMs) {
    ProbeResult r;
    r.method = "http";
    auto t0 = Clock::now();
    auto deadline = t0 + std::chrono::milliseconds(timeoutMs);

    ParsedUrl u = parseUrl(url);
    if (!u.ok) {
        r.message = "지원하지 않는 URL: " + url;
        return r;
    }
    if (!resolveIPv4(u.host, r.ip, r.dnsMs, r.message)) {
        r.totalMs = msSince(t0);
        return r;
    }

    socket_t s = kInvalidSocket;
    if (!tcpHandshake(r.ip, u.port, deadline, s, r)) {
        r.totalMs = msSince(t0);
        return r;
    }

    if (u.scheme == "https") {
        // HTTPS 는 handshake 다음에 TLS 가 필요해서 평문 HTTP 요청을 보낼 수 없음.
        // TCP 443 handshake 성공 = 서버가 응답하는 상태로 판단.
        r.up = true;
        r.method = "tcp";
        r.message = "HTTPS: TCP 443 handshake 로 판정 (TLS 미지원, status code 없음)";
        closeSocket(s);
        r.totalMs = msSince(t0);
        return r;
    }

    // Lec16: 사람이 읽을 수 있는 평문 요청. Host 헤더로 어떤 사이트인지 알려준다.
    std::string req = "GET " + u.path + " HTTP/1.1\r\n"
                      "Host: " + u.host + (u.port != 80 ? ":" + std::to_string(u.port) : "") + "\r\n"
                      "User-Agent: opensource-project-engine/1.0\r\n"
                      "Accept: */*\r\n"
                      "Connection: close\r\n\r\n";

    auto tReq = Clock::now();
    size_t sent = 0;
    while (sent < req.size()) {
        int n = send(s, req.data() + sent, static_cast<int>(req.size() - sent), 0);
        if (n > 0) {
            sent += n;
            continue;
        }
        if (n < 0 && isInProgress(lastError()) && remainingMs(deadline) > 0) {
            fd_set wset;
            FD_ZERO(&wset);
            FD_SET(s, &wset);
            timeval tv = toTimeval(remainingMs(deadline));
            select(static_cast<int>(s) + 1, nullptr, &wset, nullptr, &tv);
            continue;
        }
        r.message = "요청 전송 실패";
        closeSocket(s);
        r.totalMs = msSince(t0);
        return r;
    }

    // 응답 헤더(빈 줄까지)만 읽으면 status code 를 알 수 있다
    std::string head;
    char buf[2048];
    while (head.find("\r\n\r\n") == std::string::npos && head.size() < 16384) {
        int left = remainingMs(deadline);
        if (left <= 0 || !waitReadable(s, left)) {
            r.timedOut = true;
            break;
        }
        int n = recv(s, buf, sizeof(buf), 0);
        if (n > 0) {
            if (head.empty()) r.ttfbMs = msSince(tReq);
            head.append(buf, n);
        } else if (n == 0) {
            break;  // 서버가 연결을 닫음 (FIN)
        } else if (!isInProgress(lastError())) {
            break;
        }
    }
    closeSocket(s);
    r.totalMs = msSince(t0);

    if (head.empty()) {
        r.message = r.timedOut ? "응답 타임아웃 (status line 없음)" : "응답 없이 연결 종료";
        return r;
    }
    if (!parseResponseHead(head, r)) {
        r.message = "HTTP 응답이 아님";
        return r;
    }
    r.timedOut = false;
    // 200s 성공, 300s 리다이렉트(서버는 정상 응답 중) -> UP. 400s/500s -> DOWN.
    r.up = r.statusCode >= 200 && r.statusCode < 400;
    r.message = std::to_string(r.statusCode) + (r.statusText.empty() ? "" : " " + r.statusText);
    return r;
}

unsigned short internetChecksum(const unsigned char* data, size_t len) {
    unsigned long sum = 0;
    for (size_t i = 0; i + 1 < len; i += 2) sum += (data[i] << 8) | data[i + 1];
    if (len & 1) sum += data[len - 1] << 8;
    while (sum >> 16) sum = (sum & 0xFFFF) + (sum >> 16);
    return static_cast<unsigned short>(~sum & 0xFFFF);
}

ProbeResult ping(const std::string& host, int timeoutMs) {
    ProbeResult r;
    r.method = "icmp";
    auto t0 = Clock::now();
    auto deadline = t0 + std::chrono::milliseconds(timeoutMs);

    if (!resolveIPv4(host, r.ip, r.dnsMs, r.message)) return r;

    // proj1 util.make_icmp 처럼 raw 소켓 먼저, 권한이 없으면 비특권 ICMP(DGRAM) 소켓 시도
    bool raw = true;
    socket_t s = socket(AF_INET, SOCK_RAW, IPPROTO_ICMP);
    if (s == kInvalidSocket) {
        int err = lastError();
#ifndef _WIN32
        s = socket(AF_INET, SOCK_DGRAM, IPPROTO_ICMP);
        raw = false;
#endif
        if (s == kInvalidSocket) {
            return tcpFallback(host, timeoutMs,
                               isPermissionError(err) ? "ICMP raw 소켓 권한 없음" : "ICMP 소켓 생성 실패");
        }
    }

    const unsigned short id = icmpIdentifier();
    const unsigned short seq = ++g_icmpSeq;

    // ICMP Echo Request: type 8, code 0, checksum, identifier, sequence, data
    unsigned char pkt[8 + 32] = {0};
    pkt[0] = 8;
    pkt[1] = 0;
    pkt[4] = id >> 8;
    pkt[5] = id & 0xFF;
    pkt[6] = seq >> 8;
    pkt[7] = seq & 0xFF;
    for (size_t i = 8; i < sizeof(pkt); ++i) pkt[i] = static_cast<unsigned char>('a' + (i - 8) % 26);
    unsigned short ck = internetChecksum(pkt, sizeof(pkt));
    pkt[2] = ck >> 8;
    pkt[3] = ck & 0xFF;

    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    inet_pton(AF_INET, r.ip.c_str(), &addr.sin_addr);

    auto tSend = Clock::now();
    if (sendto(s, reinterpret_cast<const char*>(pkt), sizeof(pkt), 0,
               reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) < 0) {
        int err = lastError();
        closeSocket(s);
        if (isPermissionError(err)) return tcpFallback(host, timeoutMs, "ICMP 전송 권한 없음");
        r.message = "ICMP 전송 실패";
        return r;
    }

    unsigned char buf[1500];
    while (true) {
        int left = remainingMs(deadline);
        if (left <= 0 || !waitReadable(s, left)) {
            r.timedOut = true;
            r.message = "ICMP echo 응답 없음 (타임아웃)";
            break;
        }
        sockaddr_in from{};
        socklen_t fromLen = sizeof(from);
        int n = recvfrom(s, reinterpret_cast<char*>(buf), sizeof(buf), 0,
                         reinterpret_cast<sockaddr*>(&from), &fromLen);
        if (n <= 0) continue;

        // raw 소켓은 IP 헤더까지 받는다. IHL(하위 4비트) * 4 = IP 헤더 길이(byte),
        // protocol(9번째 byte) 이 1 이면 ICMP.
        size_t off = 0;
        if (raw) {
            if (n < 20 || (buf[0] >> 4) != 4 || buf[9] != 1) continue;
            off = (buf[0] & 0x0F) * 4;
        }
        if (static_cast<size_t>(n) < off + 8) continue;
        const unsigned char* icmp = buf + off;
        unsigned char type = icmp[0];

        if (type == 0) {  // Echo Reply
            unsigned short rid = (icmp[4] << 8) | icmp[5];
            unsigned short rseq = (icmp[6] << 8) | icmp[7];
            // 같은 프로세스의 다른 ping 이 받은 응답일 수 있으니 id/seq 로 내 것만 고름
            // (비특권 DGRAM 소켓은 커널이 id 를 바꾸므로 seq 만 비교)
            if (rseq != seq || (raw && rid != id)) continue;
            r.rttMs = msSince(tSend);
            r.up = true;
            r.message = "ICMP echo reply";
            break;
        }
        if (type == 3 || type == 11) {
            // Destination Unreachable / Time Exceeded: 데이터 부분에 원래 IP 헤더 + ICMP 앞 8byte 가 들어있음
            const unsigned char* inner = icmp + 8;
            if (static_cast<size_t>(n) < off + 8 + 20) continue;
            size_t innerIhl = (inner[0] & 0x0F) * 4;
            if (static_cast<size_t>(n) < off + 8 + innerIhl + 8) continue;
            const unsigned char* innerIcmp = inner + innerIhl;
            unsigned short iseq = (innerIcmp[6] << 8) | innerIcmp[7];
            if (iseq != seq) continue;
            r.message = type == 3 ? "ICMP Destination Unreachable (code " + std::to_string(icmp[1]) + ")"
                                  : "ICMP Time Exceeded (TTL 만료)";
            break;
        }
    }
    closeSocket(s);
    r.totalMs = r.up ? r.rttMs : msSince(t0);
    return r;
}

ProbeResult check(const Target& t) {
    if (t.type == "tcp") return checkTcp(t.host, t.port, t.timeoutMs);
    if (t.type == "ping") return ping(t.host, t.timeoutMs);
    return checkHttp(t.url, t.timeoutMs);
}

std::vector<ProbeResult> checkMany(const std::vector<Target>& targets, int maxConcurrency) {
    std::vector<ProbeResult> results(targets.size());
    if (maxConcurrency < 1) maxConcurrency = 1;

    std::atomic<size_t> next{0};
    auto worker = [&] {
        for (size_t i = next++; i < targets.size(); i = next++) results[i] = check(targets[i]);
    };
    size_t n = std::min(targets.size(), static_cast<size_t>(maxConcurrency));
    std::vector<std::thread> pool;
    for (size_t i = 0; i < n; ++i) pool.emplace_back(worker);
    for (auto& th : pool) th.join();
    return results;
}

}  // namespace engine
