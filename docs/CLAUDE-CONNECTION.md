# Claude 결과 반환 연결

개발 위치: E:\Develop\INNO Workspace

## 연결 방식

Cloudflare는 기존 Bearer 인증 MCP를 그대로 제공합니다. Claude의 INNO Workspace 전용 클라우드 환경에서 API 자격 증명을 해당 INNO 호스트에만 적용합니다. Routine은 저장소의 scripts/inno-mcp.mjs를 호출합니다. 토큰은 모델의 프롬프트나 파일에 제공하지 않습니다.

설정값과 Routine 지침: [ROUTINE.md](ROUTINE.md).

## 현재 진행

- 프로젝트 2,113개 파일의 SHA-256 일치 검증 후 이전 완료.
- INNO 전용 Claude 환경 생성 완료. Routine에 해당 환경과 결과 반환 지침을 저장했습니다.
- 사용자가 API 자격 증명과 환경 변경사항 저장 완료.
- Cloudflare Routine URL을 공식 fire 주소로 수정.
- 결과 반환 CLI와 오류·한글 청크 경계 테스트 추가.
- 2026-09-14 실제 클라우드 왕복 검증 성공: INNO에서 Routine 실행 → Claude의 인증된 작업 조회 → connection-check.md 및 final.md 저장 → completed 상태와 assistant 답변을 INNO API에서 확인.
- 검증 작업 ID: 7094b8c1-60df-4210-9a0e-8ae89cbc9c59.

## 사용하기

클라우드 INNO에 접속하여 작업을 만들고 Claude 실행을 선택합니다. 실행 이후 결과와 파일은 같은 INNO 작업에 표시됩니다. 로컬 파일은 PC가 꺼지면 새로 조회할 수 없으며, 구독 실행 한도는 그대로 적용됩니다. 로컬 Codex와 클라우드의 작업 DB는 현재 별개입니다.

[Claude 공식 자격 증명 문서](https://code.claude.com/docs/en/cloud-environments#add-api-credentials)
