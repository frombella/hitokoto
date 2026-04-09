# 슬랙 뉴스레터 발송 스크립트

Google Sheets 구독자 명단을 읽어 레벨별 뉴스레터를 Slack DM으로 발송합니다.

## 파일 구조

```
.
├── send.js          # 메인 발송 스크립트
├── content.js       # 레벨별 뉴스레터 내용
├── .env             # API 키 설정
└── service-account.json  # Google 서비스 계정 키 (직접 발급)
```

## 사전 준비

### 1. 패키지 설치

```bash
npm init -y
npm install @slack/web-api googleapis dotenv
```

### 2. Google Sheets API 설정

1. [Google Cloud Console](https://console.cloud.google.com/) → 프로젝트 생성
2. **API 및 서비스** → **라이브러리** → `Google Sheets API` 활성화
3. **사용자 인증 정보** → **서비스 계정 만들기**
4. 생성된 서비스 계정 → **키** 탭 → **키 추가** → JSON 다운로드
5. 다운로드한 파일을 `service-account.json` 으로 저장
6. 스프레드시트 → **공유** → 서비스 계정 이메일을 **뷰어**로 추가

### 3. 스프레드시트 형식

| A열 (이름) | B열 (이메일)       | C열 (레벨) |
|-----------|-------------------|-----------|
| 홍길동     | hong@example.com  | 초급       |
| 김철수     | kim@example.com   | 중급       |
| 이영희     | lee@example.com   | 고급       |

- 1행은 헤더 (자동으로 건너뜀)
- 레벨은 반드시 `초급` / `중급` / `고급` 중 하나

### 4. Slack Bot 설정

1. [api.slack.com/apps](https://api.slack.com/apps) → **Create New App**
2. **OAuth & Permissions** → **Bot Token Scopes** 추가:
   - `chat:write` — 메시지 발송
   - `im:write` — DM 채널 열기
   - `users:read` — 유저 조회
   - `users:read.email` — 이메일로 유저 조회
3. **Install to Workspace** → **Bot User OAuth Token** 복사

### 5. .env 파일 작성

```env
SLACK_TOKEN=xoxb-your-slack-bot-token-here
GOOGLE_SHEET_ID=your-google-sheet-id-here
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json
```

스프레드시트 ID는 URL에서 확인:
```
https://docs.google.com/spreadsheets/d/[여기가 SHEET_ID]/edit
```

## 실행

```bash
node send.js
```

### 실행 결과 예시

```
📋 구독자 목록을 불러오는 중...
   → 3명 확인
✅  [초급] 홍길동 <hong@example.com> → 발송 완료
✅  [중급] 김철수 <kim@example.com> → 발송 완료
✅  [고급] 이영희 <lee@example.com> → 발송 완료

── 발송 결과 ──────────────────────
   성공: 3명
   건너뜀: 0명
   실패: 0명
```

## 뉴스레터 내용 수정

`content.js` 파일의 `newsletters` 객체를 수정하세요.

```js
const newsletters = {
  초급: { title: '...', body: '...' },
  중급: { title: '...', body: '...' },
  고급: { title: '...', body: '...' },
};
```

## 주의사항

- Slack API Rate Limit으로 인해 발송 사이 **1.2초** 간격이 있습니다.
- Slack 워크스페이스에 가입되지 않은 이메일은 자동으로 건너뜁니다.
- `.env` 와 `service-account.json` 은 `.gitignore` 에 추가해 커밋하지 마세요.
