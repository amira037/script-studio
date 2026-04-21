# Script Studio — CLAUDE.md

## 프로젝트 개요

단일 HTML 파일 앱. 대본 작가를 위한 AI 협업 도구.

- **파일**: `index.html`
- **구조**: 플로(AI 채팅) / 픽(스토리보드) / 라인 에디터(대본 편집) 3탭

---

## 전역 상태 (`S` 객체)

```js
S = {
  cur: {                          // 현재 프로젝트
    title: "",
    synopsis: "",
    scenes: [],                   // 씬 배열 (대안 씬 포함)
    characters: [],               // 등장인물 카드
    messages: [],                 // 플로 채팅 히스토리 (assistant만 저장)
    chatMemos: [],                // 평탄화 결정사항
    chatMemosStructured: {        // 구조화 결정사항
      setting: [], characters: [], story: [], twist: []
    },
    conflictData: { scenes: [] }  // 갈등도 캐시 (draft 씬 제외)
  },
  selectedIds: Set,               // 라인 에디터 선택된 씬 ID
  activeTab: 'script'|'chat'|'pick',
  _skipAnalysisRoute: false,
  _skipBrainCheck: false,
  _skipOrCheck: false
}
```

> **주의**: `S.cur.messages`는 assistant 응답만 저장. user 메시지는 `callClaudeStream`에 직접 전달(`[...history, {role:'user', content:text}]`) 하므로 중복 저장 없음.

---

## 씬 오브젝트

```js
{
  id: Number,           // unique timestamp ID
  title: String,
  slug: String,         // INT./EXT. 장소 - 시간 (연극/뮤지컬: "N막 N장")
  lines: [{
    type: "action|character|dialogue|parenthetical|slug|lyric",
    text: String,
    locked: Boolean,
    keyline: Boolean,   // 중요 대사
    aiSelected: Boolean // AI 작성 모드 선택 상태
  }],
  draft: Boolean,       // 대안 씬 여부
  draftOf: Number,      // 원본 씬 ID (대안일 때)
  collapsed: Boolean,
  locked: Boolean,      // 씬 전체 잠금
  // 연극/뮤지컬 서브씬 필드
  parentId: Number|null,      // 서브씬이면 부모씬 id, 최상위 씬은 null
  subOrder: Number,           // 같은 부모 내 순서 (0-based), 최상위 씬은 0
  subSceneType: String|null,  // 연극: 'dialogue'|'conflict'|'turn' / 뮤지컬: 'dialogue'|'number'|'transition'
  summary: {
    conflictScore: Number|null,  // 0~5 갈등도
    dialogueCount: Number,
    lineCount: Number
  },
  diff: {               // 보류 중인 수정 제안
    prompt: String,
    lines: [{type:"del|add|ctx", text}],
    newLines: [...],
    comment: String,
    mergeDeleteIds: [Number],  // 합치기 시 삭제할 씬 ID
    mergeDeleteId: Number      // legacy
  } | null,
  _copySelected: Set    // SHIFT+클릭 복사 선택된 라인 인덱스 (런타임 전용, 저장 안 함)
}
```

### 씬 레이블 규칙
- 일반 씬: `SC 1`, `SC 2`, ...  (draft 제외하고 순서대로 번호, 서브씬 제외)
- 대안 씬: `SC 3-A`, `SC 3-B`, ... (원본 번호 + 알파벳 suffix)
- 서브씬: `SC 1-1`, `SC 1-2`, ... (부모 레이블 + 순서)
- 서브씬 대안: `SC 1-1-A` (서브씬 레이블 + 알파벳 suffix)
- **항상 `getSceneLabel(sc, scenes)` 사용** — 배열 인덱스 직접 접근 금지

### 연극/뮤지컬 헬퍼 함수
```js
const isTheatricalProject = () => ['연극', '뮤지컬'].includes(S.cur?.medium);
const isMusicalProject    = () => S.cur?.medium === '뮤지컬';
const isPlayProject       = () => S.cur?.medium === '연극';
```

- **서브씬 분할**: 씬 헤더 우클릭 → '서브씬으로 나누기' → `splitIntoSubScenes(scId)`
- **서브씬 병합**: 부모씬 헤더 우클릭 → '서브씬 합치기' → `mergeSubScenes(parentId)`
- **드래그**: 서브씬은 같은 부모 내에서만, 부모씬은 서브씬 블록 함께 → `moveSceneWithChildren`
- **갈등도**: 부모씬 = 서브씬 최고값으로 집계 (`checkConflictWithPrompt` 후처리)
- **`<subscenes>` 태그**: 연극/뮤지컬 모드에서 AI가 씬 생성 시 사용 (`<scenes>` 대신)

---

## 계정 / 유저 시스템

