'use strict';
/* 링크에서 레시피 읽어오기 — 페이지를 가져와 요리 이름·출처·분류·재료·만드는 법을 골라낸다 */

const RELAY_KEY = 'recipe-note-relay';
function relayConf() { try { return JSON.parse(localStorage.getItem(RELAY_KEY)) || {}; } catch (e) { return {}; } }
function setRelayConf(c) { try { localStorage.setItem(RELAY_KEY, JSON.stringify(c)); } catch (e) {} }

function naverMobile(url) {
  if (/blog\.naver\.com\/PostView/.test(url)) {
    const b = url.match(/[?&]blogId=([\w-]+)/), n = url.match(/[?&]logNo=(\d+)/);
    if (b && n) return `https://m.blog.naver.com/${b[1]}/${n[1]}`;
  }
  const m = url.match(/^https?:\/\/(?:m\.)?blog\.naver\.com\/([\w-]+)\/(\d+)/);
  return m ? `https://m.blog.naver.com/${m[1]}/${m[2]}` : url;
}

async function withTimeout(p, ms) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms); });
  try { return await Promise.race([p, timeout]); } finally { clearTimeout(t); }
}

// 페이지 가져오기: ① 내 앱스 스크립트 연결 ② 없으면 공개 리더(r.jina.ai), 유튜브는 제목·채널만
async function fetchPage(url) {
  const c = relayConf();
  if (c.url) {
    try {
      const res = await withTimeout(fetch(`${c.url}?key=${encodeURIComponent(c.key || '')}&url=${encodeURIComponent(url)}`), 25000);
      const j = await res.json();
      if (j.ok) return j;
      if (j.error === 'key') return { error: '연결 비밀번호가 맞지 않아요 (⚙︎ 설정 확인)' };
    } catch (e) {}
  }
  if (ytId(url)) {
    const info = await fetchYouTubeInfo(url);
    // 게시자가 퍼가기를 막은 영상은 제목도 알려주지 않는다 → 오류 대신 안내만
    if (!info) return { kind: 'youtube', title: '', author: '', text: '', limited: !c.url, noInfo: true };
    return { kind: 'youtube', title: info.title, author: info.author, text: '', limited: !c.url };
  }
  try {
    const res = await withTimeout(fetch('https://r.jina.ai/' + naverMobile(url)), 30000);
    if (!res.ok) throw new Error(res.status);
    const md = await res.text();
    const title = (md.match(/^Title:\s*(.+)$/m) || [])[1] || '';
    const i = md.indexOf('Markdown Content:');
    return { kind: /naver/.test(url) ? 'naver' : 'web', title, text: i >= 0 ? md.slice(i + 17) : md, jsonld: [] };
  } catch (e) {
    return { error: '페이지를 읽지 못했어요. 잠시 후 ‘다시 가져오기’를 눌러 보세요' };
  }
}

