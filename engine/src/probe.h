// 서버 상태 감지 / 반응 속도 측정 (CS168 기반)
//
//  DNS (Lec15)  : 호스트 이름 -> IP 주소. 연결 전에 먼저 일어나므로 시간을 따로 잰다.
//  TCP (Lec11)  : 3-way handshake (SYN / SYN-ACK / ACK). connect() 완료까지 = 약 1 RTT.
//  HTTP (Lec16) : 요청 1개 -> 응답 1개. 응답 첫 줄의 status code 로 결과 판단.
//  ICMP (proj1) : IP 헤더(IHL, protocol) 를 파싱해서 ICMP 헤더(type/code/checksum)를 읽음.
#pragma once

#include <string>
#include <vector>

namespace engine {

struct ProbeResult {
    bool up = false;
    std::string method;      // "http" | "tcp" | "icmp" | "tcp-fallback"
    std::string ip;          // DNS 로 얻은 IPv4 주소
    double dnsMs = -1;       // 이름 해석 시간
    double connectMs = -1;   // TCP handshake 시간 (= 1 RTT 근사)
    double ttfbMs = -1;      // 요청 전송 ~ 응답 첫 바이트
    double rttMs = -1;       // ICMP echo 왕복 시간
    double totalMs = -1;     // 대시보드에 표시할 응답 시간
    int statusCode = 0;      // HTTP status code (HTTP 가 아니면 0)
    std::string statusText;
    std::string location;    // 3xx 응답의 Location 헤더
    bool timedOut = false;
    bool refused = false;    // SYN 에 RST 가 돌아옴 = 호스트는 살아있고 포트만 닫힘
    std::string message;
};

struct Target {
    std::string type = "http";  // "http" | "tcp" | "ping"
    std::string url;            // type == http
    std::string host;           // type == tcp / ping
    int port = 0;               // type == tcp
    int timeoutMs = 10000;
};

struct ParsedUrl {
    bool ok = false;
    std::string scheme, host, path;
    int port = 0;
};

ParsedUrl parseUrl(const std::string& url);

// 필요한 경우만 따로 부를 수 있게 공개
bool resolveIPv4(const std::string& host, std::string& ipOut, double& dnsMs, std::string& err);

ProbeResult checkHttp(const std::string& url, int timeoutMs);
ProbeResult checkTcp(const std::string& host, int port, int timeoutMs);
ProbeResult ping(const std::string& host, int timeoutMs);
ProbeResult check(const Target& t);

// 여러 대상을 스레드로 동시에 검사 (한 서버가 느려도 나머지를 기다리지 않음)
std::vector<ProbeResult> checkMany(const std::vector<Target>& targets, int maxConcurrency);

// RFC 1071 Internet checksum (ICMP 헤더 + 데이터)
unsigned short internetChecksum(const unsigned char* data, size_t len);

}  // namespace engine