```js
// 우선순위: URL ?user=xxx > localStorage('ss_current_user') > 로그인 화면
const USER_ID = _urlUser || _savedUser || null;
const IS_ADMIN = USER_ID === 'admin';

const KNOWN_ACCOUNTS = [
  { id: 'me',       label: '나',    icon: '🙂' },
  { id: 'director', label: '대표',  icon: '🎬' },
  { id: 'admin',    label: '관리자', icon: '🔑' },
];
```

- **첫 방문 or 계정 미설정**: `showLoginScreen()` → 계정 선택 → `localStorage('ss_current_user')` 저장 → reload
- **URL 파라미터 사용 시**: 자동으로 `ss_current_user`에 저장 → 다음 방문부터 파라미터 불필요
- **계정 전환**: 설정 패널 → "계정" 섹션 → "전환" 버튼 → `switchAccount()` → localStorage 제거 → 로그인 화면
- **로컬 저장키**: `ss_projects_me`, `ss_projects_director` 등 유저별 분리 (`_storageKey(key)`)
- **admin**: 모든 유저 프로젝트 읽기 전용 조회, 로컬 저장 없음

| 함수 | 역할 |
|------|------|
| `showLoginScreen()` | 계정 선택 풀스크린 오버레이 표시 |
| `selectAccount(id)` | 계정 선택 → localStorage 저장 → reload |
| `switchAccount()` | localStorage 제거 → 로그인 화면으로 |
| `_updateAccountLabel()` | 설정 패널 현재 계정 레이블 갱신 |

---

## 자동 저장 / Supabase 동기화

### 동기화 토글 (설정 패널 → 데이터 저장)

```js
const isSyncEnabled = () => localStorage.getItem('ss_sync_enabled') !== 'false';
// 기본값: true (ss_sync_enabled 키가 없으면 켜짐)
```

- **`toggleSyncEnabled()`**: localStorage에 `ss_sync_enabled` 저장 → UI 갱신 → toast
  - 켜짐: `'☁️ 클라우드 동기화 켜짐'`
  - 꺼짐: `'🔌 클라우드 동기화 꺼짐'`
- **`_updateSyncToggleUI()`**: 상태 점(초록/빨강), 레이블, 토글 버튼 텍스트, ↻ 버튼 활성화 동기화
- 설정 패널 열 때 `_updateSyncToggleUI()` 자동 호출

### 저장 로직

- **`storage.set`**: localStorage 저장 → `isSyncEnabled()` 체크 → 켜짐이면 `syncToSupabase()` 호출
  - `ss_projects` 저장 시 `ss_local_save_time` (타임스탬프) 동시 기록
- **`syncFromSupabase(force=true)`**: `isSyncEnabled()` false면 즉시 return. 앱 시작 500ms 후 호출
  - `remoteTime >= localSaveTime - 3000` → 원격 데이터로 덮어씀
  - 로컬이 더 최신 → Supabase에 로컬 재업로드 (데이터 손실 방지)

---

## 주요 함수 레퍼런스

### 라우팅 / 처리

| 함수 | 역할 |
|------|------|
| `handleScriptPrompt(text)` | 라인 에디터 프롬프트 메인 핸들러 |
| `handleChatPrompt(text, _skipAnalysisRoute=false, _forceIntent=null)` | 플로 채팅 메인 핸들러 |
| `handleChoiceResult(choice, intent)` | Survey/Choice 완료 후 intent 기반 자동 처리 |
| `haikusRoute(text)` | Haiku로 요청 분류 → cmd 반환 |
| `floRoute(text)` | Haiku로 플로 요청 의도 분류 → `{intent, sceneCount, isTheatrical}` |
| `dispatchCmd(cmd, text, source)` | cmd에 따라 적절한 핸들러 실행 |
| `normalizeSceneNums(text)` | 씬 표현 → SC번호 형식 변환 (합치기/참조 요청은 스킵) |
| `handleWebSearch(text)` | 웹 검색 (`web_search_20250305` tool) |
| `buildProjectContext()` | 프로젝트 메타(제목, 장르, 인물, 씬 목록, 시놉시스) 문자열 반환 |
| `buildCompressedHistory()` | 최근 4000자 이내 메시지 히스토리 + 초과분 Haiku 요약 |
| `getChatMemos()` | 구조화 결정사항 플랫 배열 반환 |
| `getRecentFloContext(maxMsgs=12)` | 최근 플로 대화 → "작가/플로: ..." 형식 |
| `autoExtractMemoFromHistory()` | 최근 대화에서 결정사항 자동 추출 → `chatMemosStructured`에 병합 |

### 씬 편집

