#include "tls_client.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <mutex>
#include <new>

#include "mbedtls/ctr_drbg.h"
#include "mbedtls/entropy.h"
#include "mbedtls/error.h"
#include "mbedtls/net_sockets.h"
#include "mbedtls/ssl.h"
#include "mbedtls/threading.h"
#include "mbedtls/x509_crt.h"
#include "psa/crypto.h"
#include "probe.h"

#ifdef _WIN32
#include <wincrypt.h>
#endif

namespace engine {

namespace {

using Clock = std::chrono::steady_clock;

int remainingMs(Clock::time_point deadline) {
    auto left = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - Clock::now()).count();
    return left > 0 ? static_cast<int>(left) : 0;
}

#ifdef _WIN32
// MBEDTLS_THREADING_ALT: Windows CRITICAL_SECTION 으로 mutex 제공
void mutexInit(mbedtls_threading_mutex_t* m) {
    auto* cs = new (std::nothrow) CRITICAL_SECTION;
    if (cs) InitializeCriticalSection(cs);
    m->cs = cs;
}
void mutexFree(mbedtls_threading_mutex_t* m) {
    if (!m->cs) return;
    auto* cs = static_cast<CRITICAL_SECTION*>(m->cs);
    DeleteCriticalSection(cs);
    delete cs;
    m->cs = nullptr;
}
int mutexLock(mbedtls_threading_mutex_t* m) {
    if (!m->cs) return MBEDTLS_ERR_THREADING_MUTEX_ERROR;
    EnterCriticalSection(static_cast<CRITICAL_SECTION*>(m->cs));
    return 0;
}
int mutexUnlock(mbedtls_threading_mutex_t* m) {
    if (!m->cs) return MBEDTLS_ERR_THREADING_MUTEX_ERROR;
    LeaveCriticalSection(static_cast<CRITICAL_SECTION*>(m->cs));
    return 0;
}
#endif

std::string g_caBundlePath;  // index.js 가 deps/cacert/cacert.pem 경로를 넣어줌

// 인증서 검증에 쓸 신뢰 루트 CA
// 1) 함께 배포하는 Mozilla CA 목록: Windows 는 루트를 처음 필요할 때 내려받아서
//    PC 마다 저장소 내용이 달라, 이것만으로는 처음 보는 사이트 검증이 실패할 수 있다.
// 2) SSL_CERT_FILE 환경변수 (사내 프록시 CA 등)
// 3) OS 루트 저장소
int loadRoots(mbedtls_x509_crt& ca) {
    if (!g_caBundlePath.empty()) mbedtls_x509_crt_parse_file(&ca, g_caBundlePath.c_str());
    if (const char* env = std::getenv("SSL_CERT_FILE")) mbedtls_x509_crt_parse_file(&ca, env);
#ifdef _WIN32
    if (HCERTSTORE store = CertOpenSystemStoreW(0, L"ROOT")) {
        PCCERT_CONTEXT c = nullptr;
        while ((c = CertEnumCertificatesInStore(store, c)) != nullptr) {
            mbedtls_x509_crt_parse_der(&ca, c->pbCertEncoded, c->cbCertEncoded);
        }
        CertCloseStore(store, 0);
    }
#else
    const char* files[] = {
        "/etc/ssl/certs/ca-certificates.crt",  // Debian/Ubuntu
        "/etc/pki/tls/certs/ca-bundle.crt",    // Fedora/RHEL
        "/etc/ssl/ca-bundle.pem",              // openSUSE
        "/etc/ssl/cert.pem",                   // macOS, Alpine
    };
    for (const char* f : files) {
        if (mbedtls_x509_crt_parse_file(&ca, f) >= 0) break;
    }
#endif
    int count = 0;
    for (const mbedtls_x509_crt* c = &ca; c && c->raw.len; c = c->next) ++count;
    return count;
}

struct TlsGlobal {
    mbedtls_x509_crt ca;
    int caCount = 0;
    bool ok = false;
    std::string err;
};

TlsGlobal& tlsGlobal() {
    static TlsGlobal g;
    static std::once_flag once;
    std::call_once(once, [] {
#ifdef _WIN32
        mbedtls_threading_set_alt(mutexInit, mutexFree, mutexLock, mutexUnlock);
#endif
        if (psa_crypto_init() != PSA_SUCCESS) {
            g.err = "psa_crypto_init 실패";
            return;
        }
        mbedtls_x509_crt_init(&g.ca);
        g.caCount = loadRoots(g.ca);
        if (g.caCount == 0) {
            g.err = "루트 인증서를 찾지 못함";
            return;
        }
        g.ok = true;
    });
    return g;
}

int bioSend(void* ctx, const unsigned char* buf, size_t len) {
    socket_t s = *static_cast<socket_t*>(ctx);
    int n = ::send(s, reinterpret_cast<const char*>(buf), static_cast<int>(len), 0);
    if (n >= 0) return n;
    return isInProgress(lastError()) ? MBEDTLS_ERR_SSL_WANT_WRITE : MBEDTLS_ERR_NET_SEND_FAILED;
}

int bioRecv(void* ctx, unsigned char* buf, size_t len) {
    socket_t s = *static_cast<socket_t*>(ctx);
    int n = ::recv(s, reinterpret_cast<char*>(buf), static_cast<int>(len), 0);
    if (n >= 0) return n;  // 0 = 상대가 연결을 닫음
    return isInProgress(lastError()) ? MBEDTLS_ERR_SSL_WANT_READ : MBEDTLS_ERR_NET_RECV_FAILED;
}

std::string mbedError(int ret) {
    char buf[160];
    mbedtls_strerror(ret, buf, sizeof(buf));
    return buf;
}

// mbedtls_x509_crt_verify_info 는 여러 줄이라 "; " 로 이어 붙임
std::string verifyInfo(uint32_t flags) {
    char buf[512];
    mbedtls_x509_crt_verify_info(buf, sizeof(buf), "", flags);
    std::string out;
    for (const char* p = buf; *p; ++p) {
        if (*p == '\n') {
            if (p[1]) out += "; ";
        } else {
            out += *p;
        }
    }
    return out;
}

// 그레고리력 날짜 -> 1970-01-01 부터의 일 수
long long daysFromCivil(int y, int m, int d) {
    y -= m <= 2;
    long long era = (y >= 0 ? y : y - 399) / 400;
    long long yoe = y - era * 400;
    long long doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    long long doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + doe - 719468;
}

void fillCertExpiry(const mbedtls_x509_crt* cert, ProbeResult& r) {
    const mbedtls_x509_time& t = cert->valid_to;
    long long expires = daysFromCivil(t.year, t.mon, t.day) * 86400LL + t.hour * 3600 + t.min * 60 + t.sec;
    long long now = static_cast<long long>(std::time(nullptr));
    long long diff = expires - now;
    r.certDaysLeft = static_cast<int>(diff >= 0 ? diff / 86400 : -((-diff + 86399) / 86400));

    char iso[32];
    std::snprintf(iso, sizeof(iso), "%04d-%02d-%02dT%02d:%02d:%02dZ", t.year, t.mon, t.day, t.hour, t.min, t.sec);
    r.certExpiresAt = iso;
}

}  // namespace

