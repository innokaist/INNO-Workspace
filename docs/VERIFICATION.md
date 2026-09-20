# 검증 기록 — 2026-09-13

- `node --test --test-isolation=none tests/*.test.mjs`: **65/65 통과**, 실패 0.
- 실제 ChatGPT 구독 로그인 → Node API → Codex 실행 → `INNO_SMOKE_OK` 응답 → 완료 체크포인트와 `final.md` 저장을 확인했습니다. 추가 실행에서 실제 `smoke.svg` 파일 생성과 파일 내용 수집도 통과했습니다. API 키를 사용하지 않았습니다.
- 테스트 실행 자료와 SQLite는 Git에서 제외한 `.inno` 아래에만 있습니다. 제공된 연구 폴더는 수정하거나 게시하지 않았습니다.
- 데스크톱 1440×960, 모바일 390×844 브라우저에서 수평 넘침 없음, 작업 생성·링크 연결·일시정지·역할 편집·재접속 기록 유지 확인.
- 동시 탭 생성/수정 충돌, SQLite/D1 CAS, 취소 후 늦은 결과 차단, 원본 내용 미저장, 안전한 파일 경로, 추출 한도와 UTF-8 경계 회귀 테스트 포함.
- Office 파서는 실제 ZIP 라이브러리로 검증했습니다. PDF 파서 연결은 주입된 테스트 계약으로 검증했으며 실제 모든 PDF 글꼴/레이아웃을 보증하지 않습니다.
- 2026-09-14 Claude Routine 실계정 왕복 실행 검증 성공. 생성 파일 2개와 최종 assistant 답변, completed 상태를 INNO API에서 확인했습니다. PC를 실제로 종료한 실험은 수행하지 않았습니다.
- GitHub Pages 공개 UI HTTP 200 확인. Cloudflare Worker 배포 후 비인증 상태 조회 401, 인증 상태 조회 200, D1 작업 생성·일시정지·재조회 성공 (`CLOUD_DURABLE_TASK_PASS`). 같은 API를 사용하는 기기끼리 상태를 공유합니다.
- 배포 서버: https://inno-workspace-api.innokaist.workers.dev . 2026-09-14 확인: cloud=true, localCodex=false, claudeRoutine=true.

검토 결과: [FINAL-REVIEW.md](FINAL-REVIEW.md). 운영 범위 및 한도: [BACKEND-REPORT.md](BACKEND-REPORT.md).

## 2026-09-14 데스크톱 연결 1차

- 전체 테스트 81개 통과. 경쟁 실행·재전송·취소·자료 변경·만료·프로세스 잠금·HTTP 인증 경로 검증.
- 실제 ChatGPT 구독 Codex 왕복 성공: 작업 602bf79f-9723-430b-9c6a-ec731e957925, 답변 INNO_CODEX_CLOUD_OK, final.md, completed 상태를 클라우드 API에서 확인.
- 첨부 없는 클라우드 작업 지원. 원본 재연결, 기존 로컬 기록 이전, 장기 단절 복구는 후속 범위.

## 2026-09-14 원본 재연결과 저장 결과 복구

- 전체 테스트 90개 통과. 인증·Origin·Host 제한, 원본 비전송, 경합, 만료 복구와 사용자 수정 차단을 확인했습니다.
- 실제 Codex 자료 실행: 작업 6cfde061-21e4-4697-aead-280f4b1e5a1e 완료, 답변 전력 단위: 와트(W), source-summary.md 생성. 원본 확인용 문자열이 클라우드 작업에 없음을 검사했습니다.
- 메모리 전용 UI fixture에서 실제 파일 선택 → 연결됨 표시 → 실행 → assistant 답변과 파일 표시를 확인했습니다. 실계정 AI 검증은 위 API 왕복과 별도로 수행했습니다.
- 장기 단절 복구는 시간 이동·경합 회귀 테스트로 검증했으며 실제 PC 종료 실험은 하지 않았습니다.

## 2026-09-14 기록 가져오기
- 실제 로컬 SQLite 조회 결과 이전 대상 0개. 사용자 기록을 불필요하게 복제하지 않았습니다.
- 실서버 검증 작업 912ad111-80fc-4b89-a02b-bf050c4c5a61: 첫 가져오기 created, 반복 skipped, 변경된 같은 ID conflict 확인. 결과 파일 보존 및 첨부 원본 확인 문자열 비저장 확인.
- 메모리 전용 UI에서 기존 로컬 기록 선택 → 체크 → 가져오기 → 가져옴 1 표시 확인.

## 2026-09-14 Interruption recovery