| 함수 | 역할 |
|------|------|
| `applyDiff(id)` | diff 적용 + 합치기 시 뒷장면 삭제 |
| `applyDiffOnly(id)` | diff만 적용 (합치기 시 뒷장면 유지) |
| `cancelDiff(id)` | diff 취소 |
| `saveAsDraft(id)` | 현재 씬의 diff를 대안 씬으로 저장 (원본 바로 아래 삽입) |
| `buildDiffBlock(sc)` | diff UI DOM 생성 |
| `splitSceneAt(sc, lineIdx)` | lineIdx 이후를 새 씬으로 분리 |

### 씬 추가 / 삽입

| 함수 | 역할 |
|------|------|
| `showAiSceneAddPanel()` | AI 씬 추가 패널 (유형 선택 + 프롬프트 입력) |
| `confirmAiSceneAdd()` | 선택 → 위치 추천 → 생성 |
| `execAiSceneAdd(refScId, hintVal, useRef, userPrompt)` | 실제 생성 실행 |
| `handleAiSceneAdd(hint, forcedRefSc, ...)` | Claude API 호출 + 씬 생성 |
| `showNewSceneInsertPanel(scenesData, msg, refSc, ...)` | 새 씬 미리보기 패널 |
| `addSceneAt(title, afterId, slug)` | 씬 추가 (빈 씬) |
| `insertSceneAtPosition(title, lines, afterId, isFirst)` | 씬 삽입 |
| `showSmartSceneAddPanel(scenesData)` | 씬 추가 위치/방식 선택 패널 |

### 씬 합치기

| 함수 | 역할 |
|------|------|
| `handleSceneMerge(text)` | 합치기 메인 핸들러 — 대상 감지 + 검증 |
| `executeMerge(targetScenes)` | Claude API 호출 → diff 생성 |

**합치기 제약:**
- 대안 씬 + 일반 씬 혼합 선택 시 차단
- 같은 원본의 대안 씬끼리(`allSameSeries`)는 배열 위치 무관하게 연속으로 간주 → 합치기/참조 허용
- `selectedIds.size >= 2` → normalizeSceneNums 스킵 (한/두 → SC1/2 오변환 방지)

### 참조 씬 생성

| 함수 | 역할 |
|------|------|
| `handleRefSceneCreate(text)` | 선택된 씬들을 참조해서 새 씬 생성 |

- `handleScriptPrompt` 진입 직후 (normalizeSceneNums 호출 전) 감지
- 조건: `참조해서|참고해서|바탕으로|토대로` + `써줘|만들어|새.*씬|작성` + `selectedIds.size >= 2`

### 대안(Draft) 씬

| 함수 | 역할 |
|------|------|
| `compareDraftScene(draftId)` | 원본 + 모든 형제 대안 비교 분석 (AI 패널) |
| `_selectDraftVersion(originalId, winnerDraftId)` | 버전 선택 → 원본 교체 + 나머지 삭제 |
| `applyDraftToOriginal(draftId)` | 대안을 원본으로 교체 |
| `promoteDraftToScene(draftId)` | 대안을 독립 씬으로 승격 |
| `deleteDraft(draftId)` | 대안 삭제 |

**규칙:**
- 흐름/갈등 분석에서 자동 제외 (`scenes.filter(s=>!s.draft)`)
- `compareDraftScene` 호출 시 항상 전체 갈등도 재계산
- 비교 패널 버튼 순서: `[원본 유지]` → `[대안 선택]` → `[선택한 장점으로 새로 쓰기]` → `[닫기]`

### UI

| 함수 | 역할 |
|------|------|
| `showResponsePanel(type, title, bodyHTML, actsHTML)` | AI 제안/선택 패널 표시 |
| `closeResponsePanel()` | 패널 닫기 |
| `showTyping()` | 채팅 로딩 인디케이터 표시 |
| `hideTyping()` | 로딩 인디케이터 숨김 |
| `showStreamBubble()` | 실시간 스트리밍 버블 생성 |
| `updateStreamBubble(text)` | 스트리밍 중 버블 텍스트 갱신 (태그 제거 후 표시) |
| `hideStreamBubble()` | 스트리밍 버블 제거 |
| `showAnalyzing(text)` / `hideAnalyzing()` | 분석 중 오버레이 |
| `toast(msg, duration, undoFn, undoLabel)` | 하단 토스트 메시지 |
| `addMsg(role, text, actions)` | 채팅 메시지 추가 (S.cur.messages push + UI 렌더) |
| `appendMsgEl(msg, scroll)` | 채팅 버블 UI 렌더만 (저장 없음) |
| `renderChatMsgs()` | S.cur.messages 전체 재렌더 |
| `openMemoPanel()` | 플로 탭 전환 + 결정사항 패널 열기 + 스크롤 |
| `switchTab(tab)` | "script" / "chat" / "pick" 탭 전환 |
| `scrollToScene(id)` | 씬으로 스크롤 |
| `renderScriptBody()` | 라인 에디터 전체 재렌더 |
| `renderNavSceneList()` | 네비게이터 재렌더 |
| `showLoginScreen()` | 계정 선택 풀스크린 오버레이 |
| `toggleVoiceInput()` | Web Speech API 음성 입력 토글 (ko-KR) |
| `toggleSyncEnabled()` | 클라우드 동기화 ON/OFF 토글 |
| `_updateSyncToggleUI()` | 설정 패널 동기화 UI 상태 반영 |

