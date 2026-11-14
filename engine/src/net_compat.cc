#include "net_compat.h"

#include <mutex>

namespace engine {

void netInit() {
#ifdef _WIN32
    static std::once_flag once;
    std::call_once(once, [] {
        WSADATA data;
        WSAStartup(MAKEWORD(2, 2), &data);
    });
#endif
}

void closeSocket(socket_t s) {
    if (s == kInvalidSocket) return;
#ifdef _WIN32
    closesocket(s);
#else
    close(s);
#endif
}

bool setNonBlocking(socket_t s) {
#ifdef _WIN32
    u_long mode = 1;
    return ioctlsocket(s, FIONBIO, &mode) == 0;
#else
    int flags = fcntl(s, F_GETFL, 0);
    return flags >= 0 && fcntl(s, F_SETFL, flags | O_NONBLOCK) == 0;
#endif
}

bool waitReady(socket_t s, bool forWrite, int ms) {
    if (ms < 0) ms = 0;
    fd_set set;
    FD_ZERO(&set);
    FD_SET(s, &set);
    timeval tv;
    tv.tv_sec = ms / 1000;
    tv.tv_usec = (ms % 1000) * 1000;
    int n = forWrite ? select(static_cast<int>(s) + 1, nullptr, &set, nullptr, &tv)
                     : select(static_cast<int>(s) + 1, &set, nullptr, nullptr, &tv);
    return n > 0;
}

int lastError() {
#ifdef _WIN32
    return WSAGetLastError();
#else
    return errno;
#endif
}

bool isInProgress(int err) {
#ifdef _WIN32
    return err == WSAEWOULDBLOCK || err == WSAEINPROGRESS;
#else
    return err == EINPROGRESS || err == EWOULDBLOCK;
#endif
}

bool isPermissionError(int err) {
#ifdef _WIN32
    return err == WSAEACCES;
#else
    return err == EPERM || err == EACCES;
#endif
}

}  // namespace engine
