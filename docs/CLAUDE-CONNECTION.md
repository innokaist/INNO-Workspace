# Claude 결과 반환 연결

개발 위치: E:\Develop\INNO Workspace

## 연결 방식

Cloudflare는 기존 Bearer 인증 MCP를 그대로 제공합니다. Claude의 INNO Workspace 전용 클라우드 환경에서 API 자격 증명을 해당 INNO 호스트에만 적용합니다. Routine은 저장소의 scripts/inno-mcp.mjs를 호출합니다. 토큰은 모델의 프롬프트나 파일에 제공하지 않습니다.

설정값과 Routine 지침: [ROUTINE.md](ROUTINE.md).

## 현재 진행

- 프로젝트 2,113개 파일의 SHA-256 일치 검증 후 이전 완료.
- INNO 전용 Claude 환경 생성 완료.
- 자격 증명 이름·호스트·헤더 입력 완료, 사용자 시크릿 입력 대기.
- Cloudflare Routine URL을 공식 fire 주소로 수정.
- 결과 반환 CLI와 오류·한글 청크 경계 테스트 추가.
- 실제 클라우드 왕복 실행은 인증 저장 후 검증 예정.

[Claude 공식 자격 증명 문서](https://code.claude.com/docs/en/cloud-environments#add-api-credentials)