---

## 라인 에디터 AI 요청 흐름

```
handleScriptPrompt(text)
  ↓
0. 참조 씬 요청? (참조해서+써줘 등 + selectedIds≥2)
   → handleRefSceneCreate 즉시 호출, normalizeSceneNums 스킵
  ↓
1. 합치기 요청? → normalizeSceneNums 스킵
2. normalizeSceneNums(text) — draft 제외 목록, getSceneLabel 기반
3. selectedIds가 있으면 "SC N, SC M-A" 텍스트에 자동 주입
4. 키워드 1차 감지
   - 합치기 → handleSceneMerge
   - 새 씬 삽입 → handleSceneInsertPrompt
   - 씬 분석 → haikusRoute → dispatchCmd
5. 편집 의도 → 선택된 씬 수집 + 시스템 프롬프트 구성
   ├── getChatMemos()         → [핵심 결정사항]
   ├── getRecentFloContext()  → [플로 대화] (키워드 감지 시)
   ├── fullSceneList          → [전체 씬 목록]
   └── sceneSummary           → [편집 가능한 씬 데이터 + sceneId]
6. callClaude → <r>[{sceneId, title, lines, comment}]</r> 파싱
7. 각 씬에 diff 적용 → renderScriptBody
```

**플로 컨텍스트 주입 트리거 키워드:**
`플로 참고`, `플로 제안`, `플로 이야기`, `플로 대화`, `위에서 말한`, `앞에서 얘기`, `플로 선택`, `옵션 방향`

---

## 플로 채팅 AI 흐름

### handleChatPrompt 시그니처
```js
async function handleChatPrompt(text, _skipAnalysisRoute = false, _forceIntent = null)
```

- `_skipAnalysisRoute`: true면 haikusRoute 분석 키워드 체크 스킵 (survey/choice 완료 후 사용)
- `_forceIntent`: null이 아니면 floRoute 호출 스킵, 해당 intent를 tagRule에 직접 적용

### 처리 흐름

```
handleChatPrompt(text, skipAnalysis, forceIntent)
  ↓
P1: pending approveSequence 있고 자연어로 승인 → handleMsgAction 즉시 실행
  ↓
분기 체크 (skipAnalysis=false일 때):
  - 막혔어 → showStuckPanel
  - 웹 검색 키워드 → handleWebSearch
  - 시퀀스 제안 키워드 + 씬 있음 → showSequenceSuggestPanel
  - 분석 키워드 → haikusRoute → conflict/flow/emotion/...
  ↓
floRoute (forceIntent가 있으면 스킵) → _floIntent, _floSceneCount, _floIsTheatrical
  ↓
tagRule 결정:
  - write_multi/write_single/structure → 씬 태그 적극 사용 지시
  - brainstorm/chat + 씬≥4개 → 씬 액션 태그 금지
  ↓
_useSeqMode 체크 (write_multi + 씬≥3개 or 연극/뮤지컬) → handleFloWriteMultiSeq
  ↓
callClaudeStream → 실시간 스트리밍
  ↓
태그 파싱 → actions 배열 구성 → addMsg('assistant', displayText, actions)
  ↓
자동 패널 오픈: survey > multichoices > choices 우선순위
```

### floRoute 의도 분류

| intent | 조건 | 효과 |
|--------|------|------|
| `write_multi` | 씬 여러 개 구성/전체 구조 요청 | `<sequence_titles>` / `<newscenes>` 태그 적극 사용 |
| `write_single` | 특정 씬 하나 작성 | `<newscenes>` 사용, 토큰 상향 |
| `structure` | 전체 구조/시퀀스 논의 | `<sequence_titles>` 사용 |
| `brainstorm` | 아이디어/방향 논의 | 씬≥4개면 씬 액션 태그 금지 |
| `chat` | 일반 대화, 피드백 | 씬≥4개면 씬 액션 태그 금지 |

**직전 AI 응답에 `<sequence_titles>` 있으면 write_multi/structure 우선 분류**

### 모델/토큰 선택

| 조건 | 모델 | 토큰 |
|------|------|------|
| write_single/write_multi | claude-sonnet-4-20250514 | 10000 |
| needsMore (씬 재구성) | haiku | 4000 |
| 일반 | claude-haiku-4-5-20251001 | 2000 |
| floRoute/haikusRoute | claude-haiku-4-5-20251001 | 60~150 |

