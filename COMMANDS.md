# 히토코토 터미널 명령어 모음

## 구독자 명단
- CSV 업데이트: mv ~/Downloads/Hitokoto.csv ~/hitokoto/subscribers.csv

## 뉴스레터 발송
- 다음 발송 예정 파일 확인: cd ~/hitokoto && /usr/local/bin/node send.js --check
- 다시 보기 대상 목록 확인 (최근 한 달): cd ~/hitokoto && /usr/local/bin/node send.js --check-archive
- 자동 모드: cd ~/hitokoto && /usr/local/bin/node send.js --auto
- 수동 모드: cd ~/hitokoto && /usr/local/bin/node send.js
- 미리보기 (전체): cd ~/hitokoto && /usr/local/bin/node send.js --preview
- 미리보기 (다음 호): cd ~/hitokoto && /usr/local/bin/node send.js --preview-next
- 환영 메시지: cd ~/hitokoto && /usr/local/bin/node send.js --welcome

## 봇 관리
- 봇 재시작: launchctl unload ~/Library/LaunchAgents/com.hitokoto.bot.plist && launchctl load ~/Library/LaunchAgents/com.hitokoto.bot.plist
- 봇 상태 확인: launchctl list | grep hitokoto
- 봇 로그 확인: tail -f ~/hitokoto/bot.log

## 발송 스케줄 관리
- 스케줄 재시작: launchctl unload ~/Library/LaunchAgents/com.hitokoto.send.plist && launchctl load ~/Library/LaunchAgents/com.hitokoto.send.plist
- 발송 로그 확인: tail -f ~/hitokoto/send.log

## 테스트
- 절전 모드 방지: caffeinate -t 7200 &
- 발송 스케줄 수동 실행: launchctl start com.hitokoto.send

## 아카이브 업데이트 (발송 후)
1. newsletters/sent/ 파일에 루비용 괄호 추가 (한자 옆에 읽기 표기)
   예: 報告 → 報告(ほうこく)
2. 아카이브 HTML 재생성: node generate-archive.js
3. GitHub 업로드: cd ~/hitokoto && git add docs/ && git commit -m "content: N호 아카이브 추가" && git push

## 기타
- Slack 토큰 교체: nano ~/hitokoto/.env
- 뉴스레터 파일 목록: ls ~/hitokoto/newsletters/
- git 저장: cd ~/hitokoto && git add . && git commit -m "내용 입력"