void setCaBundlePath(const std::string& path) { g_caBundlePath = path; }

struct TlsSession::Impl {
    socket_t sock = kInvalidSocket;
    mbedtls_entropy_context entropy;
    mbedtls_ctr_drbg_context drbg;
    mbedtls_ssl_config conf;
    mbedtls_ssl_context ssl;

    Impl() {
        mbedtls_entropy_init(&entropy);
        mbedtls_ctr_drbg_init(&drbg);
        mbedtls_ssl_config_init(&conf);
        mbedtls_ssl_init(&ssl);
    }
    ~Impl() {
        mbedtls_ssl_free(&ssl);
        mbedtls_ssl_config_free(&conf);
        mbedtls_ctr_drbg_free(&drbg);
        mbedtls_entropy_free(&entropy);
    }

    // WANT_READ / WANT_WRITE 면 소켓이 준비될 때까지 기다림. false = 타임아웃
    bool waitFor(int ret, Clock::time_point deadline) {
        int left = remainingMs(deadline);
        if (left <= 0) return false;
        return waitReady(sock, ret == MBEDTLS_ERR_SSL_WANT_WRITE, left);
    }
};

TlsSession::TlsSession(std::unique_ptr<Impl> impl) : impl_(std::move(impl)) {}
TlsSession::~TlsSession() = default;