---

## Survey / Choices 흐름

### 전체 흐름

```
handleChatPrompt → AI 응답에 <survey>/<choices>/<multichoices> 태그
  ↓
_floIntent를 태그 데이터와 함께 저장 (action.data.intent / action.intent)
  ↓
자동 오픈: showSurveyPanel(questions, intent)
         showChoicesPanel(prompt, choices, intent)     → showSurveyPanel 위임
         showMultiChoicesPanel(prompt, choices, intent) → showSurveyPanel 위임
                                                          (씬 구간이면 별도 패널 유지)
  ↓
_surveyState = { questions, answers, currentStep, intent }
  ↓
사용자가 스텝별 답변 → _surveyStepDone → chatMemos에 저장
  ↓
마지막 스텝 완료 → _onSurveyComplete → handleChoiceResult(summaryText, intent)
  ↓
handleChoiceResult:
  1. appendMsgEl({ role:'user', text:choice }) — UI 표시 (addMsg 아님 → 중복 방지)
  2. handleChatPrompt(choice, true, intent) — floRoute 스킵, intent 강제 적용
```

### _surveyState 구조

```js
_surveyState = {
  questions: [{ q, type: 'choice'|'multi'|'text', options?: [] }],
  answers: [],          // 각 스텝 답변 (null = 미응답)
  currentStep: 0,
  intent: string|null   // floRoute에서 저장된 intent
}
```

### Survey 패널 스텝 타입

| type | UI | 동작 |
|------|----|------|
| `choice` | 단일 선택 버튼 목록 + 직접 입력 | 선택 즉시 다음 스텝 |
| `multi` | 체크박스 목록 | 확인 버튼으로 다음 스텝 |
| `text` | textarea | 저장 후 다음 버튼 |

**다중 질문 시 내비게이션(← →) 표시. 건너뛰기 버튼 제공.**

### AI 태그 사용 규칙

```
<choices>["옵션1","옵션2"]</choices>              — 질문 하나, 단일 선택
<multichoices>["옵션1","옵션2"]</multichoices>    — 복수 선택
<survey>[{"q":"질문","type":"multi","options":[]},
         {"q":"질문","type":"choice","options":[]},
         {"q":"질문","type":"text"}]</survey>     — 복수 질문 필수
```

**type 우선순위:**
- 인물 성격/특성/배경, 분위기/톤/장르 → `multi` 우선
- 구조/방향 중 하나만 → `choice`
- 자유 서술 → `text`

### action 버튼에서 패널 재오픈 (handleMsgAction)

```js
// showChoices: intent 있으면 showChoicesPanel, 없으면 씬 구간 전용 패널
action.data.intent
  ? showChoicesPanel(prompt, choices, intent)
  : /* 씬 구간 selectSceneChunk 패널 */

// showMultiChoices
showMultiChoicesPanel(action.data.prompt, action.data.choices, action.data.intent)

// openSurvey
showSurveyPanel(action.data, action.intent)
```

---

## 라인 에디터 우클릭 메뉴 (showTypeMenu)

### 일반 모드 (aiSelected 없음)

| 항목 | 동작 |
|------|------|
| 타입 4개 버튼 (지문/배역명/대사/(지문)) | 현재 줄 타입 변경 |
| ↑ 위 삽입 / ↓ 아래 삽입 | 빈 줄 삽입 |
| 줄 삭제 / 단락 삭제 | 삭제 |
| ✂ 여기서 씬 나누기 | `splitSceneAt(sc, li)` (li > 0일 때만) |
| ☑ 줄 선택 | aiSelected 모드 진입 |
| **복사** / **붙여넣기** | `window._lineClipboard` 사용, SHIFT 선택 줄 있으면 일괄 복사 |

- **복사**: `sc._copySelected.size > 0`이면 선택된 줄들 복사, 없으면 현재 줄(li) 1개
- **붙여넣기**: `window._lineClipboard` 있으면 li+1 위치에 삽입, 없으면 비활성(회색)
- 복사 후 toast: `'📋 N줄 복사됨'` (2000ms)

### 선택 모드 (aiSelected 있음)

| 항목 | 동작 |
|------|------|
| ↑ 위 삽입 / ↓ 아래 삽입 | 선택 줄 수만큼 삽입 |
| 줄 삭제 / 단락 삭제 | 선택 범위 삭제 |
| ✨ AI 줄 삽입 | `handleFillSingleLine` 호출 |
| ☑ 선택 해제 | aiSelected 모드 해제 |
| **복사 (N줄)** | aiSelected 줄 전체 `_lineClipboard`에 복사 |

---

## 줄 복사/붙여넣기 (내부 클립보드)

### SHIFT+클릭 복사 선택

