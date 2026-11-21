@echo off
chcp 65001 > nul
cd /d "%~dp0"

:: 백그라운드에서 백엔드 서버 실행 (이미 켜져 있으면 중복 실행 방지)
netstat -ano | findstr ":3000 " | findstr "LISTENING" > nul
if errorlevel 1 (
    wscript.exe "%~dp0run_server.vbs"
    timeout /t 2 /nobreak > nul
)

:: 크롬(없으면 엣지)의 전용 앱 모드(--app)로 주소창 없는 데스크톱 프로그램처럼 열기
where chrome > nul 2>&1
if %errorlevel%==0 (
    start "" chrome --app=http://localhost:3000
    exit
)

if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" --app=http://localhost:3000
    exit
)

if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" --app=http://localhost:3000
    exit
)

start "" msedge --app=http://localhost:3000
exit