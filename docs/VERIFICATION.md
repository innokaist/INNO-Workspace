# 검증 기록 — 2026-09-13

- `node --test --test-isolation=none tests/*.test.mjs`: **64/64 통과**, 실패 0.
- 실제 ChatGPT 구독 로그인 → Node API → Codex 실행 → `INNO_SMOKE_OK` 응답 → 완료 체크포인트와 `final.md` 저장을 확인했습니다. API 키를 사용하지 않았습니다.
- 테스트 실행 자료와 SQLite는 Git에서 제외한 `.inno` 아래에만 있습니다. 제공된 연구 폴더는 수정하거나 게시하지 않았습니다.
- 데스크톱 1440×960, 모바일 390×844 브라우저에서 수평 넘침 없음, 작업 생성·링크 연결·일시정지·역할 편집·재접속 기록 유지 확인.
- 동시 탭 생성/수정 충돌, SQLite/D1 CAS, 취소 후 늦은 결과 차단, 원본 내용 미저장, 안전한 파일 경로, 추출 한도와 UTF-8 경계 회귀 테스트 포함.
- Office 파서는 실제 ZIP 라이브러리로 검증했습니다. PDF 파서 연결은 주입된 테스트 계약으로 검증했으며 실제 모든 PDF 글꼴/레이아웃을 보증하지 않습니다.
- Claude Routine 실계정 실행 및 PC 종료 상태에서의 AI 작업은 아직 미검증입니다. Routine 연결이 필요합니다.
- GitHub Pages는 화면 호스팅이며 서버 동기화나 AI 실행을 제공하지 않습니다. Cloudflare 연결 후 같은 API를 사용하는 기기끼리 작업 상태가 공유됩니다.

검토 결과: [FINAL-REVIEW.md](FINAL-REVIEW.md). 운영 범위 및 한도: [BACKEND-REPORT.md](BACKEND-REPORT.md).
