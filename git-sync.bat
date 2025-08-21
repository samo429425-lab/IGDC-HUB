@echo off
REM git-sync-helper for Windows (cmd)
setlocal EnableExtensions

REM 확인: git
git --version >NUL 2>&1
if errorlevel 1 (
  echo [ERROR] Git이 설치되어 있지 않거나 PATH에 없습니다.
  pause
  exit /b 1
)

for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set BRANCH=%%b
if "%BRANCH%"=="" set BRANCH=main

REM 인자 커밋 메시지 (없으면 프롬프트)
set MSG=%*
if "%MSG%"=="" (
  set /p MSG=Commit message (기본: quick sync)^> 
  if "%MSG%"=="" set MSG=quick sync
)

echo.
echo [1/4] git add -A
git add -A

echo [2/4] commit (변경 있을 경우)
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "%MSG%"
) else (
  echo -> 커밋할 변경 사항 없음
)

echo [3/4] pull --rebase origin %BRANCH%
git pull --rebase origin %BRANCH%

echo [4/4] push origin %BRANCH%
git push origin %BRANCH%

echo.
echo 완료: 브랜치 %BRANCH%
pause
