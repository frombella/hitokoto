require('dotenv').config();
const { WebClient } = require('@slack/web-api');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ── 설정 ──────────────────────────────────────────────────
const AUTO_MODE      = process.argv.includes('--auto');
const SLACK_TOKEN    = process.env.SLACK_TOKEN;
const CSV_PATH       = process.env.CSV_PATH || './subscribers.csv';
const PREVIEW_EMAIL  = process.env.PREVIEW_EMAIL;
const TIMEOUT_MS      = 30 * 60 * 1000;  // 30분
const POLL_INTERVAL_MS = 30 * 1000;       // 30초

if (!SLACK_TOKEN) {
  console.error('❌ .env 파일에 SLACK_TOKEN 이 필요합니다.');
  process.exit(1);
}
if (!PREVIEW_EMAIL) {
  console.error('❌ .env 파일에 PREVIEW_EMAIL 이 필요합니다.');
  process.exit(1);
}

const slack = new WebClient(SLACK_TOKEN);

// ── 레벨별 뉴스레터 파일 읽기 ────────────────────────────
// 반환값: { [level]: { type: 'json', blocks: [...] } | { type: 'txt', body: '...' } }
function loadNewsletters() {
  const levels = ['초급', '중급', '고급'];
  const map = {};
  for (const level of levels) {
    const jsonPath = path.resolve(`./newsletter_${level}.json`);
    const txtPath  = path.resolve(`./newsletter_${level}.txt`);

    if (fs.existsSync(jsonPath)) {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      const blocks = Array.isArray(parsed) ? parsed : parsed.blocks;
      map[level] = { type: 'json', blocks };
      console.log(`   ✔ newsletter_${level}.json 로드됨`);
    } else if (fs.existsSync(txtPath)) {
      map[level] = { type: 'txt', body: fs.readFileSync(txtPath, 'utf-8').trim() };
      console.log(`   ✔ newsletter_${level}.txt 로드됨`);
    } else {
      console.warn(`   ⚠ newsletter_${level}.json / .txt 없음 → 해당 레벨 건너뜀`);
    }
  }
  return map;
}

