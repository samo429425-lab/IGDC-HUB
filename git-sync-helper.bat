@echo off
setlocal ENABLEEXTENSIONS ENABLEDELAYEDEXPANSION

REM ----- 브랜치 설정 (기본: main) -----
set BRANCH=%1
if "%BRANCH%"=="" set BRANCH=main

REM ----- 현재 폴더가 Git 저장소인지 확인 -----
git rev-parse --is-inside-work-tree >NUL 2>&1
if errorlevel 1 (
  echo [오류] 이 폴더는 Git 저장소가 아닙니다. IGDC-HUB 저장소 루트에서 실행하세요.
  pause
  exit /b 1
)

REM ----- origin 원격 확인/설정 -----
for /f "delims=" %%A in ('git remote') do set HASREMOTE=%%A
if "%HASREMOTE%"=="" (
  set /p URL=[설정] origin 원격이 없습니다. GitHub 저장소 URL(.git)을 입력하세요: 
  git remote add origin "%URL%"
)

REM ----- 최신 내용 받기 (충돌 방지를 위해 rebase) -----
git pull --rebase origin %BRANCH%

REM ----- 모든 변경 추가/커밋/푸시 -----
git add -A
git commit -m "chore: sync %DATE% %TIME%" || echo (안내) 커밋할 변경이 없습니다.
git push -u origin %BRANCH%

echo.
echo 완료! 원격: origin, 브랜치: %BRANCH%
pause
