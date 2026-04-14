require('dotenv').config();
const { WebClient } = require('@slack/web-api');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ── 설정 ──────────────────────────────────────────────────
const AUTO_MODE        = process.argv.includes('--auto');
const WELCOME_MODE     = process.argv.includes('--welcome');
const SLACK_TOKEN      = process.env.SLACK_TOKEN;
const CSV_PATH         = process.env.CSV_PATH || './subscribers.csv';
const WELCOMED_PATH    = path.resolve('./welcomed.json');
const PREVIEW_EMAIL    = process.env.PREVIEW_EMAIL;
const TIMEOUT_MS       = 30 * 60 * 1000;  // 30분
const POLL_INTERVAL_MS = 30 * 1000;        // 30초

if (!SLACK_TOKEN) {
  console.error('❌ .env 파일에 SLACK_TOKEN 이 필요합니다.');
  process.exit(1);
}
if (!PREVIEW_EMAIL) {
  console.error('❌ .env 파일에 PREVIEW_EMAIL 이 필요합니다.');
  process.exit(1);
}

const slack = new WebClient(SLACK_TOKEN);

// ── 뉴스레터 파일 선택 ────────────────────────────────────
// newsletters/ 에서 오늘 이전/당일 파일 중 가장 오래된 것을 선택
// 해당 파일이 없으면 가장 가까운 미래 파일로 fallback
function loadNewsletter() {
  const dir = path.resolve('./newsletters');
  if (!fs.existsSync(dir)) {
    throw new Error('newsletters/ 폴더가 없습니다.');
  }

  const files = fs.readdirSync(dir)
    .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();

  if (files.length === 0) {
    throw new Error('newsletters/ 폴더에 발송할 파일이 없습니다. (형식: YYYY-MM-DD.json)');
  }

  const today = new Date().toISOString().slice(0, 10);
  const past  = files.filter(f => f.slice(0, 10) <= today);
  const chosen = past.length > 0 ? past[0] : files[0];

  const filePath = path.join(dir, chosen);
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const blocks = Array.isArray(parsed) ? parsed : parsed.blocks;

  console.log(`   ✔ ${chosen} 로드됨`);
  return { blocks, filePath };
}

// ── 발송 완료 파일 보관 ───────────────────────────────────
function archiveNewsletter(filePath) {
  const sentDir = path.resolve('./newsletters/sent');
  if (!fs.existsSync(sentDir)) fs.mkdirSync(sentDir, { recursive: true });
  const fileName = path.basename(filePath);
  fs.renameSync(filePath, path.join(sentDir, fileName));
  console.log(`\n📁 ${fileName} → newsletters/sent/ 로 이동 완료`);
}

// ── 환영 메시지 발송 이력 ─────────────────────────────────
function loadWelcomed() {
  if (!fs.existsSync(WELCOMED_PATH)) return new Set();
  return new Set(JSON.parse(fs.readFileSync(WELCOMED_PATH, 'utf-8')));
}

function saveWelcomed(welcomedSet) {
  fs.writeFileSync(WELCOMED_PATH, JSON.stringify([...welcomedSet], null, 2));
}

