# IGDC 결제·수익 파이프라인 (v2)

## 1) 프론트(7개 페이지 + index)
- 카드/버튼/링크 클릭
- data-attribute 또는 이벤트(psom:payment) 발생

## 2) 브라우저 엔진
- /assets/js/igdc-pay.min.js
- 클릭/이벤트를 수신 → 목적(purpose) 및 링크(url) 등을 정규화 → 서버로 요청

## 3) Netlify Functions (서버)
- /.netlify/functions/status
  - 결제/도네이션/제휴/트래킹 가능 여부만 반환(비밀키 없음)
- /.netlify/functions/checkout
  - commerce / donation / affiliate / tracking 분기
  - PG 미연동이면 안전 mock
  - PG 연결되면 redirectUrl 또는 html 모달 응답

## 4) 수익 모델 동시 운용
- 광고(Ad): IGDC 사이트 페이지뷰 기반
- 제휴(Affiliate): 외부 링크 전환 기반
- 소유 채널(Owned): IGDC 공식 채널 기반
- 직접 결제(Internal PG): 승인/연동 후 활성

## 5) 관리자(Admin) 제어(권장)
- functions/data/pay-config.json 으로 토글(비밀정보 없음)
- Netlify 환경변수로 강제 토글 가능(우선순위: env > config)