```js
// lw(라인 래퍼) mousedown 이벤트
if (e.target === el || el.contains(e.target)) return; // 같은 줄 편집 중이면 텍스트 선택 허용
if (document.activeElement?.contentEditable === 'true') document.activeElement.blur(); // 다른 줄 편집 중이면 blur 후 진행
e.preventDefault();
sc._copySelected.add(li) / sc._copySelected.delete(li); // 토글
```

- `sc._copySelected`: 씬별 선택된 라인 인덱스 Set
- 선택 시 라인 래퍼에 파란 테두리 + 배경 표시
- 1개 이상 선택 시 toast: `'Cmd+C로 복사 (N줄 선택됨)'` (3000ms, ✕ 취소 버튼)

### Cmd+C 키보드 복사

```js
document.addEventListener('keydown', (e) => {
  // script 탭 + metaKey/ctrlKey + 'c' + _copySelected 있는 씬 존재 시
  → window._lineClipboard 저장 → 선택 해제 → toast '📋 N줄 복사됨'
});
```

### 붙여넣기

- **Cmd+V**: contenteditable paste 이벤트 — `window._lineClipboard` 있으면 li+1 위치에 삽입
- **우클릭 메뉴 붙여넣기**: li+1 위치에 삽입

### clearCopySelection()

모든 씬의 `_copySelected` 초기화 + 하이라이트 제거 + ESC 키 처리

---

## 메시지 액션 버튼 타입 (handleMsgAction)

| type | 동작 | 스타일 |
|------|------|--------|
| `saveSynopsis` | 시놉시스 저장 | - |
| `saveSynopsisWithSequence` | 시놉시스 저장 + 시퀀스 버튼 | green |
| `approveSequence` | showApproveSequencePanel | purple |
| `addScenes` | showSmartSceneAddPanel | purple |
| `pickSceneIdea` | showSceneIdeaCards | blue |
| `addCharacters` | addCharsFromAI | purple |
| `openSurvey` | showSurveyPanel(data, intent) | - |
| `showChoices` | intent 있으면 showChoicesPanel, 없으면 씬 구간 패널 | purple |
| `showMultiChoices` | showMultiChoicesPanel(prompt, choices, intent) | purple |
| `suggestAnalysis` | conflict/synopsis/characters 분석 후 원래 프롬프트 재처리 | amber |
| `gotoScriptEdit` | showSceneEditBranchPanel | amber |
| `deleteSceneSuggest` | confirm 후 씬 삭제 | red |
| `moveSceneSuggest` | 네비게이터 드래그 안내 toast | blue |
| `reorderScenes` | showReorderPreviewModal | blue |

---

## AI 시스템 프롬프트 태그 규칙

### 플로 응답 태그 전체 목록

| 태그 | 용도 | 처리 |
|------|------|------|
| `<synopsis>` | 시놉시스 제안/수정 | saveSynopsis 액션 버튼 |
| `<sequence_titles>[{title,slug,hint}]` | 씬 제목 구조 제안 | approveSequence 액션 버튼 |
| `<newscenes>[{title,slug,lines}]` | 씬 내용 생성 | addScenes 액션 버튼 |
| `<scenes>[JSON]` | 씬 배열 | addScenes 액션 버튼 |
| `<scene_ideas>[{title,idea,mood}]` | 씬 아이디어 카드 3개 | pickSceneIdea 액션 버튼 |
| `<characters>[JSON]` | 등장인물 배열 | addCharacters 액션 버튼 |
| `<character>{JSON}` | 단일 인물 설정 | floDetectContent → showCharacterAddPanel |
| `<setting_update>` | 인물 설정 변경 | floDetectContent |
| `<editscenes>SC번호들` | 수정 필요 씬 표시 | gotoScriptEdit 액션 버튼 |
| `<deletescene>SC번호` | 씬 삭제 제안 | deleteSceneSuggest 액션 버튼 |
| `<movescene>SC번호→위치` | 씬 이동 제안 | moveSceneSuggest 액션 버튼 |
| `<reorderscenes>[JSON]` | 전체 순서 재배치 | reorderScenes 액션 버튼 |
| `<choices>[JSON]` | 단일 선택지 | showChoicesPanel 자동 오픈 |
| `<multichoices>[JSON]` | 복수 선택지 | showMultiChoicesPanel 자동 오픈 |
| `<survey>[JSON]` | 다중 질문 | showSurveyPanel 자동 오픈 |
| `<suggest>conflict/synopsis/characters` | 분석 버튼 제안 | suggestAnalysis 액션 버튼 |

### 태그 사용 금지/제한 조건

- `<suggest>characters/conflict`: 씬 없을 때 금지
- 씬 액션 태그(`<sequence_titles>`, `<newscenes>`, `<editscenes>`): brainstorm/chat intent + 씬≥4개면 금지
- `<survey>` vs `<choices>`: 질문 2개 이상은 반드시 `<survey>` 사용

