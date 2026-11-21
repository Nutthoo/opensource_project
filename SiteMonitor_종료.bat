@echo off
chcp 65001 > nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a > nul 2>&1
)
echo 백그라운드 모니터링 서버가 종료되었습니다.
timeout /t 1 /nobreak > nul