// ── CSV 읽기 ──────────────────────────────────────────────
function fetchSubscribers() {
  const filePath = path.resolve(CSV_PATH);
  if (!fs.existsSync(filePath)) {
    throw new Error(`CSV 파일을 찾을 수 없습니다: ${filePath}`);
  }

  const lines = fs.readFileSync(filePath, 'utf-8').split('\n');

  // 첫 행이 헤더면 건너뜀
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
      const [name = '', email = ''] = cols.slice(offset);
      return {
        name:  name.trim(),
        email: email.trim().toLowerCase(),
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

// ── DM 발송 ───────────────────────────────────────────────
async function sendDM(userId, newsletter) {
  const { channel } = await slack.conversations.open({ users: userId });

  await slack.chat.postMessage({
    channel: channel.id,
    text: ':space_invader: Hitokoto | 이번주 일본어 한 마디',  // 알림용 fallback
    blocks: newsletter.blocks,
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
async function sendPreview(newsletter) {
  console.log(`\n👀 미리보기 발송 중... → ${PREVIEW_EMAIL}`);

  const previewUserId = await lookupSlackUserId(PREVIEW_EMAIL);
  if (!previewUserId) {
    throw new Error(`미리보기 계정(${PREVIEW_EMAIL})을 Slack에서 찾을 수 없습니다.`);
  }

  await sendDM(previewUserId, newsletter);
  console.log('   ✔ 미리보기 발송 완료');

  return previewUserId;
}

// ── 전체 구독자 발송 ──────────────────────────────────────
async function sendToAll(subscribers, newsletter) {
  console.log('');
  const stats = { sent: 0, failed: 0 };
  const failures = [];  // { name, email }

  for (const { name, email } of subscribers) {
    const userId = await lookupSlackUserId(email);
    if (!userId) {
      console.warn(`⚠️  [${email}] Slack 계정을 찾을 수 없음 → 건너뜀`);
      failures.push({ name, email });
      stats.failed++;
      continue;
    }

    try {
      await sendDM(userId, newsletter);
      console.log(`✅  ${name} <${email}> → 발송 완료`);
      stats.sent++;
    } catch (err) {
      console.error(`❌  [${email}] 발송 실패: ${err.message}`);
      failures.push({ name, email });
      stats.failed++;
    }

    // Slack API rate limit 대비 (Tier 3: ~50 req/min)
    await new Promise(r => setTimeout(r, 1200));
  }

  console.log('\n── 발송 결과 ──────────────────────');
  console.log(`   성공: ${stats.sent}명`);
  console.log(`   실패: ${stats.failed}명`);

  return { stats, failures };
}

// ── 발송 결과 리포트 DM ───────────────────────────────────
async function sendReport(previewUserId, total, stats, failures) {
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  const now = new Date();
  const dateStr = `${now.toISOString().slice(0, 10)} (${days[now.getDay()]})`;

  let text =
    `📊 히토코토 발송 결과 리포트\n` +
    `────────────────\n` +
    `📅 발송일: ${dateStr}\n` +
    `📨 총 구독자: ${total}명\n` +
    `✅ 발송 성공: ${stats.sent}명\n` +
    `❌ 발송 실패: ${stats.failed}명`;

  if (failures.length === 0) {
    text += '\n\n모두 성공적으로 발송됐어요 🎉';
  } else {
    text += '\n\n실패 목록:';
    for (const { name, email } of failures) {
      text += `\n  • ${name} <${email}>`;
    }
  }

  const { channel } = await slack.conversations.open({ users: previewUserId });
  await slack.chat.postMessage({ channel: channel.id, text });
  console.log('📊 발송 결과 리포트를 운영자에게 전송했습니다.');
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

// ── 환영 메시지 모드 ──────────────────────────────────────
async function runWelcome() {
  console.log('📋 구독자 목록을 불러오는 중...');
  const subscribers = fetchSubscribers();

  if (subscribers.length === 0) {
    console.log('구독자가 없습니다. 종료합니다.');
    return;
  }

  const welcomed = loadWelcomed();
  const targets = subscribers.filter(s => !welcomed.has(s.email));

  console.log(`\n총 ${subscribers.length}명 중 ${targets.length}명에게 환영 메시지를 발송합니다.`);

  if (targets.length === 0) {
    console.log('모든 구독자가 이미 환영 메시지를 받았습니다.');
    return;
  }

  console.log('');
  for (const { name, email } of targets) {
    const userId = await lookupSlackUserId(email);
    if (!userId) {
      console.warn(`⚠️  [${email}] Slack 계정을 찾을 수 없음 → 건너뜀`);
      continue;
    }

    try {
      const { channel } = await slack.conversations.open({ users: userId });
      await slack.chat.postMessage({
        channel: channel.id,
        text: `안녕하세요, ${name}님! 👾\n히토코토 뉴스레터 구독을 환영해요.\n매주 월요일 아침, 일본어 한 마디를 전달해드릴게요 🍃`,
      });
      welcomed.add(email);
      saveWelcomed(welcomed);
      console.log(`✅  ${name} <${email}> → 환영 메시지 발송 완료`);
    } catch (err) {
      console.error(`❌  [${email}] 발송 실패: ${err.message}`);
    }

    await new Promise(r => setTimeout(r, 1200));
  }

  console.log('\n환영 메시지 발송 완료');
}

// ── 메인 ──────────────────────────────────────────────────
async function main() {
  if (WELCOME_MODE) {
    await runWelcome();
    return;
  }

  if (!AUTO_MODE) {
    console.log('━'.repeat(44));
    console.log('  ⚠️  반드시 별도 터미널에서 실행하세요.');
    console.log('  Claude Code 환경에서는 y/n 입력이 자동');
    console.log('  처리되어 의도치 않게 발송될 수 있습니다.');
    console.log('━'.repeat(44));
    console.log('');
  }

  console.log('📄 뉴스레터 파일 확인 중...');
  const { blocks, filePath } = loadNewsletter();
  const newsletter = { blocks };

  console.log('\n📋 구독자 목록을 불러오는 중...');
  const subscribers = fetchSubscribers();

  if (subscribers.length === 0) {
    console.log('발송 대상이 없습니다. 종료합니다.');
    return;
  }

  console.log('\n── 발송 예정 목록 ──────────────────────');
  subscribers.forEach((s, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${s.name} <${s.email}>`);
  });
  console.log(`${'─'.repeat(40)}`);
  console.log(`  총 ${subscribers.length}명`);

  const previewUserId = await sendPreview(newsletter);

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
    const { stats: autoStats, failures: autoFailures } = await sendToAll(subscribers, newsletter);
    archiveNewsletter(filePath);
    await sendReport(previewUserId, subscribers.length, autoStats, autoFailures);

  } else {
    // ── 수동 모드: 터미널에서 y/n 입력 ──────────────────
    const answer = await confirm('\n미리보기 계정으로 발송했습니다. 확인 후 전체 발송하시겠습니까? (y/n) ');
    if (answer !== 'y') {
      console.log('발송을 취소했습니다.');
      return;
    }
    const { stats, failures } = await sendToAll(subscribers, newsletter);
    archiveNewsletter(filePath);
    await sendReport(previewUserId, subscribers.length, stats, failures);
  }
}

main().catch(err => {
  console.error('💥 예기치 않은 오류:', err.message);
  process.exit(1);
});
