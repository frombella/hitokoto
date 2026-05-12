# Hitokoto — Slack 뉴스레터 발송 시스템

매주 월요일 일본어 학습 뉴스레터를 구독자에게 Slack DM으로 발송합니다.

## 파일 구조

```
hitokoto/
├── send.js                  # 뉴스레터 발송 스크립트 (수동/자동 모드)
├── bot.js                   # DM 수신 이벤트 리스너 (상시 실행)
├── generate-archive.js      # 아카이브 HTML 생성 스크립트
├── package.json
├── newsletters/
│   ├── YYYY-MM-DD-주제.json # 발송할 뉴스레터 (Block Kit JSON)
│   ├── sent/                # 발송 완료 원본 보관 (gitignore)
│   └── archive/             # 아카이브 페이지용 JSON (git 추적)
├── docs/                    # GitHub Pages 아카이브 페이지
│   └── images/              # 아카이브 페이지 이미지
├── sent-history.json        # 발송 이력 (gitignore)
├── welcomed.json            # 환영 메시지 발송 이력 (gitignore)
├── subscribers.csv          # 구독자 명단 (gitignore)
└── .env                     # 환경변수 (gitignore)
```

### newsletters/sent/ vs newsletters/archive/

두 폴더는 역할이 다르며, 의도적으로 분리 운영됩니다.

| 폴더 | 내용 | git | 용도 |
|---|---|---|---|
| `sent/` | Slack 발송본 원본 (루비 없음) | 제외 | 로컬 백업 |
| `archive/` | 루비 표기 추가본 | 추적 | GitHub Pages 아카이브 페이지 |

발송 전 `archive/` 폴더에 루비 추가본을 미리 준비하고, `node generate-archive.js`로 `docs/`를 갱신한 후 git push합니다. 발송 후 `send.js`가 자동으로 `newsletters/` → `sent/`로 원본을 이동합니다.

## 뉴스레터 파일 형식

파일명은 `YYYY-MM-DD-주제.json` 형식으로 작성합니다. 실행 시 오늘 이전/당일 파일 중 가장 오래된 것이 자동 선택됩니다.

```json
[
  {
    "type": "header",
    "text": { "type": "plain_text", "text": ":space_invader: Hitokoto | 이번주 일본어 한 마디", "emoji": true }
  },
  { "type": "divider" },
  ...
]
```

- 배열 또는 `{ "blocks": [...] }` 형태 모두 지원
- 발송 완료 후 `newsletters/sent/` 폴더로 자동 이동

## 구독자 CSV 형식

```csv
타임스탬프,이름,이메일
2026. 4. 9 오후 4:39:19,Bella,bella.12@example.com
```

- 첫 행이 헤더면 자동으로 건너뜀
- 타임스탬프 컬럼은 자동 감지해 건너뜀
- Slack 워크스페이스에 가입되지 않은 이메일은 자동으로 건너뜀

## 사전 준비

### 1. 패키지 설치

```bash
npm install
```

### 2. .env 파일 작성

```env
SLACK_TOKEN=xoxb-...          # Bot Token
SLACK_APP_TOKEN=xapp-...      # App-Level Token (Socket Mode용)
PREVIEW_EMAIL=your@email.com  # 미리보기/승인용 계정
```

### 3. Slack Bot 설정

[api.slack.com/apps](https://api.slack.com/apps) → Bot Token Scopes:

| Scope              | 용도                    |
|--------------------|------------------------|
| `chat:write`       | 메시지 발송              |
| `im:write`         | DM 채널 열기             |
| `im:read`          | DM 채널 조회             |
| `im:history`       | DM 메시지 내역 조회       |
| `users:read`       | 유저 조회                |
| `users:read.email` | 이메일로 유저 조회         |

Socket Mode도 활성화해야 합니다 (`SLACK_APP_TOKEN` 필요).

## 실행

### 수동 모드

터미널에서 직접 `y/n`으로 발송 여부를 결정합니다.

```bash
node send.js
```

> **주의:** 반드시 별도 터미널에서 실행하세요. Claude Code 환경에서는 y/n 입력이 자동 처리될 수 있습니다.

### 자동 모드 (cron용)

Slack DM으로 미리보기를 보낸 뒤, `PREVIEW_EMAIL` 계정의 답장 `'발송'`을 감지해 전체 발송합니다. 최대 30분 대기 후 응답 없으면 자동 취소됩니다.

```bash
node send.js --auto
```

**자동 모드 흐름:**
1. `newsletters/`에서 오늘 이전/당일 가장 오래된 파일 선택
2. `PREVIEW_EMAIL`로 미리보기 DM 발송
3. "발송이라고 답장해주세요" DM 발송
4. 30초 간격 폴링, 최대 30분 대기
5. `'발송'` 답장 감지 → 전체 구독자 발송
6. 타임아웃 → 취소 알림 DM 발송
7. 발송 완료 후 파일을 `newsletters/sent/`로 이동

## bot.js 상시 실행 (LaunchAgent)

`bot.js`는 구독자가 봇에게 DM을 보낼 때 자동 안내 메시지를 응답합니다. Mac 시작 시 자동으로 실행되도록 LaunchAgent에 등록되어 있습니다.

- plist 위치: `~/Library/LaunchAgents/com.hitokoto.bot.plist`
- 로그: `~/hitokoto/bot.log`

수동으로 시작/중지하려면:

```bash
# 시작
launchctl load ~/Library/LaunchAgents/com.hitokoto.bot.plist

# 중지
launchctl unload ~/Library/LaunchAgents/com.hitokoto.bot.plist
```

## 참고

- Slack API Rate Limit 대비 발송 간격 **1.2초**
- `PREVIEW_EMAIL` 계정은 봇 자동 응답에서 제외됩니다 (승인 흐름 보호)
