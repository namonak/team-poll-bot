# 투표곰 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teams 단체 대화방의 투표 생성·응답 변경·실시간 집계·마감을 구현하고 배포 패키지와 README 제공.

**Architecture:** team-meal-bot의 Express/CloudAdapter 구조와 Node SQLite를 재사용한다. domain은 입력 검증, store는 트랜잭션, service는 권한·게시·갱신, cards는 화면, index/scheduler는 Teams와 주기 작업을 담당한다.

**Tech Stack:** Node 24 이상, TypeScript, Express, @microsoft/agents-hosting, node:sqlite, tsx --test, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-10-05-team-poll-bot-design.md`

## Global Constraints

- 콜네임 ‘투표곰’, 귀여운 한국어 존댓말, groupChat만 지원.
- 제목·항목 이름 1~100자, 후보 2~10개, URL 최대 2,048자, 전체 입력 8,000자.
- 작성자 전용 시작·마감, 투표자별 응답 교체, 마감 경계에서 즉시 거부.
- 내부 3978 / 호스트 3979, 별도 poll-data 볼륨, SQLite 경로 `/data/team-poll-bot.sqlite`.
- 날짜 재지정 없이 실제 시각 커밋, 메시지는 `유형(범위): 설명`.
- 사용자 요청에 따라 아이콘 완성 후 원본 이미지 삭제. 이후 Git에는 완성 아이콘만 포함.
- 사용자가 구현 진행을 요청했으므로 현재 세션에서 직접 전 작업 실행. 배포 자체는 수행하지 않음.

## Review Focus

- 불명확한 게시 실패는 중복 게시하지 않고 운영자 복구 대상으로 유지.
- 동시 생성 클릭과 폼 재전송이 투표를 추가 생성하지 않는지 확인.
- 응답 중 카드 갱신 실패와 마감이 겹쳐도 저장 응답·최신 버전 유지.
- JSON 필드 타입·다른 대화방·변조 항목 등 신뢰 경계에서 거부.
- 12월/윤년/마감 직전·정각과 이름·링크의 마크다운 삽입 확인.

## Task 1: 명령·검증·영속 투표

**Files:** `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, `src/domain.ts`, `src/store.ts`, `test/domain.test.ts`, `test/store.test.ts`.

**Interfaces:** `parseCommand(text)` → 도움말/폼 초기값, `validatePoll(input, now)` → 정규화 설정, `parseDeadline(text, now)` → UTC ISO 또는 null. `Store.open(path)` → DB, `createDraft(conversationId, ownerId, now)` → 초안, `createPoll(draftId, ownerName, config)` → 투표, `getPoll(id)` → 옵션·응답을 포함한 저장 투표, 응답/마감/게시 상태 변경 트랜잭션.

- [x] 명령·마감·투표 검증의 실패 테스트 작성 및 실행. 특히 `2026-12-31`에서 다음 해 날짜, 2월 30일, 따옴표, 악성 URL 검증.
- [x] 최소 순수 함수와 SQLite 모델 구현. 중복 draft ID로 기존 투표 반환, 응답 교체와 revision 증가 원자성.
- [x] 재개방 DB에서 응답 유지와 만료 초안 검증, npm test/typecheck 실행.
- [x] `feat(투표): 명령 파싱과 투표 저장소를 구현` 커밋.

## Task 2: 카드·서비스·Teams 연결

**Files:** `src/cards.ts`, `src/service.ts`, `src/scheduler.ts`, `src/index.ts`, `test/cards.test.ts`, `test/service.test.ts`, `test/index.test.ts`.

**Interfaces:** `buildCreateCard(draftId, prefill)` / `buildPollCard(poll)` → AdaptiveCard 1.5. `PollService.createDraft`, `create`, `vote`, `close`, `refresh`, `runScheduledTasks`는 저장소를 사용하고 전송·갱신만 외부 콜백으로 실행. `createApp()`는 필수 인증값 검증 후 JWT를 적용한 Express 앱 반환.

- [x] 작성자·대화방 권한, 중복 제출, 응답 변경, 복수 집계·동률, 마감, 갱신 실패·동시 갱신의 실패 테스트 작성.
- [x] 카드 생성과 서비스의 투표별 순차 게시·갱신 구현. 모호한 게시 실패는 자동 재게시하지 않음.
- [x] Teams 메시지/Action.Execute 연결, 저장한 대화 참조로 마감·갱신 재시도, 인증 누락 시 실패.
- [x] npm test/typecheck 및 tsc 빌드 확인 후 `feat(투표곰): 생성 폼과 실시간 투표 카드를 연결` 커밋.

## Task 3: 아이콘·Teams 패키지·배포

**Files:** `appPackage/{manifest.json,color.png,outline.png}`, `scripts/package-teams-app.sh`, `.env.example`, `.dockerignore`, `Dockerfile`, `compose.yaml`, `deploy/team-poll-bot.service`, `test/package-teams-app.test.ts`.

**Interfaces:** 명령 제안은 manifest commandLists, 패키지 스크립트는 환경 설정의 앱 ID를 치환해 dist ZIP 생성. 컨테이너는 `node dist/index.js` 실행.

- [ ] ZIP 구성·명령·ID 치환·아이콘 크기 검증 테스트를 먼저 작성·실행.
- [ ] ImageGen으로 컬러 아이콘 제작, 단순 흰색 외곽선 PNG 제작, 실제 크기 확인. 원본은 검증 후 삭제.
- [ ] 참조 배포 파일과 패키징 스크립트를 투표곰 이름/포트/DB로 적용.
- [ ] npm test/typecheck/build, 가능하면 Compose 설정·Docker 빌드 확인 후 `feat(배포): 투표곰 아이콘과 Teams 패키지를 추가` 커밋.

## Task 4: README와 최종 검토

**Files:** `README.md`, 이 계획의 체크 상태.

- [ ] `../team-meal-bot/README.md` 형식을 참고하여 기능, 명령·마감 문법, NAS 배포, Teams 등록, 백업·게시 오류 복구, 테스트 절차 작성.
- [ ] 전체 테스트/typecheck/build/패키지 검증 결과와 실제 Teams 검증의 미실행 범위를 기록.
- [ ] 새 검토자가 전체 변경을 검토하고 중요한 결함은 테스트로 재현 후 수정.
- [ ] `docs(운영): 투표곰 배포와 사용 방법을 안내` 커밋, 현재 시각과 작업 단위 커밋 확인.
