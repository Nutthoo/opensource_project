// Winsock(Windows) / BSD socket(Linux, macOS) 차이를 감추는 얇은 래퍼
#pragma once

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

namespace engine {

#ifdef _WIN32
using socket_t = SOCKET;
constexpr socket_t kInvalidSocket = INVALID_SOCKET;
#else
using socket_t = int;
constexpr socket_t kInvalidSocket = -1;
#endif

// Windows 는 소켓을 쓰기 전에 WSAStartup 이 한 번 필요
void netInit();

void closeSocket(socket_t s);
bool setNonBlocking(socket_t s);

// 마지막 소켓 에러 코드 (errno / WSAGetLastError)
int lastError();
bool isInProgress(int err);   // non-blocking connect 진행 중
bool isPermissionError(int err);

}  // namespace engine
