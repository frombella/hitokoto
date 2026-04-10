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

// ── DM 이벤트 리스너 ──────────────────────────────────────
app.event('message', async ({ event, client }) => {
  // DM 채널만 처리
  if (event.channel_type !== 'im') return;

  // 봇 메시지·시스템 이벤트(join, leave 등) 무시
  if (event.bot_id || event.subtype) return;

  // PREVIEW_EMAIL 계정 예외 처리 (승인용 '발송' 메시지가 정상 동작하도록)
  if (event.user === previewUserId) return;

  await client.chat.postMessage({
    channel: event.channel,
    text: '앗, 저는 뉴스레터 전용 봇이라 대화는 못해요!\n다음 주 월요일에 새로운 일본어 한 마디로 찾아올게요 🍃',
  });
});

// ── 시작 ──────────────────────────────────────────────────
(async () => {
  await loadPreviewUserId();
  await app.start();
  console.log('⚡️ 히토코토 봇 실행 중 (Socket Mode)');
  console.log(`   미리보기 계정 예외: ${previewUserId ?? '미설정'}`);
})().catch(err => {
  console.error('💥 봇 시작 실패:', err.message);
  process.exit(1);
});
