require('dotenv').config();
const { App } = require('@slack/bolt');
const fs = require('fs');
const path = require('path');

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

// ── 명령어 판별 ───────────────────────────────────────────
function isCommandText(t) {
  return (
    t === '도움말' || t.toLowerCase() === 'help' ||
    t === '다시 보기' || t.toLowerCase() === 'archive' ||
    t === '구독취소' || t === '구독 취소' || t.toLowerCase() === 'unsubscribe' ||
    t === '피드백' || t.toLowerCase() === 'feedback' ||
    t === '취소'
  );
}

// ── 구독 취소 확인 대기 상태 ──────────────────────────────
// key: userId, value: true
const pendingCancel = {};

// ── 피드백 대기 상태 ──────────────────────────────────────
// key: userId, value: true
const pendingFeedback = {};

// ── 다시 보기 날짜 선택 대기 상태 ────────────────────────
// key: userId, value: 최근 한 달 발송 목록 배열
const pendingArchive = {};

// ── DM 이벤트 리스너 ──────────────────────────────────────
app.event('message', async ({ event, client }) => {
  // DM 채널만 처리
  if (event.channel_type !== 'im') return;

  // 봇 메시지·시스템 이벤트(join, leave 등) 무시
  if (event.bot_id || event.subtype) return;

  // PREVIEW_EMAIL 계정 예외 처리 (승인용 '발송' 메시지가 정상 동작하도록)
  if (event.user === previewUserId) return;

  const userId = event.user;
  const text = (event.text ?? '').trim();

  // ── 피드백 대기 중 ────────────────────────────────────
  if (pendingFeedback[userId]) {
    if (text === '취소') {
      delete pendingFeedback[userId];
      await client.chat.postMessage({
        channel: event.channel,
        text: '피드백이 취소됐어요.',
      });
      return;
    }

    if (!isCommandText(text)) {
      delete pendingFeedback[userId];
      await client.chat.postMessage({
        channel: event.channel,
        text: '소중한 의견 감사해요 🍃 담당자에게 전달할게요!',
      });
      if (previewUserId) {
        const { channel } = await client.conversations.open({ users: previewUserId });
        await client.chat.postMessage({
          channel: channel.id,
          text: `📮 익명 피드백이 도착했어요.\n[내용]: ${text}`,
        });
      }
      return;
    }

    // 인식된 명령어 → 대기 해제 후 아래 명령어 처리로 fall-through
    delete pendingFeedback[userId];
  }

  // ── 다시 보기 날짜 선택 대기 중 ──────────────────────
  if (pendingArchive[userId]) {
    if (text === '취소') {
      delete pendingArchive[userId];
      await client.chat.postMessage({
        channel: event.channel,
        text: '다시 보기가 취소됐어요.',
      });
      return;
    }

    if (isCommandText(text)) {
      // 인식된 명령어 → 대기 해제 후 아래 명령어 처리로 fall-through
      delete pendingArchive[userId];
    } else {
      // 날짜 입력으로 처리
      const recent = pendingArchive[userId];
      const matched = recent.find(h => {
        const d = new Date(h.sentAt);
        return `${d.getMonth() + 1}/${d.getDate()}` === text;
      });

      if (!matched) {
        await client.chat.postMessage({
          channel: event.channel,
          text: '해당 날짜의 뉴스레터를 찾을 수 없어요. 다시 입력해주세요.',
        });
        return;
      }

      const sentFilePath = path.resolve(`./newsletters/sent/${matched.file}`);
      if (!fs.existsSync(sentFilePath)) {
        await client.chat.postMessage({
          channel: event.channel,
          text: '해당 날짜의 뉴스레터를 찾을 수 없어요. 다시 입력해주세요.',
        });
        return;
      }

      delete pendingArchive[userId];
      const parsed = JSON.parse(fs.readFileSync(sentFilePath, 'utf-8'));
      const blocks = Array.isArray(parsed) ? parsed : parsed.blocks;

      await client.chat.postMessage({
        channel: event.channel,
        text: '👾 Hitokoto | 이번주 일본어 한 마디',
        blocks,
      });

      if (previewUserId) {
        let displayName = userId;
        try {
          const info = await client.users.info({ user: userId });
          displayName = info.user?.profile?.display_name || info.user?.real_name || userId;
        } catch {
          // 조회 실패 시 슬랙 ID 사용
        }

        const { channel } = await client.conversations.open({ users: previewUserId });
        await client.chat.postMessage({
          channel: channel.id,
          text: `📮 ${displayName}님이 다시 보기를 요청했어요. (${matched.file})`,
        });
      }
      return;
    }
  }

  // ── 구독 취소 확인 대기 중 ────────────────────────────
  if (pendingCancel[userId]) {
    if (text === '취소') {
      delete pendingCancel[userId];
      await client.chat.postMessage({
        channel: event.channel,
        text: '구독 취소가 취소됐어요.',
      });
      return;
    }

    if (isCommandText(text)) {
      // 인식된 명령어 → 대기 해제 후 아래 명령어 처리로 fall-through
      delete pendingCancel[userId];
    } else if (text === '네') {
      delete pendingCancel[userId];
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
    } else {
      // '네' 외 다른 입력 → 대기 상태 해제 후 기본 응답으로 fall-through
      delete pendingCancel[userId];
    }
  }

  // ── 도움말 ──────────────────────────────────────────────
  if (text === '도움말' || text.toLowerCase() === 'help') {
    await client.chat.postMessage({
      channel: event.channel,
      text: '📖 히토코토 봇 도움말\n\n사용 가능한 명령어예요:\n• 도움말 / help — 이 메뉴 표시\n• 다시 보기 / archive — 지난 뉴스레터 다시 보기\n• 피드백 / feedback — 익명으로 의견 보내기\n• 구독 취소 / unsubscribe — 뉴스레터 구독 취소 요청',
    });
    return;
  }

  // ── 다시 보기 ─────────────────────────────────────────
  if (text === '다시 보기' || text.toLowerCase() === 'archive') {
    const historyPath = path.resolve('./sent-history.json');
    const history = fs.existsSync(historyPath)
      ? JSON.parse(fs.readFileSync(historyPath, 'utf-8'))
      : [];

    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    const recent = history.filter(h => new Date(h.sentAt) >= oneMonthAgo);

    if (recent.length === 0) {
      await client.chat.postMessage({
        channel: event.channel,
        text: '아직 발송된 뉴스레터가 없어요.',
      });
      return;
    }

    const listLines = recent.map(h => {
      const d = new Date(h.sentAt);
      const md = `${d.getMonth() + 1}/${d.getDate()}`;
      const title = h.file
        .replace(/^\d{4}-\d{2}-\d{2}-/, '')
        .replace(/\.json$/, '')
        .replace(/-/g, ' ');
      return `• ${md} — ${title}`;
    }).join('\n');

    pendingArchive[userId] = recent;

    await client.chat.postMessage({
      channel: event.channel,
      text: `📅 최근 한 달간 발송된 목록이에요:\n${listLines}\n\n다시 보기를 원하는 뉴스레터의 날짜를 입력해주세요. (예: \`4/20\`)\n취소하려면 \`취소\` 라고 입력해주세요.`,
    });
    return;
  }

  // ── 피드백 요청 ───────────────────────────────────────
  if (text === '피드백' || text.toLowerCase() === 'feedback') {
    pendingFeedback[userId] = true;
    await client.chat.postMessage({
      channel: event.channel,
      text: '의견을 자유롭게 남겨주세요 👾\n(익명으로 전달되니 편하게 작성해주세요!)',
    });
    return;
  }

  // ── 구독 취소 요청 ────────────────────────────────────
  if (text === '구독취소' || text === '구독 취소' || text.toLowerCase() === 'unsubscribe') {
    pendingCancel[userId] = true;
    await client.chat.postMessage({
      channel: event.channel,
      text: '구독을 취소하시겠어요? 취소를 원하시면 `네` 라고 입력해주세요.',
    });
    return;
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
