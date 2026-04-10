# Hitokoto — Slack 뉴스레터 발송 스크립트

레벨별 일본어 뉴스레터를 구독자에게 Slack DM으로 발송합니다.

## 파일 구조

```
.
├── send.js                   # 메인 발송 스크립트
├── newsletter_초급.json       # 레벨별 뉴스레터 (Block Kit JSON)
├── newsletter_중급.json
├── newsletter_고급.json
├── subscribers.csv           # 구독자 명단 (gitignore)
└── .env                      # 환경변수 (gitignore)
```

### 뉴스레터 파일 형식

레벨당 파일 하나. 우선순위: `.json` > `.txt`

- **`.json`** — Slack Block Kit 배열 직접 사용
  ```json
  { "blocks": [ ... ] }
  ```
- **`.txt`** — 일반 텍스트. 빈 줄 기준 단락 분리, `:emoji:` 로 시작하는 단락은 header 블록으로 변환

### subscribers.csv 형식

```
타임스탬프,이름,이메일,레벨
2026. 4. 9 오후 4:39:19,Bella,bella.12@kakaopiccoma.com,중급
```

- 첫 행이 헤더면 자동으로 건너뜀
- 타임스탬프 컬럼은 자동 감지해 건너뜀
- 레벨: `초급` / `중급` / `고급`

## 사전 준비

### 1. 패키지 설치

```bash
npm install
```

### 2. .env 파일 작성

```env
SLACK_TOKEN=xoxb-your-slack-bot-token-here
PREVIEW_EMAIL=your-preview-account@example.com
```

### 3. Slack Bot 설정

[api.slack.com/apps](https://api.slack.com/apps) → Bot Token Scopes:

| Scope              | 용도                  |
|--------------------|----------------------|
| `chat:write`       | 메시지 발송            |
| `im:write`         | DM 채널 열기           |
| `users:read`       | 유저 조회              |
| `users:read.email` | 이메일로 유저 조회      |

## 실행

```bash
node send.js
```

### 실행 흐름

1. 뉴스레터 파일 로드 (`newsletter_*.json / .txt`)
2. 구독자 명단 확인 및 발송 예정 목록 출력
3. **미리보기 계정(`PREVIEW_EMAIL`)으로 먼저 발송**
4. 확인 후 전체 발송 여부 결정 (`y/n`)

## 주의사항

- Slack API Rate Limit 대비 발송 간격 **1.2초**
- Slack 워크스페이스 미가입 이메일은 자동으로 건너뜀
- **반드시 별도 터미널에서 실행** (Claude Code 환경에서는 y/n 입력이 자동 처리될 수 있음)
