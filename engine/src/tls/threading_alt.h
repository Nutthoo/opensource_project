/* MBEDTLS_THREADING_ALT 용 mutex 타입 (Windows). 구현은 tls_client.cc */
#ifndef ENGINE_THREADING_ALT_H
#define ENGINE_THREADING_ALT_H

typedef struct mbedtls_threading_mutex_t {
    void *cs; /* CRITICAL_SECTION*, 초기화 실패 시 NULL */
} mbedtls_threading_mutex_t;

#endif