---

## 네비게이터 렌더링 순서

`renderNavSceneList`는 **그룹 순서**로 표시 (배열 순서 아님):
1. 일반 씬 렌더
2. 해당 씬의 대안 씬들 즉시 렌더
3. 고아 대안 씬(원본 없음) 맨 뒤

→ SC 5-A는 항상 SC 5 바로 아래. SC 6이 사이에 끼어들 수 없음.

---

## 갈등도 관련 규칙

- **전역 갈등 분석** (`checkConflictWithPrompt`): `!s.draft` 필터로 일반 씬만 분석
- **`conflictData.scenes`**: 일반 씬만 포함
- **비교 시 갈등도**: `compareDraftScene`에서 매번 전체 재계산 (대안 포함)
- **갈등 그래프**: `renderConflictBody`, `openConflictModal` 모두 draft 씬 명시적 필터 적용

---

## Claude API 호출

```js
callClaude(messages, systemPrompt, maxTokens, model)
callClaudeStream(messages, systemPrompt, maxTokens, model, onChunk)
// onChunk: (chunk, done) => void — done=true면 스트리밍 완료
```

**모델 상수:**
- 메인: `'claude-sonnet-4-20250514'`
- 경량/라우팅: `'claude-haiku-4-5-20251001'`

---

## CSS / UI 스타일

### 라인 에디터 텍스트 색상
```css
.line-character     { font-weight:600; color:#f0ece6; }
.line-dialogue      { color:#eae6e0; }
.line-action        { color:var(--text2); font-style:italic; }
.line-parenthetical { color:var(--text3); font-style:italic; }
.line-slug          { color:var(--accent); font-weight:600; }
```

### 색상 변수
```css
--text:#e2e0da;   --text2:#9a9890;  --text3:#5a5855;
--accent:#c8a96e; --accent2:#8b6e42; --accent3:rgba(200,169,110,0.12);
--bg:#0e0e10;     --bg2:#141416;    --bg3:#1a1a1e;
--border:rgba(255,255,255,0.08);    --border2:rgba(255,255,255,0.12);
--red:#e05555;    --green:#4caf7d;  --blue:#4a9eff;
```

---

## 주의사항 / 알려진 패턴

1. **sceneId vs SC번호**: AI 편집 응답은 반드시 `sceneId` (숫자 ID). `SC 1` 형식은 참조용
2. **배열 인덱스 직접 사용 금지**: 씬 번호는 항상 `getSceneLabel()` 경유
3. **normalizeSceneNums 씬 목록**: `scenes.filter(s=>!s.draft)` + `getSceneLabel` 필수
4. **대안 씬 분석 제외**: 흐름/갈등/일관성 분석 시 `scenes.filter(s=>!s.draft)` 적용
5. **합치기 오변환 방지**: "한 장면/두 장면" 등 → merge/ref 요청 시 normalizeSceneNums 스킵
6. **같은 계열 대안 합치기**: `allSameSeries` 플래그로 연속 체크 우회
7. **청크 처리**: 씬 6개 이상 편집 → 3씬씩 나눠 처리, 각 청크에 memoCtx + floCtxBlock 동일 적용
8. **save() / save(true)**: `save(true)` = 렌더 없이 저장만
9. **USER_ID const**: 파일 로드 시 확정. 계정 전환은 반드시 `location.reload()` 필요
10. **메시지 히스토리**: user 메시지는 `S.cur.messages`에 저장 안 함. `appendMsgEl`로 UI 표시만 가능
11. **handleChoiceResult의 addMsg 제외**: `appendMsgEl`만 호출해서 user 버블 표시 (addMsg하면 history에 중복 → API 호출 시 user 메시지 2회 전달)
12. **`_memoSame` 중복 체크**: 첫 키워드(구분자 이전) 기반 — 인물명 같으면 내용 달라도 중복 판단
13. **Supabase 동기화 꺼짐 상태**: 로컬 저장은 정상 작동, 클라우드 업/다운만 중단

---

## 수정 이력 (현재 버전 기준)

