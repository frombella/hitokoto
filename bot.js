require('dotenv').config();
const { App } = require('@slack/bolt');

// ── 설정 ──────────────────────────────────────────────────
const SLACK_TOKEN    = process.env.SLACK_TOKEN;
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;
const PREVIEW_EMAIL  = process.env.PREVIEW_EMAIL;

for (const [key, val] of Object.entries({ SLACK_TOKEN, SLACK_APP_TOKEN, PREVIEW_EMAIL })) {
  if (!val) {
    console.error(`❌ .env 파일에 ${key} 가 필요합니다.`);
    process.exit(1);
  }
}

// ── Bolt 앱 (Socket Mode) ─────────────────────────────────
const app = new App({
  token: SLACK_TOKEN,
  appToken: SLACK_APP_TOKEN,
  socketMode: true,
});

// ── 미리보기 계정 ID 캐시 ─────────────────────────────────
// 봇 시작 시 1회 조회 후 재사용
let previewUserId = null;

async function loadPreviewUserId() {
  try {
    const res = await app.client.users.lookupByEmail({ email: PREVIEW_EMAIL });
    previewUserId = res.user?.id ?? null;
  } catch {
    previewUserId = null;
  }

  if (!previewUserId) {
    console.warn(`⚠️  PREVIEW_EMAIL(${PREVIEW_EMAIL}) Slack 계정을 찾을 수 없습니다. 예외 처리가 비활성화됩니다.`);
  }
}

// ── 구독 취소 확인 대기 상태 ──────────────────────────────
// key: userId, value: true
const pendingCancel = {};

// ── DM 이벤트 리스너 ──────────────────────────────────────
app.event('message', async ({ event, client }) => {
  // DM 채널만 처리
  if (event.channel_type !== 'im') return;

  // 봇 메시지·시스템 이벤트(join, leave 등) 무시
  if (event.bot_id || event.subtype) return;

  // PREVIEW_EMAIL 계정 예외 처리 (승인용 '발송' 메시지가 정상 동작하도록)
  // if (event.user === previewUserId) return;  // TODO: 테스트 후 복구

  const userId = event.user;
  const text = (event.text ?? '').trim();

  // ── 도움말 ──────────────────────────────────────────────
  if (text === '도움말' || text.toLowerCase() === 'help') {
    await client.chat.postMessage({
      channel: event.channel,
      text: '📖 히토코토 봇 도움말\n\n사용 가능한 명령어예요:\n• 도움말 / help — 이 메뉴 표시\n• 구독 취소 / unsubscribe — 뉴스레터 구독 취소 요청',
    });
    return;
  }

  // ── 구독 취소 요청 ────────────────────────────────────
  if (text === '구독취소' || text === '구독 취소' || text.toLowerCase() === 'unsubscribe') {
    pendingCancel[userId] = true;
    await client.chat.postMessage({
      channel: event.channel,
      text: '구독을 취소하시겠어요? 취소를 원하시면 *네* 라고 입력해주세요.',
    });
    return;
  }

  // ── 구독 취소 확인 ────────────────────────────────────
  if (pendingCancel[userId]) {
    delete pendingCancel[userId];

    if (text === '네') {
      await client.chat.postMessage({
        channel: event.channel,
        text: '구독 취소 요청을 접수했어요. 담당자가 확인 후 처리해드릴게요 👾\n다시 구독하고 싶으실 때는 <https://forms.gle/sNmKiyd1qEXBAFxt7|여기> 를 통해 신청해주세요!',
      });

      if (previewUserId) {
        let identifier = userId;
        try {
          const info = await client.users.info({ user: userId });
          identifier = info.user?.profile?.email ?? userId;
        } catch {
          // 이메일 조회 실패 시 슬랙 ID 사용
        }

        const { channel } = await client.conversations.open({ users: previewUserId });
        await client.chat.postMessage({
          channel: channel.id,
          text:
            `📮 구독 취소 요청이 들어왔어요.\n` +
            `• 이메일: ${identifier}\n` +
            `Google 스프레드시트에서 해당 행을 삭제 후 CSV를 다시 다운로드해주세요.`,
        });
      }
      return;
    }

    // '네' 외 다른 입력 → 대기 상태 해제 후 기본 응답으로 fall-through
  }

  // ── 기본 응답 ─────────────────────────────────────────
  await client.chat.postMessage({
    channel: event.channel,
    text: '앗, 저는 대화 기능이 없는 뉴스레터 봇이에요 👾\n`도움말` 을 입력해보세요!',
  });
});

// ── 시작 ──────────────────────────────────────────────────
(async () => {
  await loadPreviewUserId();
  await app.start();
  console.log('⚡️ 히토코토 봇 실행 중 (Socket Mode)');
  console.log(`   미리보기 계정 예외: ${previewUserId ?? '미설정'}`);

  if (previewUserId) {
    const { channel } = await app.client.conversations.open({ users: previewUserId });
    await app.client.chat.postMessage({
      channel: channel.id,
      text: '⚡️ 히토코토 봇이 시작됐어요.',
    });
  }
})().catch(err => {
  console.error('💥 봇 시작 실패:', err.message);
  process.exit(1);
});