- 111 Node tests passed using node --test --test-isolation=none tests/*.test.mjs.
- Red-first regressions: Codex nonzero quota event, safe Claude 401/429, SQLite/D1 checkpoint preservation, native network errors, result retry without duplicate AI invocation.
- Independent review identified unavailable-runner checkpoint overwrite and coded-network bypass; both fixed and rechecked.
- Browser fixture: saved progress and separate quota guidance visible; fixture server and tab removed afterward.
- Worker deployed version 2f552957-4c29-497a-8df4-77e31baeb7df.
- Live authenticated synthetic task 4c69c65c-ea55-489e-b046-a28f014a4e08 verified checkpoint preservation, failure delivery idempotency, diagnostic exclusion, explicit resume; task cancelled afterward. AI invocations: zero.
- Desktop bridge restarted while idle. Real quota exhaustion and autonomous quota-reset resumption were not tested or claimed; automatic AI replay remains disabled.

## 2026-09-14 Bounded runtime output

- 121 tests passed. New cases cover 10,000 tool events, final answer and usage retention, split Korean JSONL, bounded diagnostic suffix, oversized single record, earlier actionable errors, first terminal failure, abort during overflow termination, and empty-only directory cleanup.
- Independent review found failure-selection and overflow/abort ordering regressions; both corrected and rechecked.
- Worker deployed version ad42c9b0-ae56-4baf-8ed5-64d5a592a9f4; desktop bridge restarted while idle.
- Real Codex subscription smoke task 262e7544-77a4-4fe4-9237-b05c80eb7251 completed with exact answer resource-check-ok, one persisted artifact, and zero remaining run folders for this task.
- The event collector retained under 500 characters in the synthetic long-stream test. This is a retained-output assertion, not an end-to-end speed or total process memory benchmark.
- Nonempty run directories remain intact. Child-process and tool memory/disk consumption are not globally capped by this change.

## 2026-09-20 Startup port conflict

122 tests pass. Real second launch at occupied4174 printed actionable guidance without a raw stack trace; existing authenticated desktop state remained HTTP200, idle and without pending output. Independent review found no material issues.4175 conflict closes only the lock newly acquired by that failed startup. No incumbent processes are terminated.

## 2026-09-20 Run storage management

-128 tests pass, including completed-run selection, metadata changes, junction exclusion, prevalidation of all targets, maintenance exclusion, pending-result protection, authentication and explicit deletion confirmation.
-Independent review found no material issues. Read-only inventory was subsequently placed under the same maintenance lock so it cannot delay an active runner heartbeat.
-Browser fixture verified usage/selection totals, protected items, file list expansion, confirmation-gated delete button, and confirmation reset when selection changes. No UI deletion was performed; filesystem removal tests used temporary fixtures only.
-Worker deployed version2b895cca-4fa7-4fae-b33b-7dddab01be11; idle desktop bridge restarted. Live read-only storage endpoint returned0 bytes,2 entries,2 completed eligible folders. User data deleted:0.
-Temporary UI server/script/tab removed after verification.

## 2026-09-21 Conditional state sync

- 134 tests pass, including retained task array on unchanged response, fresh connection metadata, out-of-order responses, overlapping revision responses, skipped SQLite/D1 task reads, and desktop cursor forwarding.
- Independent review found no material issues.
- Worker deployed version 3c5649b0-ca26-4eb4-9b59-03764ada6122; idle desktop bridge restarted.
- Live read-only check: cloud full13346 bytes versus unchanged188 bytes; desktop full13473 bytes versus unchanged315 bytes. Dynamic capabilities/presence/local status retained. These are response-body measurements for the current unchanged dataset, not overall speed or request-count benchmarks. No AI calls or user task mutations needed.

## 2026-09-21 — 선택 문헌 비교

- 전체 테스트 137개 통과(문헌 패킷·범위·재연결 식별·크기 검증 3개 추가).
- 격리된 메모리 서버 브라우저: 문헌 두 편 선택 → 초안/임시 자료 연결 → 작업 기록 확인.
- 실제 Codex 구독 실행: 가상 문헌 두 편으로 comparison.md, ideas.md, review.md 3개 저장. 작업 ID: 56a20cbf-9910-4076-a29e-d4488d9ef906. 실제 논문 연구 검증은 아님.
- 출력의 P1/P2, 10/20 W, 300/350 K, 반복 3/2회 및 조건 차이 한계 확인. 요청·대화·첨부 메타데이터에 가상 원문 미포함 확인.
- 검토 에이전트 호출 실패 후 작성 에이전트 자기검토로 완료; 독립 검토 성공으로 간주하지 않음. 자동 산출물 품질 판정은 후속 단계.
- Cloudflare 배포 ab370574-3142-45e5-ad2a-c25f5715ae30 및 배포된 모듈 응답 확인.

## 2026-09-21 — 문헌 결과 점검

- 5개 새 테스트: 정상/누락/빈 내용/중복/범위 밖 번호/선택 문헌 누락/이전 실행 제외/손상된 목록/base64/검토 실패(요약 포함).
- 실제 저장된 가상 문헌 결과를 임시 읽기 화면에서 확인: 문헌 결과 확인 필요와 검토 실패 경고 표시, 수정 요청 준비 클릭 후 초안만 생성. AI 재실행 없음.
- 코드 검토에서 발견한 실행 요약 실패 누락을 재현하고 수정함.
- 최종 전체 테스트 142개 통과, 구문 및 diff 검사 통과. Cloudflare 14c25d9e-a8c6-4a73-9769-e861c8513562 배포 및 최신 모듈 확인.