| 위치 | 내용 |
|------|------|
| `handleChatPrompt` | 3번째 파라미터 `_forceIntent` 추가 — Survey/Choice 완료 시 floRoute 스킵 |
| `handleChoiceResult` (신규) | Survey/Choice 완료 후 intent 기반 자동 처리 함수 |
| `showSurveyPanel` | `intent` 파라미터 추가 → `_surveyState.intent` 저장 |
| `showChoicesPanel` / `showMultiChoicesPanel` | `intent` 파라미터 추가 → showSurveyPanel 위임 |
| `_onSurveyComplete` | `handleChatPrompt` 직접 호출 → `handleChoiceResult` 경유로 변경 |
| `handleMsgAction showChoices` | intent 있으면 showChoicesPanel, 없으면 씬 구간 패널로 분기 |
| `handleMsgAction openSurvey` | `action.intent` 전달 |
| `handleMsgAction showMultiChoices` | `action.data.intent` 전달 |
| choices/multichoices/survey 생성 | `_floIntent` 저장 (`action.data.intent` / `action.intent`) |
| `isTheatricalProject` / `isMusicalProject` / `isPlayProject` (신규) | 연극/뮤지컬 모드 판별 헬퍼 |
| `getSceneLabel` | 서브씬(`SC 1-1`), 서브씬 대안(`SC 1-1-A`) 레이블 추가 |
| `splitIntoSubScenes` / `showSubSceneSplitPanel` / `applySubSceneSplit` / `mergeSubScenes` (신규) | 서브씬 분할·병합 |
| `moveSceneWithChildren` (신규) | 드래그 시 부모씬+서브씬 블록 이동 |
| 드래그 `drop`/`dragover` 핸들러 | 서브씬 타 부모 이동 차단 + 블록 이동 |
| `.line-lyric` CSS (신규) | 뮤지컬 가사 라인 스타일 |
| `showTypeMenu` | 뮤지컬 전용 `lyric` 타입 버튼 추가 |
| 씬 헤더 우클릭 메뉴 | "서브씬으로 나누기" / "서브씬 합치기" 항목 추가 |
| `renderNavSceneList` | 서브씬 계층 렌더링, 들여쓰기 표시 |
| `renderScriptBody` | 서브씬 들여쓰기 + 타입 배지 표시 |
| `buildProjectContext` | 서브씬 계층 출력 (부모 아래 2-space indent) |
| `normalizeSceneNums` | `SC N-N` 패턴 스킵 조건 추가 |
| `handleChatPrompt` sys | 연극/뮤지컬 씬 작성 규칙 + `<subscenes>` 태그 추가 |
| `handleChatPrompt` 파싱 | `<subscenes>` → 부모씬+서브씬 그룹으로 변환 |
| `handleAiSceneAdd` | 연극 모드 씬 추가 후 서브씬 분할 안내 toast |
| `saveAsDraft` | 서브씬 draft에 `parentId: undefined` 명시 |
| `applyDiff` | mergeDelete 후 `subOrder` 재정렬 |
| `checkConflictWithPrompt` | 연극/뮤지컬 부모씬 갈등도 서브씬 최고값 집계 |
| 프로젝트 생성 모달 | 연극/뮤지컬 선택 시 서브씬 안내 힌트 표시 |
| 씬 생성 전 경로 (파일첨부/붙여넣기/AI) | `parentId: null, subOrder: 0, subSceneType: null` 명시적 초기화 |
| `isSyncEnabled` (신규) | `localStorage('ss_sync_enabled')` 기반 동기화 토글 플래그 |
| `toggleSyncEnabled` (신규) | 설정 패널에서 동기화 ON/OFF |
| `_updateSyncToggleUI` (신규) | 설정 패널 동기화 UI 상태 반영 |
| `storage.set` | `isSyncEnabled()` 체크 후 조건부 Supabase 업로드 |
| `syncFromSupabase` | `isSyncEnabled()` false면 즉시 return |
| `openDrawer('settings')` | `_updateSyncToggleUI()` 추가 호출 |
| 우클릭 메뉴 일반 모드 | `[복사]` `[붙여넣기]` 2열 추가 |
| 우클릭 메뉴 선택 모드 | `[복사 (N줄)]` 추가 |
| SHIFT+클릭 | 같은 줄 contenteditable 내부면 텍스트 선택 허용, 다른 줄이면 blur 후 복사 선택 |
| `handleSceneMerge` | 같은 계열 대안 씬(`allSameSeries`) 연속 체크 우회 |
| `handleScriptPrompt` | 참조 요청을 normalizeSceneNums 전에 먼저 감지 |
| `normalizeSceneNums` | draft 제외 목록 + getSceneLabel 사용 |
| `renderNavSceneList` | 대안 씬 원본 바로 아래 그룹 렌더 |
| `compareDraftScene` | 갈등도 항상 전체 재계산, 버튼 순서/색상 조정 |
| `renderConflictBody` / `openConflictModal` | draft 씬 명시적 필터 |
| `autoExtractMemoFromHistory` | `_isMemoSame()` 키워드 기반 중복 방지 |
| `toggleVoiceInput()` | Web Speech API ko-KR 음성 입력 |
| `showLoginScreen()` | 계정 미설정 시 풀스크린 오버레이 |
| `syncFromSupabase` | 로컬 최신이면 Supabase 재업로드 (데이터 손실 방지) |
| `storage.set` | `ss_local_save_time` 동시 기록 |