std::unique_ptr<TlsSession> TlsSession::connect(socket_t s, const std::string& host, Clock::time_point deadline,
                                                bool ignoreCertErrors, ProbeResult& r) {
    TlsGlobal& g = tlsGlobal();
    if (!g.ok) {
        r.message = "TLS 초기화 실패: " + g.err;
        return nullptr;
    }

    auto impl = std::make_unique<Impl>();
    impl->sock = s;
    const char* pers = "opensource-project-engine";
    int ret = mbedtls_ctr_drbg_seed(&impl->drbg, mbedtls_entropy_func, &impl->entropy,
                                    reinterpret_cast<const unsigned char*>(pers), std::strlen(pers));
    if (ret == 0) {
        ret = mbedtls_ssl_config_defaults(&impl->conf, MBEDTLS_SSL_IS_CLIENT, MBEDTLS_SSL_TRANSPORT_STREAM,
                                          MBEDTLS_SSL_PRESET_DEFAULT);
    }
    if (ret != 0) {
        r.message = "TLS 설정 실패: " + mbedError(ret);
        return nullptr;
    }
    // OPTIONAL: 검증 실패해도 handshake 는 끝까지 하고, 결과(flags)를 직접 보고 판정한다
    mbedtls_ssl_conf_authmode(&impl->conf, MBEDTLS_SSL_VERIFY_OPTIONAL);
    mbedtls_ssl_conf_ca_chain(&impl->conf, &g.ca, nullptr);
    mbedtls_ssl_conf_rng(&impl->conf, mbedtls_ctr_drbg_random, &impl->drbg);

    if ((ret = mbedtls_ssl_setup(&impl->ssl, &impl->conf)) != 0 ||
        (ret = mbedtls_ssl_set_hostname(&impl->ssl, host.c_str())) != 0) {  // SNI + 인증서 이름 확인
        r.message = "TLS 설정 실패: " + mbedError(ret);
        return nullptr;
    }
    mbedtls_ssl_set_bio(&impl->ssl, &impl->sock, bioSend, bioRecv, nullptr);

    auto t0 = Clock::now();
    while ((ret = mbedtls_ssl_handshake(&impl->ssl)) != 0) {
        if (ret == MBEDTLS_ERR_SSL_WANT_READ || ret == MBEDTLS_ERR_SSL_WANT_WRITE) {
            if (impl->waitFor(ret, deadline)) continue;
            r.timedOut = true;
            r.message = "TLS handshake 타임아웃";
            return nullptr;
        }
        r.message = "TLS handshake 실패: " + mbedError(ret);
        return nullptr;
    }
    r.tlsMs = std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
    r.tlsVersion = mbedtls_ssl_get_version(&impl->ssl);

    const mbedtls_x509_crt* peer = mbedtls_ssl_get_peer_cert(&impl->ssl);
    if (peer) {
        r.hasCert = true;
        fillCertExpiry(peer, r);
    }
    uint32_t flags = mbedtls_ssl_get_verify_result(&impl->ssl);
    r.certValid = peer && flags == 0;
    if (flags != 0) r.certError = verifyInfo(flags);

    if (!r.certValid && !ignoreCertErrors) {
        r.message = "인증서 검증 실패: " + (r.certError.empty() ? std::string("인증서 없음") : r.certError);
        return nullptr;
    }
    return std::unique_ptr<TlsSession>(new TlsSession(std::move(impl)));
}

int TlsSession::send(const char* data, size_t len, Clock::time_point deadline) {
    size_t sent = 0;
    while (sent < len) {
        int ret = mbedtls_ssl_write(&impl_->ssl, reinterpret_cast<const unsigned char*>(data) + sent, len - sent);
        if (ret > 0) {
            sent += ret;
            continue;
        }
        if (ret == MBEDTLS_ERR_SSL_WANT_READ || ret == MBEDTLS_ERR_SSL_WANT_WRITE) {
            if (impl_->waitFor(ret, deadline)) continue;
            return -2;
        }
        return -1;
    }
    return static_cast<int>(sent);
}

int TlsSession::recv(char* buf, size_t len, Clock::time_point deadline) {
    while (true) {
        int ret = mbedtls_ssl_read(&impl_->ssl, reinterpret_cast<unsigned char*>(buf), len);
        if (ret > 0) return ret;
        if (ret == 0 || ret == MBEDTLS_ERR_SSL_PEER_CLOSE_NOTIFY || ret == MBEDTLS_ERR_SSL_CONN_EOF) return 0;
        if (ret == MBEDTLS_ERR_SSL_RECEIVED_NEW_SESSION_TICKET) continue;  // TLS 1.3: handshake 뒤에 오는 티켓
        if (ret == MBEDTLS_ERR_SSL_WANT_READ || ret == MBEDTLS_ERR_SSL_WANT_WRITE) {
            if (impl_->waitFor(ret, deadline)) continue;
            return -2;
        }
        return -1;
    }
}

}  // namespace engine
