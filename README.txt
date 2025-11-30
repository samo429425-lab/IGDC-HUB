Netlify Clean Reset Pack — 2025-09-14 14:35:38

1) 이 ZIP을 Deploys > Upload a deploy 로 올릴 때 "Set as production" 체크.
2) 업로드 후 시크릿 창에서 /sw-nuke?run=1 실행 (예: https://<사이트>.netlify.app/sw-nuke?run=1).
3) https://<사이트>.netlify.app/?v=20250914143538 로 열어 "CLEAN RESET — 20250914143538"가 보이면 성공.
4) Deploys 페이지 우측 메뉴에서 "Lock published deploy" 켜두면 자동 배포가 덮어쓰지 못합니다.
5) 그 다음 실제 새 버전으로 교체 배포.