// ── CSV 읽기 ──────────────────────────────────────────────
function fetchSubscribers() {
  const filePath = path.resolve(CSV_PATH);
  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV 파일을 찾을 수 없습니다: ${filePath}`);
  }

  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');

  // 첫 행이 헤더면 건너뜀 (이름/이메일/레벨 포함 여부로 판단)
  const firstLine = lines[0]?.toLowerCase() ?? '';
  const dataLines = firstLine.includes('이름') || firstLine.includes('email')
    ? lines.slice(1)
    : lines;

  return dataLines
    .map(line => line.trim())
    .filter(line => line)
    .map(line => {
      const cols = line.split(',');
      // 구글 폼 응답처럼 첫 컬럼이 타임스탬프인 경우 자동 감지해 건너뜀
      const offset = /^\d{4}\./.test(cols[0]) || /^\d{4}-\d{2}-\d{2}/.test(cols[0]) ? 1 : 0;
      const [name = '', email = '', level = ''] = cols.slice(offset);
      return {
        name:  name.trim(),
        email: email.trim().toLowerCase(),
        level: level.trim(),
      };
    })
    .filter(s => s.email);
}

// ── Slack User ID 조회 ────────────────────────────────────
async function lookupSlackUserId(email) {
  try {
    const res = await slack.users.lookupByEmail({ email });
    return res.user?.id ?? null;
  } catch (err) {
    if (err.data?.error === 'users_not_found') return null;
    throw err;
  }
}

// ── Block Kit 구성 (txt 전용) ─────────────────────────────
function chunkText(text, maxLen = 3000) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  for (let i = 0; i < text.length; i += maxLen) chunks.push(text.slice(i, i + maxLen));
  return chunks;
}

function buildBlocks(name, body) {
  const blocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: ':space_invader: Hitokoto | 이번주 일본어 한 마디', emoji: true },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'plain_text',
        text: `안녕하세요, ${name}님! :wave:\n월요일 아침, 5분으로 일본어 감각을 깨워드리는 히토코토가 찾아왔어요.`,
        emoji: true,
      },
    },
    { type: 'divider' },
  ];

  for (const para of body.split(/\n{2,}/)) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // 단일 행 + :emoji: 시작 + 150자 이하 → header 블록
    if (!trimmed.includes('\n') && /^:[a-z_]+:/.test(trimmed) && trimmed.length <= 150) {
      blocks.push({ type: 'divider' });
      blocks.push({
        type: 'header',
        text: { type: 'plain_text', text: trimmed, emoji: true },
      });
    } else {
      for (const chunk of chunkText(trimmed)) {
        blocks.push({
          type: 'section',
          text: { type: 'mrkdwn', text: chunk },
        });
      }
    }
  }

  return blocks;
}

// ── DM 발송 ───────────────────────────────────────────────
async function sendDM(userId, name, newsletter) {
  const { channel } = await slack.conversations.open({ users: userId });

  const blocks = newsletter.type === 'json'
    ? newsletter.blocks
    : buildBlocks(name, newsletter.body);

  await slack.chat.postMessage({
    channel: channel.id,
    text: ':space_invader: Hitokoto | 이번주 일본어 한 마디',  // 알림용 fallback
    blocks,
  });
}

// ── 확인 프롬프트 (수동 모드) ─────────────────────────────
function confirm(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

// ── 미리보기 발송 ─────────────────────────────────────────
// previewUserId 반환 (자동 모드에서 DM 채널 재사용)
async function sendPreview(newsletters) {
  console.log(`\n👀 미리보기 발송 중... → ${PREVIEW_EMAIL}`);

  const previewUserId = await lookupSlackUserId(PREVIEW_EMAIL);
  if (!previewUserId) {
    throw new Error(`미리보기 계정(${PREVIEW_EMAIL})을 Slack에서 찾을 수 없습니다.`);
  }

  for (const [level, newsletter] of Object.entries(newsletters)) {
    await sendDM(previewUserId, '미리보기', newsletter);
    console.log(`   ✔ [${level}] 미리보기 발송 완료`);
    await new Promise(r => setTimeout(r, 1200));
  }

  return previewUserId;
}

// ── 전체 구독자 발송 ──────────────────────────────────────
async function sendToAll(targets, newsletters) {
  console.log('');
  const stats = { sent: 0, skipped: 0, failed: 0 };

  for (const sub of targets) {
    const { name, email, level } = sub;

    const userId = await lookupSlackUserId(email);
    if (!userId) {
      console.warn(`⚠️  [${email}] Slack 계정을 찾을 수 없음 → 건너뜀`);
      stats.skipped++;
      continue;
    }

    try {
      await sendDM(userId, name, newsletters[level]);
      console.log(`✅  [${level}] ${name} <${email}> → 발송 완료`);
      stats.sent++;
    } catch (err) {
      console.error(`❌  [${email}] 발송 실패: ${err.message}`);
      stats.failed++;
    }

    // Slack API rate limit 대비 (Tier 3: ~50 req/min)
    await new Promise(r => setTimeout(r, 1200));
  }

  console.log('\n── 발송 결과 ──────────────────────');
  console.log(`   성공: ${stats.sent}명`);
  console.log(`   건너뜀: ${stats.skipped}명`);
  console.log(`   실패: ${stats.failed}명`);
}

// ── 자동 모드: 발송 승인 요청 DM ─────────────────────────
async function sendConfirmRequest(channelId) {
  const res = await slack.chat.postMessage({
    channel: channelId,
    text: '히토코토 미리보기를 확인해주세요.\n전체 발송을 원하시면 이 메시지에 \'발송\' 이라고 답장해주세요.',
  });
  return res.ts;  // 답장 감지 기준점
}

// ── 자동 모드: 답장 대기 ──────────────────────────────────
// '발송' 텍스트가 포함된 답장을 최대 TIMEOUT_MS 동안 폴링
// DM 본문 메시지와 스레드 답장 모두 감지
async function waitForApproval(channelId, previewUserId, messageTs) {
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

    // DM 채널 본문에 새 메시지가 왔는지 확인
    const history = await slack.conversations.history({
      channel: channelId,
      oldest: messageTs,
      inclusive: false,
      limit: 10,
    });
    const inChannel = history.messages?.some(
      m => m.user === previewUserId && m.text?.includes('발송')
    );
    if (inChannel) return true;

    // 스레드 답장도 확인 (첫 번째 요소는 부모 메시지이므로 제외)
    try {
      const replies = await slack.conversations.replies({
        channel: channelId,
        ts: messageTs,
        limit: 10,
      });
      const inThread = replies.messages?.slice(1).some(
        m => m.user === previewUserId && m.text?.includes('발송')
      );
      if (inThread) return true;
    } catch {
      // 스레드 없음 — 무시
    }
  }

  return false;
}

// ── 메인 ──────────────────────────────────────────────────
async function main() {
  if (!AUTO_MODE) {
    console.log('━'.repeat(44));
    console.log('  ⚠️  반드시 별도 터미널에서 실행하세요.');
    console.log('  Claude Code 환경에서는 y/n 입력이 자동');
    console.log('  처리되어 의도치 않게 발송될 수 있습니다.');
    console.log('━'.repeat(44));
    console.log('');
  }

  console.log('📄 뉴스레터 파일 확인 중...');
  const newsletters = loadNewsletters();

  if (Object.keys(newsletters).length === 0) {
    console.error('❌ 발송할 뉴스레터 파일이 없습니다. newsletter_초급.txt 등을 준비해주세요.');
    process.exit(1);
  }

  console.log('\n📋 구독자 목록을 불러오는 중...');
  const subscribers = fetchSubscribers();

  const targets = subscribers.filter(s => newsletters[s.level]);
  const noFile  = subscribers.filter(s => s.level && !newsletters[s.level]);

  noFile.forEach(s => {
    console.warn(`   ⚠ [${s.email}] newsletter_${s.level}.json / .txt 없음 → 건너뜀`);
  });

  if (targets.length === 0) {
    console.log('발송 대상이 없습니다. 종료합니다.');
    return;
  }

  console.log('\n── 발송 예정 목록 ──────────────────────');
  targets.forEach((s, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. [${s.level}] ${s.name} <${s.email}>`);
  });
  console.log(`${'─'.repeat(40)}`);
  console.log(`  총 ${targets.length}명`);

  const previewUserId = await sendPreview(newsletters);

  if (AUTO_MODE) {
    // ── 자동 모드: Slack DM으로 승인 대기 ────────────────
    const { channel } = await slack.conversations.open({ users: previewUserId });
    const channelId = channel.id;

    const messageTs = await sendConfirmRequest(channelId);
    console.log(`\n⏳ 30분 동안 답장 대기 중... (${new Date().toLocaleTimeString('ko-KR')})`);

    const approved = await waitForApproval(channelId, previewUserId, messageTs);

    if (!approved) {
      await slack.chat.postMessage({
        channel: channelId,
        text: '30분 내 응답이 없어 히토코토 발송을 자동 취소했습니다.',
      });
      console.log('\n⏰ 시간 초과: 발송이 자동 취소되었습니다.');
      return;
    }

    console.log('\n✅ 발송 승인 확인. 전체 발송을 시작합니다.');
    await sendToAll(targets, newsletters);

  } else {
    // ── 수동 모드: 터미널에서 y/n 입력 ──────────────────
    const answer = await confirm('\n미리보기 계정으로 발송했습니다. 확인 후 전체 발송하시겠습니까? (y/n) ');
    if (answer !== 'y') {
      console.log('발송을 취소했습니다.');
      return;
    }
    await sendToAll(targets, newsletters);
  }
}

main().catch(err => {
  console.error('💥 예기치 않은 오류:', err.message);
  process.exit(1);
});
