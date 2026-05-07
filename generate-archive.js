'use strict';
const fs   = require('fs');
const path = require('path');

const SENT_DIR = path.resolve('./newsletters/sent');
const DOCS_DIR = path.resolve('./docs');

// ── 유틸 ──────────────────────────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Slack mrkdwn → HTML (bold, code, 이모지)
function mrkdwn(text) {
  return esc(text)
    .replace(/\*(.+?)\*/g, '<b>$1</b>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/:bulb:/g, '💡')
    .replace(/\n/g, '<br>');
}

// rich_text 요소 배열 → HTML
function rtElems(elements) {
  return elements.map(el => {
    if (el.type !== 'text') return '';
    const t = esc(el.text).replace(/\n/g, '<br>');
    return el.style?.bold ? `<b>${t}</b>` : t;
  }).join('');
}

// 한자(ふりがな) → <ruby> 변환 (markdown, rich_text_preformatted 전용)
// 베이스는 한자만 허용 — 히라가나를 포함하면 앞 문맥까지 탐욕적으로 묶임
function rubyify(text) {
  return text.replace(
    /([\u4E00-\u9FFF\u3400-\u4DBF々\u3005]+)\(([\u3041-\u3096\u30A1-\u30FAー]+)\)/g,
    '<ruby>$1<rt style="font-size:0.6em;color:#888;">$2</rt></ruby>'
  );
}

// ── Markdown 파이프 테이블 → HTML ─────────────────────────
function mdTable(md) {
  const lines = md.trim().split('\n');
  const parse = l => l.split('|').slice(1, -1).map(c => c.trim());
  const headers = parse(lines[0]);
  const rows    = lines.slice(2).map(parse);
  const thead = `<thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${rows.map(r =>
    `<tr>${r.map(c => `<td>${rubyify(esc(c))}</td>`).join('')}</tr>`
  ).join('\n')}</tbody>`;
  return `<div style="border-radius:8px;overflow:hidden;"><table>${thead}${tbody}</table></div>`;
}

// ── Block Kit → HTML ──────────────────────────────────────
function blocksToHtml(blocks) {
  const sections = [];
  let bodyParts  = [];

  function flushBody() {
    if (!bodyParts.length) return;
    sections.push(`<div class="body">\n${bodyParts.join('\n')}\n</div>`);
    bodyParts = [];
  }

  for (const block of blocks) {
    switch (block.type) {

      case 'header':
        flushBody();
        sections.push(`<div class="section-header"><h2>${esc(block.text.text)}</h2></div>`);
        break;

      case 'divider':
        // section-header가 시각적 구분을 담당하므로 생략
        break;

      case 'context':
        flushBody();
        sections.push(
          `<footer>👾 Hitokoto | 매주 월요일 발행<br>이번 호 어떠셨나요? 뉴스레터 구독을 원하시면 <a href="https://forms.gle/CJ76h8Uk6wwNTjtw9" style="background:#EBEBEA; border-radius:4px; padding:1px 5px; font-size:0.85em; font-family:monospace; text-decoration:none; color:inherit;">여기</a>를 눌러주세요.</footer>`
        );
        break;

      case 'section': {
        const t = block.text;
        if (!t || !t.text.trim()) break;
        bodyParts.push(
          t.type === 'plain_text'
            ? `<p>${esc(t.text).replace(/\n/g, '<br>')}</p>`
            : `<p class="tip">${mrkdwn(t.text)}</p>`
        );
        break;
      }

      case 'rich_text':
        for (const el of block.elements) {
          if (el.type === 'rich_text_section') {
            bodyParts.push(`<p>${rtElems(el.elements)}</p>`);
          } else if (el.type === 'rich_text_list') {
            const lis = el.elements
              .map(i => `<li>${rtElems(i.elements)}</li>`)
              .join('\n');
            bodyParts.push(`<ul>\n${lis}\n</ul>`);
          } else if (el.type === 'rich_text_preformatted') {
            const raw = el.elements.map(e => e.text).join('');
            bodyParts.push(`<pre>${rubyify(esc(raw))}</pre>`);
          }
        }
        break;

      case 'markdown':
        bodyParts.push(mdTable(block.text));
        break;
    }
  }

  flushBody();
  return sections.join('\n');
}

// ── CSS ───────────────────────────────────────────────────
const PAGE_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Noto Sans KR', sans-serif;
    background: #F7F6F3;
    color: #1D1C1B;
    line-height: 1.75;
    padding: 40px 16px 80px;
  }
  .container { max-width: 860px; margin: 0 auto; }
  .back {
    display: inline-block;
    margin-bottom: 16px;
    font-size: 0.85rem;
    color: #aaa;
    text-decoration: none;
  }
  .back:hover { color: #1D1C1B; }
  .card {
    background: #fff;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 2px 12px rgba(0,0,0,0.07);
  }
  .section-header {
    background: #1D1C1B;
    padding: 18px 28px;
  }
  .section-header h2 {
    color: #fff;
    font-size: 1rem;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .body { padding: 20px 28px; }
  .body > * + * { margin-top: 14px; }
  p { font-size: 0.93rem; color: #333; }
  p.tip {
    background: #F0F0EE;
    border-radius: 8px;
    padding: 12px 16px;
    font-size: 0.88rem;
    color: #444;
  }
  ul { padding-left: 18px; }
  ul li { font-size: 0.93rem; color: #333; margin-bottom: 8px; }
  ul li:last-child { margin-bottom: 0; }
  pre {
    background: #F0F0EE;
    border-radius: 8px;
    padding: 16px 18px;
    font-family: 'Noto Sans KR', monospace;
    font-size: 0.85rem;
    line-height: 1.85;
    white-space: pre-wrap;
    word-break: break-word;
    color: #333;
  }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th {
    background: #2E2D2C;
    color: #fff;
    padding: 9px 12px;
    text-align: left;
    font-weight: 600;
  }
  td {
    padding: 8px 12px;
    border-bottom: 1px solid #EBEBEA;
    color: #333;
    vertical-align: top;
  }
  tr:last-child td { border-bottom: none; }
  tr:nth-child(even) td { background: #FAFAF9; }
  code {
    background: #EBEBEA;
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 0.85em;
    font-family: monospace;
  }
  footer {
    background: #F7F6F3;
    border-top: 1px solid #EBEBEA;
    padding: 18px 28px;
    font-size: 0.8rem;
    color: #999;
    line-height: 1.7;
  }
`;

const INDEX_CSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Noto Sans KR', sans-serif;
    background: #F7F6F3;
    color: #1D1C1B;
    padding: 60px 16px 80px;
  }
  .card {
    max-width: 860px;
    margin: 0 auto;
    background: #fff;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 2px 12px rgba(0,0,0,0.07);
  }
  .card-header {
    background: #1D1C1B;
    padding: 20px 28px;
    text-align: center;
  }
  .card-header h1 {
    color: #fff;
    font-size: 1.1rem;
    font-weight: 800;
    letter-spacing: -0.01em;
  }
  .card-header p {
    color: rgba(255,255,255,0.65);
    font-size: 0.78rem;
    margin-top: 5px;
  }
  ul { list-style: none; padding: 6px 0; }
  ul li a {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    padding: 13px 28px;
    text-decoration: none;
    color: #1D1C1B;
    border-bottom: 1px solid #F0F0EE;
    transition: background 0.12s;
  }
  ul li:last-child a { border-bottom: none; }
  ul li a:hover { background: #FAFAF9; }
  .date  { font-size: 0.78rem; color: #bbb; min-width: 36px; }
  .topic { font-size: 0.92rem; font-weight: 500; }
`;

// ── 페이지 빌더 ───────────────────────────────────────────
function newsletterPage(title, content) {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} — 히토코토</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet">
  <style>${PAGE_CSS}</style>
</head>
<body>
  <div class="container">
    <a class="back" href="index.html">← 목록으로</a>
    <div class="card">
      ${content}
    </div>
  </div>
</body>
</html>`;
}

function indexPage(items) {
  const listHtml = items.map(({ date, topic, htmlFile }) => {
    const [, m, d] = date.split('-');
    const dateStr  = `${parseInt(m)}/${parseInt(d)}`;
    return `    <li><a href="${htmlFile}"><span class="date">${dateStr}</span><span class="topic">${esc(topic)}</span></a></li>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>히토코토 아카이브</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&display=swap" rel="stylesheet">
  <style>${INDEX_CSS}</style>
</head>
<body>
  <div class="card">
    <div class="card-header">
      <h1>👾 Hitokoto | 아카이브</h1>
      <p>지금까지 발행된 뉴스레터 모음</p>
    </div>
    <ul>
${listHtml}
    </ul>
  </div>
</body>
</html>`;
}

// ── 메인 ──────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(SENT_DIR)) {
    console.error('❌ newsletters/sent/ 폴더를 찾을 수 없습니다.');
    process.exit(1);
  }

  if (!fs.existsSync(DOCS_DIR)) {
    fs.mkdirSync(DOCS_DIR, { recursive: true });
    console.log('📁 docs/ 폴더 생성');
  }

  const files = fs.readdirSync(SENT_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}.*\.json$/.test(f))
    .sort()
    .reverse(); // 최신순

  if (!files.length) {
    console.log('📭 발송된 뉴스레터가 없습니다.');
    return;
  }

  const items = [];

  for (const file of files) {
    const parsed = JSON.parse(fs.readFileSync(path.join(SENT_DIR, file), 'utf-8'));
    const blocks = Array.isArray(parsed) ? parsed : parsed.blocks;

    const m     = file.match(/^(\d{4}-\d{2}-\d{2})-(.+)\.json$/);
    const date  = m ? m[1] : file.replace('.json', '');
    const topic = m ? m[2] : file.replace('.json', '');

    const htmlFile = file.replace('.json', '.html');
    fs.writeFileSync(
      path.join(DOCS_DIR, htmlFile),
      newsletterPage(topic, blocksToHtml(blocks)),
      'utf-8'
    );
    console.log(`✅ ${htmlFile}`);
    items.push({ date, topic, htmlFile });
  }

  fs.writeFileSync(path.join(DOCS_DIR, 'index.html'), indexPage(items), 'utf-8');
  console.log(`✅ index.html  (총 ${items.length}개)`);
}

main();