/* ---------- 본문 정리 ---------- */
function cleanLines(text) {
  return String(text || '')
    .replace(/(\d)️?⃣/g, '$1. ')
    .replace(/[​ ﻿]/g, ' ')
    .split(/\r?\n/)
    .map(l => l
      .replace(/^\s*(>\s*)+/, '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\S*\.(?:jpe?g|png|gif|webp)(?:\?\S*)?/gi, '')
      .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1$2')
      .replace(/(\*\*|__|`|^#{1,6}\s)/g, '')
      .replace(/^[\p{Extended_Pictographic}️▶▷►■□◆◇●○◎•·▪◦☆★✔✓☑\-–—*\s]+/u, '')
      .replace(/[\s\-=_▬━─~*]{3,}$/, '')
      .replace(/재\s+료/g, '재료')
      .replace(/\s*[·.…‥ㆍ]{2,}\s*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(l => l && !/^https?:\/\/\S+$/.test(l));
}

const UNIT_RE = /\d|[½⅓¼⅔¾⅛]|약간|조금|적당|톡톡|솔솔|넉넉|취향|한\s?(줌|꼬집|큰술|작은술|컵|개|스푼|숟가락)|반\s?(개|모|컵|큰술|대|단|줌)/;
const META_RE = /시간|난이도|기준|계량|=|분량|인분|칼로리|kcal|조회수|구독/;
function isIngLine(l) {
  if (/^\d{1,2}:\d{2}/.test(l) || /\d{4}\.\s?\d{1,2}\.|네이버|작성자/.test(l) || META_RE.test(l) || /https?:|www\.|\.kr\/|\.com/.test(l) || /\p{Extended_Pictographic}/u.test(l) || /[?!]$/.test(l) || /(요|다|죠|니다)[.~!]*$/.test(l)) return false;
  const p = parseIngredients(l);
  if (!p.length || p.some(i => i.name.length > 15)) return false;
  const withAmt = p.filter(i => i.amt && UNIT_RE.test(i.amt)).length;
  if (p.length === 1) return l.length <= 40 && withAmt === 1;
  return withAmt >= Math.ceil(p.length * 0.6);
}
const isSubHead = l => l.length <= 18 && !/\d/.test(l) && /(재료|양념장?|소스|드레싱|토핑|고명|육수|반죽|필수|선택)[\s:：*\-]*$/.test(l);
// ‘돼지고기,양파,당근’ 처럼 양 없이 이름만 늘어놓은 줄
const isNameList = l => { const p = l.split(/\s*[,，·]\s*/); return p.length >= 2 && p.every(x => x && x.length <= 10 && /[가-힣a-zA-Z]/.test(x) && !/(요|다)[.~!]*$/.test(x)); };
const isIngHead = l => l.length <= 20 && !/^\d{1,2}\s*[.)]/.test(l) && /재료|준비물|ingredient/i.test(l) && !/(요|다)[.~!]*$/.test(l) && !isIngLine(l);
const isStepHead = l => l.length <= 25 && /만드는\s*(법|방법)|만들기|조리\s*(법|순서|방법|과정)|레시피\s*(순서|과정)|how\s*to|recipe\s*steps|^방법\s*[:：]?$/i.test(l) && !isIngLine(l);
const inlineIng = l => /^.{0,10}(재료|양념장?|소스)\s*[:：]\s*\S/.test(l);

function findIngredients(lines) {
  const collect = from => {
    const got = [];
    let miss = 0, end = from, hasAmt = false;
    for (let i = from; i < lines.length; i++) {
      const l = lines[i];
      if (isStepHead(l)) { end = i; break; }
      if (META_RE.test(l) && !isIngLine(l)) { end = i + 1; continue; }
      const ing = isIngLine(l) || inlineIng(l);
      if (ing) hasAmt = true;
      // 양 없이 이름만 늘어놓은 줄은 양이 적힌 재료가 아직 없을 때만 (책 광고 같은 잡음 방지)
      if (ing || isSubHead(l) || (!hasAmt && i - from < 6 && isNameList(l))) { got.push(l); miss = 0; end = i + 1; continue; }
      miss++;
      if ((got.length && miss >= 3) || (!got.length && miss > 6)) break;
    }
    while (got.length && isSubHead(got[got.length - 1])) got.pop();
    return { got, end, start: from };
  };
  // ① ‘재료’ 제목 아래
  for (let i = 0; i < lines.length; i++) {
    if (inlineIng(lines[i])) {
      const r = collect(i);
      if (parseIngredients(r.got.join('\n')).length >= 2) return r;
    }
    if (isIngHead(lines[i])) {
      const r = collect(i + 1);
      if (!r.got.some(l => !isSubHead(l))) continue;
      // ‘[양념 재료]’ 바로 위에 번호 붙은 주재료 목록이 있는 경우도 함께
      const before = [];
      for (let j = i - 1; j >= 0 && before.length < 25 && isIngLine(lines[j]); j--) before.unshift(lines[j]);
      r.start = i - before.length;
      r.got = [...before, lines[i], ...r.got]; // 제목 줄도 넘겨야 ‘양념 재료’ 아래가 양념으로 분류된다
      return r;
    }
  }
  // ② 제목이 없으면 재료처럼 보이는 줄이 3줄 이상 이어진 곳
  let best = { got: [], end: 0 };
  for (let i = 0; i < lines.length; i++) {
    if (!isIngLine(lines[i])) continue;
    const r = collect(i);
    if (r.got.length > best.got.length) best = r;
    i = r.end;
  }
  return best.got.length >= 3 ? best : { got: [], end: 0, start: 0 };
}

// 만드는 법: 조리 동작이 들어간 문장을 빠짐없이 한 단계씩, 블로그의 번호 소제목은 ‘# 소제목’으로
const COOK_RE = /(넣|볶|썰|끓|익|섞|재우|재워|재운|두르|둘러|뿌려|뿌리|굽|구워|구운|데치|데쳐|담아|담고|담가|담근|담아서|불렸|불린|손질|자르|잘라|자른|다지|다져|버무|올리(?!고당)|올려|부어|붓|졸이|졸여|조려|튀기|튀겨|헹구|헹궈|씻|불려|불리|찢|깎|반죽|절이|절여|무치|무쳐|채\s?썰|어슷|저어|젓고|젓지|젓는|저으|풀어|풀고|빼고|빼주|건져|건지|식히|식혀|빻|갈아|갈고|체에|거르|걸러|녹이|녹여|달구|달군|예열|중불|약불|강불|센\s?불|약한\s?불|중약불|뚜껑|마무리|완성|준비|제거|키친타월|물기|간을|간해|곁들|얹|찌고|쪄|삶|말아|바르|발라|펴|덮|숙성|치대|밀어|굴려|꽂|부치|부쳐|지져|지지|데워|데우|끄고|꺼|줄여|줄이|올라오|노릇|투명해|익혀|섞어|섞고|버무려|채반|찬물|뜨거운|분\s?정도|분간|초간)/;
const CHAT_RE = /\?|먹는\s?재미|맛있게\s?(드세요|드실|먹었|만들어\s?(드세요|보세요))|참고해|참고하세요|구독|좋아요|이웃|공감|댓글|포스팅|블로그|오늘은|저녁거리|다녀왔|만나볼게요|만나 볼게요|알려\s?드릴|소개해\s?드릴|볼까요|좋았어요|맛있었|맛있어요|맛있답니다|최고|인기|사\s?와서|장\s?보|시장|좋더라고요|했답니다|하더라고요|생각보다|왔는데|분들이|것\s?같아|느낌|기분|맛있|꿀맛|좋겠|어떨까|고민|느껴진|해보자|해\s?보세요|먹어도|먹으면|먹을\s?수|드셔|즐길|즐겨|궁금|님은|님이|님의|님도|추천하셨|하셨는데|(여|해|아|어)\s?보세요|방송에서|영상에서/;
const END_RE = /^(요리\s?정리|정리|마무리\s?팁|요리\s?팁\s?정리|꿀팁\s?정리|총평|후기|참고|주의사항)\s*[:：]?$|^공감|댓글\s?\d|이웃추가|저작자|등록일|공유하기|계량\s?(법|안내|기준)|^#\S|^태그|^관련\s?(글|영상)|^Q\s?[.:)]|^Q\d|^첫째|^정리하면|^요약|자주\s?묻는|FAQ|궁금해요|궁금하신/;
const NUM_RE = /^(?:(\d{1,2})\s*[.)](?!\d)|([①-⑳])|step\s*(\d+)\s*[.:)]?|(\d{1,2})\s*단계\s*[:：.]?|\d{1,2}\s?(?=[가-힣])(?!(?:분|초|개|인|시간|장|컵|큰술|작은|스푼|숟|번|가지|년|월|일|쪽|알|모|대|줌|마리|봉|팩|공기|토막|방울|바퀴|근|단)))\s*(.*)$/i;
const TERM_RE = { test: l => /(다|요|죠|음|함|임|세요|니다)[.!~^;)\s]*$|[.!]$/.test(l) && !/(보다|처럼|위해|때문에|같이|대신)$/.test(l.trim()) };

// 재료 줄: 재료처럼 생겼고 동사로 끝나지 않는 줄 (‘갈아만든배음료 238ml 캔 1개’는 재료, ‘고추장 3큰술 넣고’는 단계)
const VERB_IN = /(두르|둘러|넣|볶|썰|끓|붓|부어|섞|재우|재워|뿌려|뿌리|올려|담|버무|무쳐|절여|불려|데쳐|삶)(고|어|아|서|며|면|은|는|다|요|주|준)/;
const ingOnly = l => isIngLine(l) && !/(다|요|고|서|며|면|후|어|아|해|가)[.!~]*$/.test(l.trim()) && !VERB_IN.test(l) &&
  parseIngredients(l).every(i => i.amt.length <= 14); // ‘당면은 120g 준비해서 물에 담가’처럼 양 뒤에 말이 길게 붙으면 문장
const CONT_RE = /^(싶|면서|하면|해서|후에?\s|며\s|그리고|그런\s?다음|그다음|(을|를|이|가|은|는|와|과|도|로|으로|에)\s|(넣어|넣고|넣은|넣으|볶아|부어|올려|뿌려|섞어|둘러)[\s,])/;
// 번호 없이 ‘소고기 핏물 제거하기’, ‘꽃게된장찌개 끓이는 법’처럼 짧게 끝나는 줄은 소제목
const isPlainHead = l => l.length <= 22 && !/\d/.test(l) && /(하기|기|법|준비|손질)$/.test(l) && !/[.,!?~]/.test(l) &&
  !/(보기|펼치기|접기|듣기|읽기|쓰기|공유하기|이웃추가하기)$/.test(l);
// 문장이 중간에 끊긴 줄의 끝 (‘두르고’, ‘넣어’, ‘익으면,’ …) — 이런 줄만 다음 줄과 잇는다
const CLAUSE_END = /(고|서|며|면|후|뒤|는데|지만|도록|듯이?|게|에|에서|를|을|와|과|랑|로|으로|이|가|은|는|의|도|만|,|보다|처럼|위해|때문에|하여|해|어|아|준|한|된|둔|운|은|린|채|대로|까지|부터|먼저|같이|함께|모두|다시|바로|살짝|약간|충분히|골고루|아주|수|것|때|등|및|또는|혹은|대신|듬뿍|넉넉히|조금|\+|려|워|춰|쳐|혀|겨|켜|펴)[,\s]*$/;
const SKIP_META = l => /[=※]|계량|난이도|조리\s?시간|요리\s?시간|\d\s?인분/.test(l) && !(COOK_RE.test(l) && l.length > 25 && !/[=※]/.test(l));
function splitSentences(l) {
  return l.split(/(?<=(?:다|요|죠|니다)[.!~]+)\s+|(?<=[.!])\s+(?=[가-힣])/).map(s => s.trim()).filter(Boolean);
}
/* ---------- 만드는 법 다듬기: 설명·결과 문장 빼기, 검색용 키워드 빼기, 비슷한 문장 합치기 ---------- */
// 문장 끝이 ‘~해요/~합니다’ 같은 행동이 아니라 설명·결과·감상으로 끝나는 경우
const EXPLAIN_END = /(이에요|예요|거예요|거든요|답니다|랍니다|더라고요|네요|좋아요|좋습니다|좋죠|좋다|돼요|됩니다|되었어요|됐어요|되었습니다|져요|집니다|진다|버려요|버립니다|있어요|있습니다|있다|없어요|없습니다|않아요|않습니다|않는다|나요|납니다|난다|이죠|죠|입니다|이다|편해요|해지고|살아나요|좋더라고요|수월해요|잖아요|간단해요|간편해요|중요합니다|중요해요|중요하답니다)[.!~^\s]*$/;
const EXPLAIN_WORD = /이유|때문에|때문이|역할|효과|덕분|비결|핵심은|포인트는|차이는|원리|과학|게\s?되면/;
// 문장 안에 할 일(넣어·썰고·볶아주세요…)이 들어 있으면 끝이 ‘~져요’여도 단계로 남긴다
const HAS_TODO = /(주세요|줍니다|줘요|주고|주는데|주면서|준\s?(뒤|후|다음)|넣고|썰고|볶고|끓이고|붓고|섞고|헹구고|담고|두르고|빼고|(넣|썰|볶|끓|부|올|뿌|섞|절|헹|담|둘|데|불|말|구|익|버무|무|풀|자|잘)[가-힣]?(어|아|여|워|려|쳐|혀|라)\s?(서|주|두|놓))/;
// 좋습니다·랍니다·이에요처럼 설명으로 끝나면 할 일이 섞여 있어도 뺀다 (‘~무쳐도 좋습니다’, ‘~반찬이랍니다’)
const STRONG_END = /(이에요|예요|거예요|거든요|답니다|랍니다|더라고요|네요|좋아요|좋습니다|좋죠|좋다|이죠|입니다|이다|잖아요|는데요|데요|좋더라고요|간단해요|간편해요|중요합니다|중요해요)[.!~^\s]*$/;
const isExplain = s => STRONG_END.test(s) || EXPLAIN_WORD.test(s) || /^(이렇게|그러면|그럼|그래야)\s/.test(s) && !/주세요[.!~]*$/.test(s) ||
  (EXPLAIN_END.test(s) && !HAS_TODO.test(s));

// 블로그가 검색용으로 문장 중간에 끼워 넣는 ‘돼지고기 제육볶음 레시피’, ‘황금레시피’ 같은 말
const ADNOMINAL = /(낸|은|는|한|된|든|진|친|운|온|린|인|던|난)$/;
const CLAUSE_WORD = /(고|서|며|면|후|뒤|에|를|을|,)$/;
const isVerbWord = w => COOK_RE.test(w) && !FOOD_END.test(w.replace(/(용|을|를|은|는|이|가|의)$/, ''));
function stripKeywords(s) {
  const w = s.split(/\s+/);
  for (let i = 0; i < w.length; i++) {
    if (!/레시피/.test(w[i])) continue;
    // 레시피 앞의 명사들(요리 이름)을 함께 지운다
    let a = i;
    while (a > 0 && !CLAUSE_WORD.test(w[a - 1]) && !ADNOMINAL.test(w[a - 1]) && !isVerbWord(w[a - 1]) && /^[가-힣]+$/.test(w[a - 1])) a--;
    // ‘들들 볶아낸 (돼지고기 두루치기 레시피)’처럼 요리 이름을 꾸미던 말도 지운다
    if (a > 0 && ADNOMINAL.test(w[a - 1])) {
      a--;
      while (a > 0 && !CLAUSE_WORD.test(w[a - 1]) && !isVerbWord(w[a - 1]) && w[a - 1].length <= 3) a--;
    }
    const tail = w[i].replace(/^.*레시피/, '').replace(/^(로|를|는|가|의|대로|처럼|으로)$/, '');
    w.splice(a, i - a + 1, ...(tail ? [tail] : []));
    i = a - 1;
  }
  return w.join(' ');
}
function tidy(s) {
  s = stripKeywords(s)
    .replace(/(^|\s)(요렇게|요래|짜잔|휘릭|자,)(?=\s)/g, '$1')
    .replace(/\s+(을|를|이|가|은|는)\s/g, '$1 ')
    .replace(/^(넣고|넣어|그리고|그다음|그런다음),?\s+/, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[-–—·•:：,\s]+/, '')
    .trim();
  return s;
}
// 두 문장이 거의 같은 내용인지 (글자 두 개씩 겹치는 비율)
function similar(a, b) {
  const n = x => x.replace(/^💡\s*/, '').replace(/[^가-힣a-z0-9]/gi, '');
  a = n(a); b = n(b);
  if (!a || !b) return false;
  if (Math.min(a.length, b.length) >= 10 && (a.includes(b) || b.includes(a))) return true;
  const grams = x => { const g = new Map(); for (let i = 0; i < x.length - 1; i++) { const k = x.slice(i, i + 2); g.set(k, (g.get(k) || 0) + 1); } return g; };
  const ga = grams(a), gb = grams(b);
  let common = 0;
  ga.forEach((c, k) => { common += Math.min(c, gb.get(k) || 0); });
  return Math.min(a.length, b.length) >= 12 && (2 * common) / (a.length + b.length - 2) >= 0.75;
}
const badHead = h => /[:：]|메뉴|맛있|정말|너무|드셔|궁금|자세히/.test(h) || h.length > 24;

function findSteps(lines, from) {
  // 범위: 재료 다음부터 ‘요리 정리’, 해시태그, 공감·댓글 같은 끝 표시 전까지
  // ‘만드는 법’ 제목 위에 있는 손질법도 챙기려고 재료 부분부터 읽는다 (제목 줄 자체는 아래에서 건너뜀)
  const start = from;
  let end = lines.length;
  for (let i = start; i < lines.length; i++) if (END_RE.test(lines[i])) { end = i; break; }
  const region = lines.slice(start, end);

  // 블로그는 한 문장을 여러 줄로 나눠 쓰는 일이 많아 끝맺지 않은 줄은 다음 줄과 붙인다
  const merged = [];
  for (const l of region) {
    const prev = merged[merged.length - 1];
    const numbered = NUM_RE.test(l);
    if (prev && !prev.head && !numbered && (CONT_RE.test(l) || (!TERM_RE.test(prev.text) && CLAUSE_END.test(prev.text) && !ingOnly(prev.text))) &&
        prev.text.length + l.length < 260 && !SKIP_META(prev.text) && !SKIP_META(l) && !/^[\[【(]/.test(l) &&
        !isStepHead(l)) prev.text += ' ' + l;
    else merged.push({ text: l, numbered, head: (numbered && !TERM_RE.test(l) && !CLAUSE_END.test(l) && l.length <= 30) ||
      (!numbered && isPlainHead(l) && !isStepHead(l) && !isIngHead(l) && !isSubHead(l)) });
  }
  // 짧은 번호 줄 뒤에 설명이 이어지면 ‘1. 재료를 손질해요’처럼 요로 끝나도 소제목
  merged.forEach((x, i) => {
    const next = merged[i + 1];
    if (x.numbered && x.text.length <= 30 && !/다[.!]*$/.test(x.text) && !CLAUSE_END.test(x.text) && next && !next.numbered && !/^[(（]/.test(next.text)) x.head = true;
  });

  const out = [];
  let pendingHead = null, headUsed = true, lastNum = -1, numCount = 0;
  const push = (s, numbered) => {
    s = s.replace(/^[-–—·•:：\s]+/, '').trim();
    if (/^[(（]/.test(s) && out.length && !out[out.length - 1].startsWith('# ')) { out[out.length - 1] += ' ' + s; return; }
    if (s.length < 5 || s.length > 260) return;
    const dup = out.findIndex(x => !x.startsWith('# ') && similar(x, s));
    if (dup >= 0) return; // 같은 말이 또 나오면 처음 것만
    if (pendingHead && !headUsed) { out.push(pendingHead); headUsed = true; }
    out.push(s);
    if (numbered) { lastNum = out.length - 1; numCount++; }
  };
  for (const { text, head } of merged) {
    if (out.length >= 45) break;
    const m = text.match(NUM_RE);
    if (!m && (isStepHead(text) || isIngHead(text) || isSubHead(text))) continue;
    const body = m ? m[5] : text;
    const br = text.match(/^[\[【]\s*([^\]】]{1,20})\s*[\]】]$/); // ‘[제육볶음 팁]’ 같은 괄호 소제목
    if (br) { if (!isIngHead(br[1]) && !isSubHead(br[1])) { pendingHead = '# ' + br[1].trim(); headUsed = false; } continue; }
    if (head) { // ‘1. 야채 자르기’ 같은 번호 소제목
      const h = tidy(body.replace(/[:：]$/, ''));
      if (!badHead(h)) { pendingHead = '# ' + h; headUsed = false; }
      continue;
    }
    if (ingOnly(text) || SKIP_META(text) || (META_RE.test(text) && text.length < 30)) continue;
    const tip = body.match(/^(?:(?:cooking|요리)\s*)?(?:tip|팁|꿀팁|포인트|point)\s*[:：.)]?\s*(.+)$/i);
    if (tip) { if (!EXPLAIN_WORD.test(tip[1]) || /(주세요|하세요|넣으세요)/.test(tip[1])) push('💡 ' + tidy(tip[1])); continue; }
    if (m) { // 번호가 붙은 문장은 그 자체로 한 단계
      if (!CHAT_RE.test(body) && !isExplain(body)) push(tidy(body), true);
      continue;
    }
    // 번호 없는 문장은 ‘~해 주세요/~합니다’처럼 할 일을 말하는 것만 (이유·결과·감상 문장은 뺌)
    for (const s of splitSentences(body)) if (COOK_RE.test(s) && !CHAT_RE.test(s) && !isExplain(s) && (TERM_RE.test(s) || /(주기|하기)$/.test(s))) push(tidy(s));
  }
  // ‘1. … 7.’처럼 번호 단계가 이어진 글은 마지막 번호 뒤의 해설(‘김치를 먼저 볶아야 하는 이유’ 등)을 뺀다
  const heads = out.filter(s => s.startsWith('# ')).length;
  if (numCount >= 3 && heads < 2 && lastNum >= 0) {
    let cut = lastNum + 1;
    while (cut < out.length && /^(💡|\()/.test(out[cut])) cut++; // 바로 뒤의 팁·괄호 설명은 남김
    out.splice(cut);
  }
  // 번호 소제목으로 단계를 나눠 둔 글이면 첫 소제목 앞의 요약·서론은 뺀다
  const first = out.findIndex(s => s.startsWith('# '));
  if (first > 0 && out.filter(s => s.startsWith('# ')).length >= 2) out.splice(0, first);
  return out;
}

/* ---------- 이름·분류 ---------- */
const FOOD_END = /(볶음밥|덮밥|비빔밥|김밥|주먹밥|솥밥|국밥|볶음|찌개|전골|국수|칼국수|수제비|탕|국|조림|무침|구이|찜|전|밥|면|파스타|샐러드|김치|겉절이|나물|튀김|죽|떡볶이|카레|커리|스테이크|장아찌|만두|잡채|스프|수프|샌드위치|토스트|케이크|쿠키|빵|피자|리조또|라면|우동|짜장|짬뽕|냉면|계란말이|오믈렛|장조림|불고기|갈비|수육|보쌈|족발|두루치기|닭갈비|제육|강정|떡|샤브샤브|푸딩|라떼|청|피클|소스|드레싱|무스|머핀|스콘|와플|팬케이크|전병|부침개|볶이|구이|말이|쌈|절임|냉국|솥|덮|롤)$/;
const NOISE = /^(초간단|간단한?|초보|왕초보|황금|황금레시피|레시피|만드는|만드는법|만들기|방법|꿀팁|팁|맛있는|맛있게|진짜|최고의|인생|집밥|자취|자취요리|요리|양념|비법|필수|강추|쉬운|쉽게|초스피드|뚝딱|완벽|정석|대박|존맛|jmt|초|분|만에|하나로|이렇게|해보세요|드세요|꼭|제일|가장|오늘|저녁|아침|점심|메뉴|반찬|밥도둑|레전드|식당|식당보다|보다|더|너무|정말|엄청|꿀조합|feat|ft|shorts|초대박|대박집|맛집|기사식당|국민|누구나|성공|줄서서|먹는|요린이|요린이도|사먹지|마세요|편스토랑|kbscook)$/i;
const VERB_END = /(으면|다면|하면|려면|이면|되면|보면|오면|가면|지면|해도|는데|어요|아요|니다|세요)$/;
function dishFrom(text) {
  const clean = String(text || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const toks = clean.split(' ').filter(t => t && !NOISE.test(t) && !/^\d+(분|초|가지|인분|g|kg)?$/.test(t));
  for (let i = 0; i < toks.length; i++) {
    let t = toks[i].replace(/(레시피|만들기|만드는법|황금레시피)$/, '');
    const bare = t.replace(/(으로|로|을|를|이|가|은|는|의|도|과|와|랑)$/, '');
    if (!FOOD_END.test(t) && FOOD_END.test(bare)) t = bare;
    if (FOOD_END.test(t) && /[가-힣]/.test(t) && !VERB_END.test(toks[i])) {
      const prev = toks[i - 1];
      if (t.length <= 2 && prev && prev.length <= 4 && !/(의|는|은|한|인|운|된|던)$/.test(prev)) return prev + ' ' + t; // 예: 소고기 전골
      return t;
    }
  }
  return '';
}
function dishName(title, extra) {
  title = String(title || '');
  const raw = title.replace(/\s*[|│｜]\s*.*$/, '').replace(/\s[-–—:/]\s.*$/, '').trim();
  const brackets = [...title.matchAll(/\[([^\]]*)\]|【([^】]*)】/g)].map(m => m[1] || m[2]).filter(s => !/^#/.test(s));
  const tags = [...(title + ' ' + (extra || '')).matchAll(/#([가-힣]{2,12})/g)].map(m => m[1]);
  const body = raw.replace(/\[[^\]]*\]|【[^】]*】|\([^)]*\)|#\S+/g, ' ');
  return dishFrom(body) || brackets.map(dishFrom).find(Boolean) || tags.map(dishFrom).find(Boolean) ||
    // 요리 이름을 못 찾으면 제목을 그대로 (직접 고치기 쉽게)
    body.replace(/\s+/g, ' ').trim() || title.trim();
}

const MEAT_RE = /^(돼지|소고기|쇠고기|닭|오리|삼겹|목살|앞다리|뒷다리|항정|차돌|갈비|사태|양지|등심|안심|우삼겹|다짐육|다진고기|베이컨|햄|스팸|소시지|고기)/;
const SEA_RE = /^(오징어|새우|조개|바지락|홍합|굴$|고등어|연어|참치|멸치$|낙지|쭈꾸미|주꾸미|전복|꽃게|게살|명태|동태|코다리|생선|갈치|삼치|대구|문어|골뱅이|어묵|맛살|미역|다시마)/;
function guessTags(name, ings) {
  const n = norm(name), tags = [];
  const main = ings.filter(i => !i.seas).map(i => norm(i.name));
  const add = t => { if (!tags.includes(t)) tags.push(t); };
  if (/(찌개|국|탕|전골|국밥|수프|스프|샤브샤브|냉국)$/.test(n) && !/국수$/.test(n)) add('국물');
  if (/(볶음밥|덮밥|비빔밥|김밥|주먹밥|솥밥|리조또|죽|밥)$/.test(n)) add('밥');
  else if (/(국수|면|파스타|라면|우동|짜장|짬뽕|냉면|수제비|스파게티)$/.test(n)) add('면');
  else if (/(무침|조림|나물|볶음|장아찌|겉절이|전|계란말이|장조림|김치|부침개|말이|샐러드)$/.test(n)) add('반찬');
  if (/(케이크|쿠키|빵|푸딩|떡|토스트|샌드위치|머핀|스콘|와플|팬케이크|라떼|강정|무스)$/.test(n)) add('간식');
  if (/(불고기|제육|수육|보쌈|족발|두루치기|스테이크|갈비|닭갈비|삼겹)/.test(n) || main.some(m => MEAT_RE.test(m))) add('고기');
  if (main.some(m => SEA_RE.test(m)) || /(오징어|새우|해물|생선|조개|낙지|쭈꾸미|주꾸미)/.test(n)) add('해산물');
  return tags.slice(0, 3);
}

function recipeFromLD(list) {
  for (const raw of list || []) {
    let d;
    try { d = JSON.parse(raw); } catch (e) { continue; }
    const stack = [d];
    while (stack.length) {
      const x = stack.pop();
      if (!x || typeof x !== 'object') continue;
      if (Array.isArray(x)) { stack.push(...x); continue; }
      const t = x['@type'];
      if (t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'))) return x;
      if (x['@graph']) stack.push(x['@graph']);
    }
  }
  return null;
}
function ldSteps(ins) {
  const out = [];
  const walk = x => {
    if (!x) return;
    if (typeof x === 'string') { x.split(/\n+/).forEach(s => s.trim() && out.push(s.trim())); return; }
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (x.itemListElement) { if (x.name) out.push('# ' + String(x.name).trim()); walk(x.itemListElement); return; }
    if (x.text) out.push(String(x.text).trim());
  };
  walk(ins);
  return out;
}
const textOf = v => Array.isArray(v) ? v.map(textOf).join(', ') : v && typeof v === 'object' ? (v.name || '') : String(v || '');

// 가져온 페이지 → 앱 필드
function extractRecipe(page, url) {
  const res = { srcTitle: (page.title || '').trim() };
  let host = hostOf(url);
  const naverId = (url.match(/blog\.naver\.com\/([\w-]+)/) || [])[1];
  res.srcName = (page.author || page.siteName || (naverId ? `네이버 블로그 ${naverId}` : host) || '').trim();

  const ld = recipeFromLD(page.jsonld);
  if (ld) {
    res.title = dishName(ld.name || page.title);
    const ingText = (Array.isArray(ld.recipeIngredient) ? ld.recipeIngredient : [ld.recipeIngredient || '']).join('\n');
    res.ings = parseIngredients(ingText);
    res.steps = ldSteps(ld.recipeInstructions).join('\n');
    if (!page.author && ld.author) res.srcName = textOf(ld.author) || res.srcName;
  } else {
    const lines = cleanLines(page.text);
    const f = findIngredients(lines);
    res.title = dishName(page.title, page.text);
    res.ings = parseIngredients(f.got.join('\n'));
    // 만드는 법은 재료 목록이 시작하는 곳부터 읽는다 (재료 사이에 섞인 손질법도 포함)
    res.steps = findSteps(lines, f.got.length ? f.start : 0).join('\n');
  }
  // 같은 재료가 두 번 잡히면 하나만
  const seen = new Set();
  res.ings = res.ings.filter(i => { const k = norm(i.name) + '|' + norm(i.amt); if (seen.has(k)) return false; seen.add(k); return true; });
  res.tags = guessTags(res.title, res.ings);
  return res;
}

async function readRecipeFromUrl(url) {
  const page = await fetchPage(url);
  if (!page || page.error) return { error: page ? page.error : '읽지 못했어요' };
  const r = extractRecipe(page, page.finalUrl || url);
  r.limited = page.limited;
  r.noInfo = page.noInfo;
  return r;
}
