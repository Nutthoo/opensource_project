/* Mbed TLS 기본 설정(mbedtls_config.h) 위에 덧붙이는 설정
 * checkMany 가 여러 스레드에서 동시에 TLS handshake 를 하므로 스레드 안전 모드가 필요하다. */
#define MBEDTLS_THREADING_C
#if defined(_WIN32)
#define MBEDTLS_THREADING_ALT      /* Windows: threading_alt.h + CRITICAL_SECTION */
#else
#define MBEDTLS_THREADING_PTHREAD
#endif
