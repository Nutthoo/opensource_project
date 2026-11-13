// HTTPS 용 TLS 클라이언트 (Mbed TLS 3.6)
//
// TCP handshake 가 끝난 소켓 위에서 TLS handshake 를 하고, 그 뒤로는
// 평문 HTTP 와 똑같이 요청/응답을 주고받는다 (Lec18 TLS: TCP 위에 얹히는 계층).
#pragma once

#include <chrono>
#include <memory>
#include <string>

#include "net_compat.h"

namespace engine {

struct ProbeResult;

// 첫 HTTPS 검사 전에 호출해야 반영됨 (루트 CA 는 처음 한 번만 읽음)
void setCaBundlePath(const std::string& path);

class TlsSession {
public:
    using Clock = std::chrono::steady_clock;

    ~TlsSession();

    // handshake 실패 시 nullptr. r.message / r.timedOut / 인증서 정보 채움.
    // ignoreCertErrors 가 false 면 인증서 검증 실패도 실패로 처리.
    static std::unique_ptr<TlsSession> connect(socket_t s, const std::string& host, Clock::time_point deadline,
                                               bool ignoreCertErrors, ProbeResult& r);

    // 반환: >0 보낸/받은 byte, 0 연결 종료, -1 에러, -2 타임아웃
    int send(const char* data, size_t len, Clock::time_point deadline);
    int recv(char* buf, size_t len, Clock::time_point deadline);

private:
    struct Impl;
    explicit TlsSession(std::unique_ptr<Impl> impl);
    std::unique_ptr<Impl> impl_;
};

}  // namespace engine
