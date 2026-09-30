'use strict';

/* ---------- 저장 ---------- */
const KEY = 'recipe-note-v1';
let db = load();

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && Array.isArray(d.recipes)) {
      // 예전에는 이름만 저장했으므로 {이름, 양, 보관 장소, 넣은 날} 형식으로 바꾼다
      d.fridge = (d.fridge || []).map(f => typeof f === 'string' ? { id: Math.random().toString(36).slice(2, 10), name: f, qty: '', place: '냉장', at: Date.now() } : f);
      d.shop = Object.assign({ ids: [], checked: {}, extra: [] }, d.shop);
      return d;
    }
  } catch (e) {}
  return { v: 1, recipes: [], fridge: [], shop: { ids: [], checked: {}, extra: [] } };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); }
  catch (e) { toast('저장하지 못했어요. 저장 공간을 확인해 주세요.'); }
  updateBadge();
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ---------- 도우미 ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const norm = s => String(s || '').replace(/\(.*?\)|（.*?）/g, '').replace(/\s+/g, '').toLowerCase();
const byId = id => db.recipes.find(r => r.id === id);
const fmtDate = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2200);
}

/* ---------- 출처 ---------- */
function ytId(url) {
  const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}
function srcType(url) {
  if (!url) return { key: 'etc', label: '직접' };
  if (ytId(url) || /youtube\.com|youtu\.be/.test(url)) return { key: 'youtube', label: '유튜브' };
  if (/instagram\.com/.test(url)) return { key: 'insta', label: '인스타' };
  if (/blog\.naver|tistory|brunch|blogspot|wordpress|egloos|velog|blog\./.test(url)) return { key: 'blog', label: '블로그' };
  return { key: 'etc', label: '웹' };
}
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\.|^m\./, ''); } catch (e) { return ''; } }
function thumbHTML(r, cls = 'thumb') {
  const id = ytId(r.url);
  if (id) return `<img class="${cls}" src="https://i.ytimg.com/vi/${id}/mqdefault.jpg" alt="" loading="lazy">`;
  return `<div class="${cls}">${esc((r.title || '?').trim().charAt(0))}</div>`;
}
function fixUrl(u) {
  u = (u || '').trim();
  const m = u.match(/https?:\/\/\S+/);
  if (m) return m[0];
  if (u && /^[\w-]+(\.[\w-]+)+/.test(u)) return 'https://' + u;
  return u;
}
async function fetchYouTubeInfo(url) {
  const tries = [
    `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
    `https://noembed.com/embed?url=${encodeURIComponent(url)}`,
  ];
  for (const u of tries) {
    try {
      const res = await fetch(u);
      if (!res.ok) continue;
      const j = await res.json();
      if (j.title) return { title: j.title, author: j.author_name || '' };
    } catch (e) {}
  }
  return null;
}

/* ---------- 재료 ---------- */
const SEAS = new Set(('소금 굵은소금 꽃소금 설탕 흑설탕 간장 진간장 국간장 양조간장 맛간장 고추장 된장 쌈장 고춧가루 참기름 들기름 식용유 ' +
  '올리브유 올리브오일 포도씨유 카놀라유 후추 후춧가루 통후추 다진마늘 다진생강 생강가루 물엿 올리고당 꿀 맛술 미림 청주 소주 ' +
  '식초 굴소스 참깨 깨 통깨 깨소금 물 케첩 케찹 마요네즈 버터 액젓 멸치액젓 까나리액젓 새우젓 매실액 매실청 다시다 치킨스톡 ' +
  '연두 요리당 조청 전분 감자전분 전분가루 밀가루 부침가루 튀김가루 고추기름 머스타드 와사비 레몬즙 쯔유 혼다시 msg 미원 ' +
  '계피 월계수잎 파슬리 파슬리가루 물전분 육수 멸치육수 쌀뜨물 황설탕 원당 참치액 두반장 페퍼론치노 바질 오레가노 강황').split(' '));
// 양념 목록 안에 있어도 장을 봐야 하는 주재료
const MAIN_RE = /^(돼지|소고기|쇠고기|닭|오리|삼겹|목살|앞다리|고기|양파|대파|쪽파|파$|당근|감자|고구마|애호박|호박|버섯|표고|팽이|새송이|느타리|두부|계란|달걀|배추|무$|청양고추|풋고추|홍고추|고추$|양배추|콩나물|숙주|시금치|부추|깻잎|오이|가지|떡|어묵|햄|소시지|베이컨|오징어|새우|조개|김치|사과|배$|레몬|치즈|우유|생크림)/;
function isSeasoning(name) {
  const n = norm(name);
  return SEAS.has(n) || /(설탕|간장|액젓|식초|소스|가루|기름|물엿|쌀엿|올리고당|미림|맛술|후추)$/.test(n) && !/(빵가루|카레가루|콩가루)$/.test(n);
}
// 쉼표로 나누되 괄호 안의 쉼표는 그대로 둔다: ‘삼겹살(혹은 앞다리살, 목살) 450g’
function splitItems(line) {
  const out = [];
  let depth = 0, cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if ('(（['.includes(c)) depth++;
    else if (')）]'.includes(c)) depth = Math.max(0, depth - 1);
    const sep = depth === 0 && (/[,，·•|]/.test(c) && !(c === ',' && /\d/.test(line[i - 1] || '') && /^\d{3}\D/.test(line.slice(i + 1) + ' ')) ||
      (c === '/' && line[i - 1] === ' ' && line[i + 1] === ' '));
    if (sep) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim()).filter(Boolean);
}
function inFridge(name) {
  const n = norm(name);
  if (!n) return false;
  return db.fridge.some(x => {
    const f = norm(fridgeName(x));
    return n === f || (f.length >= 2 && n.includes(f)) || (n.length >= 2 && f.includes(n));
  });
}
function analyze(r) {
  const main = r.ings.filter(i => !i.seas && i.name);
  const have = main.filter(i => inFridge(i.name));
  const miss = main.filter(i => !inFridge(i.name));
  return { main, have, miss };
}

// 블로그에서 복사한 재료 목록을 한 줄씩(또는 쉼표로) 나눠 이름/양으로 바꾼다
const AMT_RE = /^(.+?)\s*((?:약|대략|반|한|두|세|네)?\s*[\d½⅓¼⅔¾⅛.,\/~\-]+.*|약간씩?|조금씩?|적당량|적당히|톡톡|솔솔|넉넉히|넉넉하게|취향껏|기호에\s*맞게.*|(?:한|반|두|세)\s?(?:개|컵|큰술|작은술|숟가락|스푼|줌|모|단|대|꼬집|장|알|쪽|봉|팩|T|t|공기|토막|마리).*)$/;
const HEAD_WORD = /^(?:주|부|필수|선택|기본)?\s*(?:재료|양념장?|소스|드레싱|토핑|고명|육수|반죽)$/;
const HEAD_END = '(?:재료|양념장?|소스|드레싱|토핑|고명|육수|반죽)';
function headerOf(line) {
  let h = line.match(/^[\[【<]\s*([^\]】>]{1,14})\s*[\]】>]\s*(.*)$/);
  if (h) return h;
  h = line.match(new RegExp('^(.{0,12}' + HEAD_END + ')\\s*[:：]\\s*(.*)$'));
  if (h && !/^[\d½⅓¼⅔¾⅛]|^(약간|조금|적당)/.test(h[2]) && (HEAD_WORD.test(h[1].trim()) || !isSeasoning(h[1]))) return h;
  h = line.match(new RegExp('^(.{0,12}' + HEAD_END + ')[\\s:：*\\-]*$'));
  if (h && !/\d/.test(line) && (HEAD_WORD.test(h[1].trim()) || !isSeasoning(h[1]))) return h;
  // ‘야채 : 양파 1개’ 처럼 짧은 이름표 뒤에 재료가 오는 경우
  h = line.match(/^([가-힣]{1,4}(?:\s[가-힣]{1,4})?)\s*[:：]\s*([^\d½⅓¼⅔¾⅛].*)$/);
  if (h && !isSeasoning(h[1]) && /\d|약간|조금|적당|,/.test(h[2])) return h;
  return null;
}
function parseIngredients(text) {
  const out = [];
  let seasMode = false;
  for (let line of String(text).split(/\r?\n/)) {
    line = line.trim().replace(/^[-*•·▪◦○●■□◆◇★☆✔✓☑▶︎>]+\s*/, '').replace(/\s*[·.…‥ㆍ]{2,}\s*/g, ' '); // ‘김치 ·····600g’
    if (!line) continue;
    const h = headerOf(line);
    if (h) {
      seasMode = /양념|소스|드레싱|seasoning|sauce/i.test(h[1]);
      line = (h[2] || '').trim();
      if (!line) continue;
    }
    for (let part of splitItems(line)) {
      part = part.replace(/^[-*•·▪◦○●✔✓☑□■▶︎>\s]+/, '').replace(/^\d+[.)]\s+/, '').trim();
      if (!part) continue;
      let name = part, amt = '';
      const p = part.match(/^([^\d(（]+?)\s*[\(（]([^)）]*)[\)）]\s*$/);
      const m = !p && part.match(AMT_RE);
      if (p) { name = p[1]; amt = p[2]; }
      else if (m) { name = m[1]; amt = m[2]; }
      name = name.replace(/[:：]$/, '').trim();
      const adv = name.match(/^(.+?)\s+(듬뿍|조금|약간|넉넉히|살짝)$/); // ‘고추장 듬뿍 1스푼’
      if (adv) { name = adv[1]; amt = (adv[2] + ' ' + amt).trim(); }
      if (!/[가-힣a-zA-Z]/.test(name) || /^\d/.test(name) || /^(약|대략|약간|조금)$/.test(name)) continue;
      if (!amt && /재료|준비물|레시피/.test(name)) continue; // ‘제육볶음 재료)’ 같은 제목 조각
      if (HEAD_WORD.test(name) || /\d{4}\.\s?\d{1,2}\.|네이버|작성자/.test(part)) continue; // ‘주재료 (황금비율 2:1)’, 글 날짜
      out.push({ name, amt: amt.trim(), seas: isSeasoning(name) || (seasMode && !MAIN_RE.test(norm(name))) });
    }
  }
  return out;
}
function stepsOf(r) {
  return String(r.steps || '').split(/\r?\n/).map(s => s.trim().replace(/^(\d+\s*[.)]|[-*•]|step\s*\d+[.:)]?)\s*/i, '')).filter(Boolean);
}

/* ---------- 라우팅 ---------- */
let navDepth = 0;
function go(hash) { navDepth++; location.hash = hash; }
function back() {
  if (navDepth > 0) { navDepth--; history.back(); }
  else location.hash = '#/recipes';
}
window.addEventListener('hashchange', render);

const ui = { q: '', tag: '', sort: 'new', draft: null, draftFor: null, showPaste: false };

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  return { name: parts[0] || 'recipes', id: parts[1] ? decodeURIComponent(parts[1]) : null };
}

function setHeader(title, { back: showBack = false, actions = '' } = {}) {
  $('#title').textContent = title;
  $('#backBtn').hidden = !showBack;
  $('#topActions').innerHTML = actions;
}

function render() {
  const r = route();
  const tab = r.name === 'fridge' ? 'fridge' : r.name === 'shop' ? 'shop' : 'recipes';
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  const v = $('#view');
  if (r.name === 'r' && byId(r.id)) v.innerHTML = viewDetail(byId(r.id));
  else if (r.name === 'edit' || r.name === 'new') v.innerHTML = viewEdit(r.name === 'edit' ? byId(r.id) : null);
  else if (r.name === 'fridge') v.innerHTML = viewFridge();
  else if (r.name === 'shop') v.innerHTML = viewShop();
  else v.innerHTML = viewList();
  if (r.name !== 'edit' && r.name !== 'new') ui.draft = null;
  window.scrollTo(0, 0);
  updateBadge();
}
function rerender() { // 스크롤 위치 유지
  const y = window.scrollY;
  const f = document.activeElement && document.activeElement.id;
  render();
  window.scrollTo(0, y);
  if (f && document.getElementById(f)) document.getElementById(f).focus();
}
function updateBadge() {
  const b = $('#shopBadge');
  const n = db.shop.ids.length + db.shop.extra.length;
  b.hidden = !n; b.textContent = n;
}

/* ---------- 레시피 목록 ---------- */
function allTags() {
  const m = new Map();
  db.recipes.forEach(r => (r.tags || []).forEach(t => m.set(t, (m.get(t) || 0) + 1)));
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
}
function viewList() {
  setHeader('레시피', {
    actions: `<button class="icon-btn" data-act="settings" aria-label="설정">⚙︎</button>
              <button class="btn primary" data-act="new">＋ 추가</button>`,
  });
  if (!db.recipes.length) {
    return `<div class="empty"><div class="big">🍳</div>
      <p>아직 저장한 레시피가 없어요.<br>블로그나 유튜브에서 본 요리를 기록해 두세요.</p>
      <button class="btn primary" data-act="new">첫 레시피 추가하기</button></div>`;
  }
  const q = norm(ui.q);
  let list = db.recipes.filter(r =>
    (!ui.tag || (r.tags || []).includes(ui.tag)) &&
    (!q || norm(r.title).includes(q) || norm(r.srcName).includes(q) || norm(r.srcTitle).includes(q) || r.ings.some(i => norm(i.name).includes(q)) || (r.tags || []).some(t => norm(t).includes(q))));
  const sorts = {
    new: (a, b) => b.createdAt - a.createdAt,
    name: (a, b) => a.title.localeCompare(b.title, 'ko'),
    cooked: (a, b) => (b.cooked || 0) - (a.cooked || 0) || (b.lastCooked || 0) - (a.lastCooked || 0),
  };
  list.sort(sorts[ui.sort]);
  const tags = allTags();
  return `
    <input class="search" id="q" type="search" placeholder="요리 이름, 재료, 채널로 찾기" value="${esc(ui.q)}">
    <div class="filter-bar">
      <select class="chip" id="sort" aria-label="정렬">
        <option value="new" ${ui.sort === 'new' ? 'selected' : ''}>최근 추가</option>
        <option value="name" ${ui.sort === 'name' ? 'selected' : ''}>가나다</option>
        <option value="cooked" ${ui.sort === 'cooked' ? 'selected' : ''}>자주 만든</option>
      </select>
      ${tags.length ? `<button class="chip ${!ui.tag ? 'on' : ''}" data-act="tag" data-v="">전체</button>` : ''}
      ${tags.map(t => `<button class="chip ${ui.tag === t ? 'on' : ''}" data-act="tag" data-v="${esc(t)}">${esc(t)}</button>`).join('')}
    </div>
    <div class="list">
      ${list.map(recipeCard).join('') || `<div class="empty">찾는 레시피가 없어요.</div>`}
    </div>`;
}
function recipeCard(r) {
  const st = srcType(r.url);
  const main = r.ings.filter(i => !i.seas).map(i => i.name);
  return `<button class="card recipe-card" data-act="open" data-id="${r.id}">
    ${thumbHTML(r)}
    <div class="body">
      <div class="name">${esc(r.title)}</div>
      <div class="meta"><span class="src-tag src-${st.key}">${st.label}</span>${esc(r.srcName || hostOf(r.url) || '')}</div>
      <div class="meta">${esc(main.slice(0, 6).join(', '))}${main.length > 6 ? ' 외' : ''}</div>
    </div>
  </button>`;
}

/* ---------- 레시피 상세 ---------- */
function viewDetail(r) {
  const inShop = db.shop.ids.includes(r.id);
  setHeader(r.title, {
    back: true,
    actions: `<button class="btn" data-act="edit" data-id="${r.id}">수정</button>`,
  });
  const st = srcType(r.url);
  const id = ytId(r.url);
  const main = r.ings.filter(i => !i.seas);
  const seas = r.ings.filter(i => i.seas);
  const steps = stepsOf(r);
  const ingLi = i => `<li><span class="dot ${inFridge(i.name) ? 'have' : ''}"></span>${esc(i.name)}<span class="amt">${esc(i.amt)}</span></li>`;
  return `
    ${id ? `<img class="hero" src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="">` : ''}
    ${r.url ? `<a class="card src-box" href="${esc(r.url)}" target="_blank" rel="noopener" style="text-decoration:none;color:inherit">
        <span class="src-tag src-${st.key}">${st.label}</span>
        <div class="txt"><div><b>${esc(r.srcName || hostOf(r.url))}</b></div><div class="url">${esc(r.srcTitle || r.url)}</div></div>
        <span class="btn small primary">${id ? '영상 보기' : '원문 보기'} ↗</span>
      </a>` : r.srcName ? `<div class="card src-box"><span class="src-tag src-etc">출처</span><div class="txt"><b>${esc(r.srcName)}</b></div></div>` : ''}
    ${(r.tags || []).length ? `<div class="chips" style="margin-top:10px">${r.tags.map(t => `<span class="chip">#${esc(t)}</span>`).join('')}</div>` : ''}
    <div class="muted small" style="margin-top:8px">${r.cooked ? `${r.cooked}번 만들었어요 · 마지막 ${fmtDate(r.lastCooked)}` : '아직 안 만들어 봤어요'}</div>

    <div class="section-title">재료 <span class="count">${main.length}</span><span class="spacer"></span>
      ${db.fridge.length ? `<span class="muted small"><span class="dot have" style="display:inline-block"></span> 냉장고에 있음</span>` : ''}</div>
    ${main.length ? `<ul class="card ing-list">${main.map(ingLi).join('')}</ul>` : `<div class="muted small">입력한 재료가 없어요.</div>`}
    ${seas.length ? `<div class="section-title">양념 <span class="count">${seas.length}</span></div>
      <ul class="card ing-list">${seas.map(ingLi).join('')}</ul>` : ''}

    ${steps.length ? `<div class="section-title">만드는 법</div>
      <ol class="card steps">${steps.map(s => s.startsWith('# ') ? `<li class="sub">${esc(s.slice(2))}</li>` : s.startsWith('💡') ? `<li class="tip"><div>${esc(s)}</div></li>` : `<li><div>${esc(s)}</div></li>`).join('')}</ol>` : ''}
    ${r.memo ? `<div class="section-title">메모</div><div class="card memo">${esc(r.memo)}</div>` : ''}

    <div class="action-bar">
      <button class="btn ${inShop ? '' : 'primary'}" data-act="toggleShop" data-id="${r.id}">${inShop ? '✓ 장보기에 담김' : '🛒 장보기에 담기'}</button>
      <button class="btn" data-act="cooked" data-id="${r.id}">🍽 만들었어요</button>
    </div>
    <div style="margin-top:28px;text-align:center"><button class="btn ghost danger small" data-act="delete" data-id="${r.id}">이 레시피 삭제</button></div>`;
}

/* ---------- 추가 / 수정 ---------- */
const EDIT_FIELDS = ['title', 'srcName', 'tags', 'ings', 'steps'];
function blankDraft() {
  return { title: '', url: '', srcName: '', srcTitle: '', tags: [], ings: [{ name: '', amt: '', seas: false }], steps: '', memo: '', _touched: {}, _auto: {}, _fetch: null };
}
function viewEdit(r) {
  const key = r ? r.id : 'new';
  if (!ui.draft || ui.draftFor !== key) {
    if (r) {
      ui.draft = Object.assign(blankDraft(), JSON.parse(JSON.stringify(r)));
      // 이미 적혀 있는 칸은 내 입력으로 본다 (링크를 바꿔도 덮어쓰지 않음)
      const d = ui.draft;
      d._touched = { title: !!d.title, srcName: !!d.srcName, tags: d.tags.length > 0, ings: d.ings.some(i => i.name), steps: !!d.steps };
      d._fetchedUrl = d.url;
      if (!d.ings.length) d.ings.push({ name: '', amt: '', seas: false });
    } else ui.draft = blankDraft();
    ui.draftFor = key;
    ui.showPaste = false;
  }
  const d = ui.draft;
  setHeader(r ? '레시피 수정' : '새 레시피', {
    back: true,
    actions: `<button class="btn primary" data-act="saveRecipe">저장</button>`,
  });
  const tagSug = allTags().filter(t => !d.tags.includes(t));
  const auto = f => d._auto[f] && !d._touched[f] ? 'auto' : '';
  return `
    <div class="field">
      <label>출처 링크 <span class="hint">주소만 넣으면 나머지는 자동으로 채워요</span></label>
      <div class="row">
        <input class="input" id="f-url" data-f="url" type="url" inputmode="url" placeholder="https://" value="${esc(d.url)}">
        <button class="btn" data-act="pasteUrl">붙여넣기</button>
      </div>
      ${fetchStatusHTML(d)}
    </div>
    <div class="field">
      <label>요리 이름</label>
      <input class="input ${auto('title')}" id="f-title" data-f="title" placeholder="예: 제육볶음" value="${esc(d.title)}">
      ${d.srcTitle && d.srcTitle !== d.title ? `<div class="small muted" style="margin-top:4px">원문 제목: ${esc(d.srcTitle)}</div>` : ''}
    </div>
    <div class="field">
      <label>출처 이름 <span class="hint">채널·블로그 이름</span></label>
      <input class="input ${auto('srcName')}" id="f-src" data-f="srcName" placeholder="예: 백종원 PAIK JONG WON" value="${esc(d.srcName)}">
    </div>
    <div class="field">
      <label>분류 <span class="hint">쉼표로 여러 개 (예: 국물, 반찬, 아이반찬)</span></label>
      <input class="input ${auto('tags')}" id="f-tags" data-f="tags" placeholder="국물, 반찬" value="${esc(d.tags.join(', '))}">
      ${tagSug.length ? `<div class="chips" style="margin-top:6px">${tagSug.map(t => `<button class="chip" data-act="addTag" data-v="${esc(t)}">＋ ${esc(t)}</button>`).join('')}</div>` : ''}
    </div>

    <div class="field">
      <label>재료 <span class="hint">‘양념’으로 표시한 건 냉장고 추천 계산에서 빠져요</span></label>
      <div class="ing-edit ${auto('ings')}" id="ingEdit">${d.ings.map(ingRow).join('')}</div>
      <div class="row" style="margin-top:8px">
        <button class="btn small" data-act="addIng">＋ 재료 한 줄</button>
        <button class="btn small" data-act="togglePaste">📋 한꺼번에 붙여넣기</button>
      </div>
      ${ui.showPaste ? `<div class="paste-box">
        <div class="small"><b>블로그 본문이나 영상 설명란의 재료 부분을 그대로 붙여넣으세요.</b><br>
        <span class="muted">한 줄에 하나씩, 또는 쉼표로 구분. ‘[양념]’ 같은 제목 아래는 양념으로 분류돼요.</span></div>
        <textarea class="textarea" id="pasteText" placeholder="돼지고기 앞다리살 600g&#10;양파 1개, 대파 1대&#10;[양념]&#10;고추장 2큰술&#10;간장 1큰술"></textarea>
        <button class="btn primary block" style="margin-top:8px" data-act="applyPaste">재료로 나누기</button>
      </div>` : ''}
    </div>

    <div class="field">
      <label>만드는 법 <span class="hint">한 줄에 한 단계 · ‘# ’으로 시작하면 소제목</span></label>
      <textarea class="textarea ${auto('steps')}" id="f-steps" data-f="steps" style="min-height:160px" placeholder="고기에 양념을 넣고 30분 재운다&#10;팬에 기름을 두르고 센 불에 볶는다">${esc(d.steps)}</textarea>
    </div>
    <div class="field">
      <label>메모 <span class="hint">내 입맛에 맞게 바꾼 점, 영상 시간 등</span></label>
      <textarea class="textarea" id="f-memo" data-f="memo" placeholder="설탕은 반만 넣어도 충분">${esc(d.memo)}</textarea>
    </div>
    <button class="btn primary block" style="margin-top:20px" data-act="saveRecipe">저장</button>`;
}
function fetchStatusHTML(d) {
  const f = d._fetch;
  if (!f) return '';
  const again = `<button class="btn small" data-act="refetch">다시 가져오기</button>`;
  if (f.state === 'loading') return `<div class="fetch-status"><span class="spin"></span><span>페이지를 읽고 있어요…</span></div>`;
  if (f.state === 'fail') return `<div class="fetch-status warn"><span>${esc(f.msg)}</span>${again}</div>`;
  const done = f.filled.length ? `<b>${esc(f.filled.join(' · '))}</b> 자동으로 채웠어요.` : '새로 채울 칸이 없었어요.';
  let tip, warn = true;
  if (f.noInfo) tip = '이 영상은 게시자가 퍼가기를 막아 두어 제목을 자동으로 가져올 수 없어요. 요리 이름을 직접 적어 주세요. (⚙︎ ‘링크 읽기 연결’을 하면 가져올 수 있어요)';
  else if (f.limited) tip = '유튜브 설명란의 재료까지 가져오려면 ⚙︎ 설정에서 ‘링크 읽기 연결’을 해 주세요. 지금은 설명란을 복사해 ‘📋 한꺼번에 붙여넣기’에 넣어도 돼요.';
  else if (!f.ingCount && !d._touched.ings) tip = '재료는 찾지 못했어요. 본문의 재료 부분을 복사해 ‘📋 한꺼번에 붙여넣기’에 넣어 주세요.';
  else { tip = '틀린 곳은 고쳐 주세요. 직접 고친 칸은 다시 가져와도 그대로 둬요.'; warn = false; }
  return `<div class="fetch-status ${warn ? 'warn' : 'ok'}"><span>${done} ${esc(tip)}</span>${again}</div>`;
}
function ingRow(i, idx) {
  return `<div class="ing-row" data-idx="${idx}">
    <input class="input" data-ing="name" placeholder="재료" value="${esc(i.name)}">
    <input class="input" data-ing="amt" placeholder="양" value="${esc(i.amt)}">
    <button class="seas-toggle ${i.seas ? 'on' : ''}" data-act="toggleSeas" title="양념으로 표시">양념</button>
    <button class="del" data-act="delIng" aria-label="삭제">✕</button>
  </div>`;
}
function renderIngEdit() { $('#ingEdit').innerHTML = ui.draft.ings.map(ingRow).join(''); }

// 링크를 읽어서, 내가 손대지 않은 칸만 채운다
async function onUrlChange(url, force) {
  const d = ui.draft;
  if (!d || !/^https?:\/\/\S+\.\S+/.test(url || '')) return;
  if (!force && d._fetchedUrl === url) return;
  d._fetchedUrl = url;
  d._fetch = { state: 'loading' };
  if (isEditing(d)) rerender();
  const res = await readRecipeFromUrl(url);
  if (ui.draft !== d || d.url !== url) return;
  if (res.error) { d._fetch = { state: 'fail', msg: res.error }; if (isEditing(d)) rerender(); return; }
  const filled = [];
  const label = { title: '요리 이름', srcName: '출처', tags: '분류', ings: '재료', steps: '만드는 법' };
  if (res.srcTitle) d.srcTitle = res.srcTitle;
  EDIT_FIELDS.forEach(f => {
    const v = res[f];
    const empty = !v || (Array.isArray(v) && !v.length);
    if (d._touched[f] || empty) return;
    d[f] = f === 'ings' ? v.map(i => Object.assign({}, i)) : Array.isArray(v) ? [...v] : v;
    d._auto[f] = true;
    filled.push(f === 'ings' ? `재료 ${v.length}개` : label[f]);
  });
  d._fetch = { state: 'done', filled, limited: res.limited, noInfo: res.noInfo, ingCount: (res.ings || []).length };
  if (isEditing(d)) rerender();
}
function isEditing(d) { return ui.draft === d && /^#\/(new|edit)/.test(location.hash); }
function touch(f) {
  const d = ui.draft;
  if (!d) return;
  d._touched[f] = true;
  const el = f === 'ings' ? $('#ingEdit') : $({ title: '#f-title', srcName: '#f-src', tags: '#f-tags', steps: '#f-steps' }[f]);
  if (el) el.classList.remove('auto');
}

function saveRecipe() {
  const d = ui.draft;
  d.title = d.title.trim();
  d.url = fixUrl(d.url);
  if (!d.title && d._fetch && d._fetch.state === 'loading') { toast('아직 페이지를 읽고 있어요. 잠깐만요'); return; }
  if (!d.title) { toast('요리 이름을 적어 주세요'); $('#f-title').focus(); return; }
  d.ings = d.ings.filter(i => i.name.trim()).map(i => ({ name: i.name.trim(), amt: (i.amt || '').trim(), seas: !!i.seas }));
  Object.keys(d).filter(k => k[0] === '_').forEach(k => delete d[k]);
  const now = Date.now();
  const old = d.id && byId(d.id);
  if (old) Object.assign(old, d, { updatedAt: now });
  else db.recipes.push(Object.assign(d, { id: uid(), createdAt: now, updatedAt: now, cooked: 0 }));
  save();
  const id = d.id;
  ui.draft = null;
  toast('저장했어요');
  // 수정 화면을 기록에서 지우고 상세로
  history.replaceState(null, '', '#/r/' + encodeURIComponent(id));
  render();
}

/* ---------- 냉장고 ---------- */
const PLACES = ['냉장', '냉동', '실온'];
const PLACE_ICON = { 냉장: '🧊', 냉동: '❄️', 실온: '🧺' };
// 재료 이름으로 대충 종류를 짐작해 아이콘을 붙인다
const CATS = [
  ['🥩', /(돼지|소고기|쇠고기|닭|오리|삼겹|목살|앞다리|뒷다리|갈비|등심|안심|차돌|사태|양지|항정|다짐육|고기|베이컨|햄|스팸|소시지)/],
  ['🐟', /(오징어|새우|조개|바지락|홍합|굴$|고등어|연어|참치|멸치|낙지|쭈꾸미|주꾸미|전복|꽃게|게살|명태|동태|코다리|생선|갈치|삼치|문어|골뱅이|어묵|맛살|미역|다시마|김$)/],
  ['🥚', /(계란|달걀|메추리알|우유|치즈|버터|요거트|요구르트|생크림|두부)/],
  ['🍄', /(버섯|표고|팽이|새송이|느타리|양송이|목이)/],
  ['🍎', /(사과|배$|귤|오렌지|레몬|바나나|딸기|포도|키위|토마토|블루베리|수박|참외|복숭아|감$)/],
  ['🍚', /(쌀|밥|당면|국수|소면|라면|파스타|스파게티|우동|떡|빵|밀가루|부침가루|튀김가루|만두)/],
  ['🧂', /(간장|된장|고추장|쌈장|소금|설탕|식초|기름|참기름|들기름|고춧가루|후추|액젓|굴소스|케첩|마요|물엿|올리고당|맛술|미림|다시다|소스|깨)/],
  ['🥬', /./],
];
const catOf = name => CATS.find(([, re]) => re.test(norm(name)))[0];
const daysSince = t => Math.floor((Date.now() - (t || Date.now())) / 86400000);
const fridgeName = x => (typeof x === 'string' ? x : x.name);
function recipesUsing(name) {
  const n = norm(name);
  return db.recipes.filter(r => r.ings.some(i => {
    const k = norm(i.name);
    return !i.seas && k && (k === n || (n.length >= 2 && k.includes(n)) || (k.length >= 2 && n.includes(k)));
  })).length;
}

function viewFridge() {
  const tab = ui.fridgeTab || 'mine';
  setHeader('냉장고', {
    actions: db.fridge.length && tab === 'mine' ? `<button class="btn small" data-act="clearFridge">비우기</button>` : '',
  });
  const seg = `<div class="seg">
    <button class="${tab === 'mine' ? 'on' : ''}" data-act="fridgeTab" data-v="mine">🧊 내 냉장고 <b>${db.fridge.length}</b></button>
    <button class="${tab === 'rec' ? 'on' : ''}" data-act="fridgeTab" data-v="rec">🔍 메뉴 찾기</button>
  </div>`;
  return seg + (tab === 'rec' ? viewFridgeRec() : viewFridgeMine());
}

function viewFridgeMine() {
  const place = ui.fridgePlace || '냉장';
  // 레시피에 자주 나오는 주재료를 빠른 추가 후보로
  const freq = new Map();
  db.recipes.forEach(r => r.ings.forEach(i => {
    if (i.seas || !i.name) return;
    const k = i.name.replace(/\(.*?\)/g, '').trim();
    freq.set(k, (freq.get(k) || 0) + 1);
  }));
  const sug = [...freq.entries()].filter(([n]) => !inFridge(n)).sort((a, b) => b[1] - a[1]).slice(0, 20).map(e => e[0]);

  let html = `<div class="card add-card">
      <div class="add-row">
        <input class="input" id="fridgeInput" placeholder="재료 (예: 양파, 두부)" enterkeyhint="done">
        <input class="input qty" id="fridgeQty" placeholder="양 (선택)" enterkeyhint="done">
      </div>
      <div class="row" style="margin-top:8px">
        <div class="seg small">${PLACES.map(p => `<button class="${p === place ? 'on' : ''}" data-act="fridgePlace" data-v="${p}">${PLACE_ICON[p]} ${p}</button>`).join('')}</div>
        <span class="spacer"></span>
        <button class="btn primary" data-act="addFridge">넣기</button>
      </div>
      ${sug.length ? `<div class="small muted" style="margin:12px 0 6px">내 레시피에 자주 나오는 재료 — 누르면 바로 ${esc(place)}에 넣어요</div>
        <div class="chips">${sug.map(n => `<button class="chip" data-act="quickFridge" data-v="${esc(n)}">＋ ${esc(n)}</button>`).join('')}</div>` : ''}
    </div>`;

  if (!db.fridge.length) {
    return html + `<div class="empty"><div class="big">🧊</div><p>냉장고가 비어 있어요.<br>지금 있는 재료를 넣어 두면<br>‘추천 메뉴’에서 만들 수 있는 요리를 찾아 드려요.</p></div>`;
  }
  for (const p of PLACES) {
    // 오래된 것부터 (먼저 써야 할 재료가 위로)
    const items = db.fridge.filter(x => (x.place || '냉장') === p).sort((a, b) => (a.at || 0) - (b.at || 0));
    if (!items.length) continue;
    html += `<div class="section-title">${PLACE_ICON[p]} ${p} <span class="count">${items.length}</span></div>
      <div class="card fridge-list">${items.map(fridgeRow).join('')}</div>`;
  }
  html += `<p class="muted small" style="margin-top:14px">재료를 누르면 양·보관 장소·넣은 날을 고치거나 뺄 수 있어요. 냉장 재료는 일주일이 지나면 날짜가 노랗게 보여요.</p>`;
  return html;
}
function fridgeRow(x) {
  const d = daysSince(x.at);
  const old = (x.place || '냉장') === '냉장' && d >= 7;
  const uses = recipesUsing(x.name);
  return `<div class="fridge-item" data-act="editFridge" data-id="${x.id}">
    <span class="cat">${catOf(x.name)}</span>
    <div class="nm-wrap"><div class="nm">${esc(x.name)}${x.qty ? ` <span class="qty-txt">${esc(x.qty)}</span>` : ''}</div>
      ${uses ? `<div class="uses">레시피 ${uses}개에 쓰여요</div>` : ''}</div>
    <span class="days ${old ? 'old' : ''}">${d === 0 ? '오늘' : d + '일째'}</span>
    <button class="del" data-act="delFridge" data-id="${x.id}" aria-label="빼기">✕</button>
  </div>`;
}
function openFridgeEdit(id) {
  const x = db.fridge.find(f => f.id === id);
  if (!x) return;
  const date = new Date(x.at || Date.now());
  const ymd = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  openSheet(`<h2>${catOf(x.name)} ${esc(x.name)}</h2>
    <div class="field" style="margin-top:0"><label>이름</label><input class="input" id="feName" value="${esc(x.name)}"></div>
    <div class="field"><label>양 <span class="hint">예: 2개, 반 통, 300g</span></label><input class="input" id="feQty" value="${esc(x.qty || '')}"></div>
    <div class="field"><label>보관 장소</label>
      <div class="seg small" id="fePlace">${PLACES.map(p => `<button class="${p === (x.place || '냉장') ? 'on' : ''}" data-act="fePlace" data-v="${p}">${PLACE_ICON[p]} ${p}</button>`).join('')}</div></div>
    <div class="field"><label>넣은 날</label><input class="input" type="date" id="feDate" value="${ymd}"></div>
    <div class="row" style="margin-top:18px">
      <button class="btn danger" data-act="delFridge" data-id="${x.id}" data-close>빼기</button>
      <span class="spacer"></span>
      <button class="btn" data-close>취소</button>
      <button class="btn primary" data-act="saveFridge" data-id="${x.id}">저장</button>
    </div>`);
}

// 두 재료 이름이 같은 재료를 가리키는지 (‘돼지고기’ ↔ ‘돼지고기 앞다리살’)
function sameIng(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return false;
  return a === b || (b.length >= 2 && a.includes(b)) || (a.length >= 2 && b.includes(a));
}
// 메뉴 찾기: 내가 고르거나 적은 재료로 레시피를 찾는다
function viewFridgeRec() {
  const terms = ui.recTerms || (ui.recTerms = []);
  const isOn = name => terms.some(t => norm(t) === norm(name));
  let html = `<div class="card pick-box">
      <div class="pick-head">🧊 내 냉장고 재료 <span class="muted small">누르면 검색에 추가돼요</span>
        ${db.fridge.length ? `<span class="spacer"></span><button class="btn ghost small" data-act="recAll">${db.fridge.every(f => isOn(f.name)) ? '모두 빼기' : '모두 넣기'}</button>` : ''}</div>
      ${db.fridge.length ? `<div class="chips">${db.fridge.map(f =>
        `<button class="chip ${isOn(f.name) ? 'on' : ''}" data-act="recPick" data-v="${esc(f.name)}">${catOf(f.name)} ${esc(f.name)}</button>`).join('')}</div>`
        : `<div class="muted small">‘내 냉장고’에 재료를 넣어 두면 여기서 눌러서 바로 찾을 수 있어요.</div>`}
    </div>
    <div class="search-box">
      <div class="chips">${terms.map(t => `<span class="chip on">${esc(t)}<button class="x" data-act="recDel" data-v="${esc(t)}" aria-label="빼기">✕</button></span>`).join('')}
        <input id="recInput" class="bare-input" placeholder="${terms.length ? '재료 더 적기' : '재료를 적어 찾기 (예: 두부, 애호박)'}" enterkeyhint="search">
      </div>
      ${terms.length ? `<button class="btn ghost small" data-act="recClear">지우기</button>` : ''}
    </div>`;

  if (!terms.length) {
    return html + `<div class="empty"><div class="big">🔍</div><p>위에서 냉장고 재료를 누르거나<br>재료 이름을 적으면 그 재료로 만들 수 있는 요리를 찾아 드려요.</p></div>`;
  }
  const results = db.recipes.map(r => {
    const main = r.ings.filter(i => !i.seas && i.name);
    const hit = main.filter(i => terms.some(t => sameIng(i.name, t)));
    const rest = main.filter(i => !hit.includes(i));
    const have = rest.filter(i => inFridge(i.name));
    const miss = rest.filter(i => !inFridge(i.name));
    return { r, main, hit, have, miss };
  }).filter(x => x.hit.length)
    .sort((a, b) => b.hit.length - a.hit.length || a.miss.length - b.miss.length);

  const card = x => `<div class="card rec-card">
    ${thumbHTML(x.r)}
    <div class="body">
      <div class="row"><button class="name btn ghost" style="padding:0;text-align:left;white-space:normal" data-act="open" data-id="${x.r.id}">${esc(x.r.title)}</button>
        <span class="spacer"></span><span class="pct">${x.miss.length ? `${x.miss.length}개 부족` : '다 있어요'}</span></div>
      <div class="chips">${x.hit.map(i => `<span class="chip on">${esc(i.name)}</span>`).join('')}${x.have.map(i => `<span class="chip have">${esc(i.name)}</span>`).join('')}${x.miss.map(i => `<span class="chip miss">${esc(i.name)}</span>`).join('')}</div>
      ${x.miss.length && !db.shop.ids.includes(x.r.id) ? `<button class="btn small" style="margin-top:8px" data-act="toggleShop" data-id="${x.r.id}">🛒 장보기에 담기</button>` : ''}
    </div></div>`;

  html += `<div class="section-title">찾은 요리 <span class="count">${results.length}</span></div>`;
  if (!results.length) return html + `<div class="empty">이 재료가 들어간 레시피가 아직 없어요.</div>`;
  html += `<div class="legend small muted"><span class="chip on">찾는 재료</span><span class="chip have">냉장고에 있음</span><span class="chip miss">사야 해요</span></div>
    <div class="list" style="margin-top:8px">${results.map(card).join('')}</div>
    <p class="muted small" style="margin-top:18px">찾는 재료가 많이 들어간 요리부터 보여 줘요. 양념(간장·소금·설탕 등)은 집에 있다고 보고 계산해요.</p>`;
  return html;
}
function addRecTerms(text) {
  const terms = ui.recTerms || (ui.recTerms = []);
  String(text).split(/[,，]+/).map(s => s.trim()).filter(Boolean)
    .forEach(t => { if (!terms.some(x => norm(x) === norm(t))) terms.push(t); });
}
function addFridge(text, qty = '', place = '냉장') {
  const names = String(text).split(/[,，\n]+/).map(s => s.trim()).filter(Boolean);
  let n = 0;
  names.forEach(name => {
    if (db.fridge.some(f => norm(f.name) === norm(name))) return;
    db.fridge.push({ id: uid(), name, qty: names.length === 1 ? qty : '', place, at: Date.now() });
    n++;
  });
  if (n) save();
  return n;
}

/* ---------- 장보기 ---------- */
function shopItems() {
  const map = new Map();
  db.shop.ids.forEach(id => {
    const r = byId(id);
    if (!r) return;
    r.ings.forEach(i => {
      if (!i.name) return;
      const k = norm(i.name);
      if (!map.has(k)) map.set(k, { key: k, name: i.name.replace(/\(.*?\)/g, '').trim(), seas: i.seas, parts: [] });
      const it = map.get(k);
      it.seas = it.seas && i.seas;
      it.parts.push({ title: r.title, amt: i.amt });
    });
  });
  db.shop.extra.forEach(name => {
    const k = norm(name);
    if (!map.has(k)) map.set(k, { key: k, name, seas: false, parts: [], extra: true });
  });
  const all = [...map.values()];
  return {
    buy: all.filter(x => !x.seas && !inFridge(x.name)),
    seas: all.filter(x => x.seas && !inFridge(x.name)),
    have: all.filter(x => inFridge(x.name)),
  };
}
function viewShop() {
  const recipes = db.shop.ids.map(byId).filter(Boolean);
  setHeader('장보기', {
    actions: recipes.length || db.shop.extra.length ? `<button class="btn small" data-act="copyShop">복사</button>
      <button class="btn small" data-act="clearShop">비우기</button>` : '',
  });
  const { buy, seas, have } = shopItems();
  const item = x => {
    const done = !!db.shop.checked[x.key];
    const forTxt = x.parts.map(p => p.amt ? `${p.title} ${p.amt}` : p.title).join(' · ');
    return `<label class="shop-item ${done ? 'done' : ''}">
      <input type="checkbox" data-act="checkShop" data-k="${esc(x.key)}" ${done ? 'checked' : ''}>
      <div style="flex:1;min-width:0"><div class="nm">${esc(x.name)}</div>${forTxt ? `<div class="for">${esc(forTxt)}</div>` : ''}</div>
      ${x.extra ? `<button class="del" data-act="delExtra" data-v="${esc(x.name)}" aria-label="삭제">✕</button>` : ''}
    </label>`;
  };
  const checkedCount = [...buy, ...seas].filter(x => db.shop.checked[x.key]).length;
  return `
    <div class="section-title">담은 요리 <span class="count">${recipes.length}</span></div>
    ${recipes.length ? `<div class="chips">${recipes.map(r => `<span class="chip on">${esc(r.title)}<button class="x" data-act="toggleShop" data-id="${r.id}" aria-label="빼기">✕</button></span>`).join('')}</div>`
      : `<p class="muted small">레시피 화면이나 냉장고 추천에서 ‘🛒 장보기에 담기’를 누르면 필요한 재료가 여기 모여요.</p>`}
    <div class="add-row" style="margin-top:14px">
      <input class="input" id="extraInput" placeholder="따로 살 것 추가 (예: 우유)" enterkeyhint="done">
      <button class="btn" data-act="addExtra">추가</button>
    </div>
    ${buy.length ? `<div class="section-title">사야 할 재료 <span class="count">${buy.length}</span></div><div class="card">${buy.map(item).join('')}</div>` : ''}
    ${seas.length ? `<div class="section-title">양념 <span class="count">집에 있는지 확인</span></div><div class="card">${seas.map(item).join('')}</div>` : ''}
    ${have.length ? `<details class="card" style="margin-top:18px"><summary>냉장고에 이미 있는 재료 ${have.length}개</summary>${have.map(item).join('')}</details>` : ''}
    ${checkedCount ? `<button class="btn primary block" style="margin-top:20px" data-act="boughtToFridge">산 것 ${checkedCount}개 냉장고에 넣기</button>` : ''}`;
}
function shopText() {
  const { buy, seas } = shopItems();
  const recipes = db.shop.ids.map(byId).filter(Boolean).map(r => r.title);
  const line = x => `- ${x.name}${x.parts.some(p => p.amt) ? ' (' + x.parts.filter(p => p.amt).map(p => p.amt).join(' + ') + ')' : ''}`;
  let t = `🛒 장보기${recipes.length ? ' — ' + recipes.join(', ') : ''}\n`;
  const b = buy.filter(x => !db.shop.checked[x.key]);
  const s = seas.filter(x => !db.shop.checked[x.key]);
  if (b.length) t += '\n' + b.map(line).join('\n');
  if (s.length) t += '\n\n[양념 확인]\n' + s.map(line).join('\n');
  return t;
}

/* ---------- 설정 (백업) ---------- */
function openSheet(html) {
  const back = document.createElement('div');
  back.className = 'sheet-back';
  back.innerHTML = `<div class="sheet">${html}</div>`;
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) back.remove(); });
  document.body.appendChild(back);
  return back;
}
function openSettings() {
  const c = relayConf();
  openSheet(`<h2>링크 읽기 연결</h2>
    <p class="muted small" style="margin-top:0">유튜브 영상 설명란의 재료까지 자동으로 가져오려면 내 구글 앱스 스크립트 연결이 필요해요.
      연결이 없어도 블로그·레시피 사이트는 읽을 수 있어요. (이 설정은 이 기기에만 저장돼요)</p>
    <input class="input" id="relayUrl" placeholder="https://script.google.com/macros/s/…/exec" value="${esc(c.url || '')}">
    <input class="input" id="relayKey" placeholder="연결 비밀번호 (SECRET)" value="${esc(c.key || '')}" style="margin-top:6px">
    <div class="row" style="margin-top:8px">
      <button class="btn primary" data-act="saveRelay">저장</button>
      <span class="small muted" id="relayMsg">${c.url ? '연결되어 있어요' : ''}</span>
    </div>
    <h2 style="margin-top:24px">백업</h2>
    <p class="muted small" style="margin-top:0">레시피는 이 기기(브라우저) 안에만 저장돼요. 기기를 바꾸거나 다른 기기로 옮길 때 파일로 내보냈다가 가져오세요.</p>
    <button class="btn block" data-act="export" data-close>📤 파일로 내보내기</button>
    <button class="btn block" data-act="import" data-close>📥 파일에서 가져오기</button>
    <p class="muted small">레시피 ${db.recipes.length}개 · 냉장고 재료 ${db.fridge.length}개</p>
    <button class="btn block ghost" data-close>닫기</button>`);
}
function exportData() {
  const blob = new Blob([JSON.stringify(db, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date();
  a.href = URL.createObjectURL(blob);
  a.download = `레시피노트-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('#importFile').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.recipes)) throw new Error();
    let added = 0, updated = 0;
    data.recipes.forEach(r => {
      const old = byId(r.id);
      if (!old) { db.recipes.push(r); added++; }
      else if ((r.updatedAt || 0) > (old.updatedAt || 0)) { Object.assign(old, r); updated++; }
    });
    (data.fridge || []).forEach(f => {
      const item = typeof f === 'string' ? { id: uid(), name: f, qty: '', place: '냉장', at: Date.now() } : f;
      if (!db.fridge.some(x => norm(x.name) === norm(item.name))) db.fridge.push(item);
    });
    save(); render();
    toast(`새 레시피 ${added}개, 갱신 ${updated}개를 가져왔어요`);
  } catch (err) { toast('레시피 노트 백업 파일이 아니에요'); }
});

/* ---------- 이벤트 ---------- */
$('#backBtn').addEventListener('click', back);
document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
  navDepth = 0;
  location.hash = '#/' + b.dataset.tab;
}));

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act, id = el.dataset.id, v = el.dataset.v;
  const d = ui.draft;
  switch (act) {
    case 'new': go('#/new'); break;
    case 'open': go('#/r/' + encodeURIComponent(id)); break;
    case 'edit': go('#/edit/' + encodeURIComponent(id)); break;
    case 'settings': openSettings(); break;
    case 'tag': ui.tag = v; rerender(); break;
    case 'delete': {
      const r = byId(id);
      if (!confirm(`‘${r.title}’ 레시피를 삭제할까요?`)) return;
      db.recipes = db.recipes.filter(x => x.id !== id);
      db.shop.ids = db.shop.ids.filter(x => x !== id);
      save(); navDepth = 0; location.hash = '#/recipes';
      toast('삭제했어요'); break;
    }
    case 'toggleShop': {
      const i = db.shop.ids.indexOf(id);
      if (i >= 0) db.shop.ids.splice(i, 1); else db.shop.ids.push(id);
      save(); rerender();
      toast(i >= 0 ? '장보기에서 뺐어요' : '장보기에 담았어요'); break;
    }
    case 'cooked': {
      const r = byId(id);
      r.cooked = (r.cooked || 0) + 1; r.lastCooked = Date.now();
      save(); rerender(); toast(`맛있게 드세요! (${r.cooked}번째)`); break;
    }
    // 편집
    case 'addIng': touch('ings'); d.ings.push({ name: '', amt: '', seas: false }); renderIngEdit();
      $('#ingEdit').lastElementChild.querySelector('input').focus(); break;
    case 'delIng': touch('ings'); d.ings.splice(+el.closest('.ing-row').dataset.idx, 1);
      if (!d.ings.length) d.ings.push({ name: '', amt: '', seas: false });
      renderIngEdit(); break;
    case 'toggleSeas': { touch('ings'); const i = d.ings[+el.closest('.ing-row').dataset.idx]; i.seas = !i.seas; i.seasTouched = true; el.classList.toggle('on', i.seas); break; }
    case 'togglePaste': ui.showPaste = !ui.showPaste; rerender(); if (ui.showPaste) $('#pasteText').focus(); break;
    case 'applyPaste': {
      const list = parseIngredients($('#pasteText').value);
      if (!list.length) { toast('재료를 찾지 못했어요'); return; }
      d.ings = (d._touched.ings ? d.ings.filter(i => i.name.trim()) : []).concat(list);
      d._touched.ings = true;
      ui.showPaste = false; rerender();
      toast(`재료 ${list.length}개를 넣었어요. 확인해 보세요`); break;
    }
    case 'pasteUrl': {
      try {
        const t = fixUrl(await navigator.clipboard.readText());
        if (!t) { toast('클립보드가 비어 있어요'); return; }
        d.url = t; $('#f-url').value = t; onUrlChange(t);
      } catch (err) { toast('주소 칸을 길게 눌러 붙여넣어 주세요'); $('#f-url').focus(); }
      break;
    }
    case 'addTag': d.tags.push(v); d._touched.tags = true; rerender(); break;
    case 'refetch': onUrlChange(d.url, true); break;
    case 'saveRelay': {
      const url = $('#relayUrl').value.trim(), key = $('#relayKey').value.trim();
      const msg = $('#relayMsg');
      if (!url) { setRelayConf({}); msg.textContent = '연결을 지웠어요'; return; }
      msg.textContent = '확인하는 중…';
      try {
        const j = await (await fetch(`${url}?key=${encodeURIComponent(key)}`)).json();
        if (!j.ok) { msg.textContent = j.error === 'key' ? '비밀번호가 맞지 않아요' : '연결에 실패했어요'; return; }
        setRelayConf({ url, key });
        msg.textContent = '✓ 연결됐어요';
      } catch (err) { msg.textContent = '주소를 확인해 주세요 (웹앱 주소, 액세스: 모든 사용자)'; }
      break;
    }
    case 'saveRecipe': saveRecipe(); break;
    // 냉장고
    case 'addFridge': {
      const inp = $('#fridgeInput');
      if (!inp.value.trim()) { inp.focus(); return; }
      const n = addFridge(inp.value, $('#fridgeQty').value.trim(), ui.fridgePlace || '냉장');
      if (n) { rerender(); $('#fridgeInput').focus(); toast(`${ui.fridgePlace || '냉장'}에 ${n}개 넣었어요`); }
      else toast('이미 냉장고에 있어요');
      break;
    }
    case 'quickFridge': addFridge(v, '', ui.fridgePlace || '냉장'); rerender(); break;
    case 'fridgeTab': ui.fridgeTab = v; render(); break;
    case 'recPick': { const t = ui.recTerms || (ui.recTerms = []); const i = t.findIndex(x => norm(x) === norm(v)); if (i >= 0) t.splice(i, 1); else t.push(v); rerender(); break; }
    case 'recAll': { const all = db.fridge.every(f => (ui.recTerms || []).some(t => norm(t) === norm(f.name))); ui.recTerms = all ? [] : db.fridge.map(f => f.name); rerender(); break; }
    case 'recDel': ui.recTerms = (ui.recTerms || []).filter(t => t !== v); rerender(); break;
    case 'recClear': ui.recTerms = []; rerender(); break;
    case 'fridgePlace': ui.fridgePlace = v; rerender(); break;
    case 'editFridge': openFridgeEdit(el.dataset.id); break;
    case 'fePlace': el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el)); break;
    case 'saveFridge': {
      const x = db.fridge.find(f => f.id === id);
      const name = $('#feName').value.trim();
      if (x && name) {
        x.name = name; x.qty = $('#feQty').value.trim();
        x.place = ($('#fePlace .on') || {}).dataset?.v || x.place;
        const dv = $('#feDate').value; if (dv) x.at = new Date(dv + 'T12:00').getTime();
        save();
      }
      document.querySelector('.sheet-back')?.remove(); rerender(); break;
    }
    case 'delFridge': { e.stopPropagation(); const x = db.fridge.find(f => f.id === id); db.fridge = db.fridge.filter(f => f.id !== id); save(); rerender(); if (x) toast(`${x.name}을(를) 뺐어요`); break; }
    case 'clearFridge': if (confirm('냉장고 재료를 모두 비울까요?')) { db.fridge = []; save(); rerender(); } break;
    // 장보기
    case 'checkShop': {
      const k = el.dataset.k;
      if (el.checked) db.shop.checked[k] = true; else delete db.shop.checked[k];
      save(); rerender(); break;
    }
    case 'addExtra': {
      const inp = $('#extraInput');
      inp.value.split(/[,，]/).map(s => s.trim()).filter(Boolean).forEach(n => { if (!db.shop.extra.includes(n)) db.shop.extra.push(n); });
      inp.value = ''; save(); rerender(); break;
    }
    case 'delExtra': e.preventDefault(); db.shop.extra = db.shop.extra.filter(x => x !== v); delete db.shop.checked[norm(v)]; save(); rerender(); break;
    case 'copyShop': {
      const t = shopText();
      try { await navigator.clipboard.writeText(t); toast('복사했어요. 메모나 카톡에 붙여넣으세요'); }
      catch (err) { openSheet(`<h2>장보기 목록</h2><textarea class="textarea" style="min-height:240px">${esc(t)}</textarea><button class="btn block" data-close>닫기</button>`); }
      break;
    }
    case 'clearShop': if (confirm('장보기 목록을 비울까요?')) { db.shop = { ids: [], checked: {}, extra: [] }; save(); rerender(); } break;
    case 'boughtToFridge': {
      const { buy, seas } = shopItems();
      const got = [...buy, ...seas].filter(x => db.shop.checked[x.key]);
      addFridge(got.map(x => x.name).join(','));
      got.forEach(x => { delete db.shop.checked[x.key]; if (x.extra) db.shop.extra = db.shop.extra.filter(n => norm(n) !== x.key); });
      save(); rerender(); toast(`${got.length}개를 냉장고에 넣었어요`); break;
    }
    // 백업
    case 'export': exportData(); break;
    case 'import': $('#importFile').click(); break;
  }
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'recInput' && /[,，]/.test(t.value)) { addRecTerms(t.value); rerender(); return; }
  if (t.id === 'q') {
    ui.q = t.value;
    const list = $('.list');
    if (list) { const pos = t.selectionStart; rerender(); const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos); }
    return;
  }
  const d = ui.draft;
  if (!d) return;
  if (t.dataset.f) {
    if (t.dataset.f !== 'url' && t.dataset.f !== 'memo') touch(t.dataset.f);
    if (t.dataset.f === 'tags') d.tags = t.value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    else d[t.dataset.f] = t.value;
  } else if (t.dataset.ing) {
    const i = d.ings[+t.closest('.ing-row').dataset.idx];
    i[t.dataset.ing] = t.value;
    touch('ings');
    if (t.dataset.ing === 'name' && !i.seasTouched) {
      i.seas = isSeasoning(t.value);
      t.closest('.ing-row').querySelector('.seas-toggle').classList.toggle('on', i.seas);
    }
  }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'sort') { ui.sort = t.value; rerender(); }
  if (t.id === 'f-url') { ui.draft.url = fixUrl(t.value); t.value = ui.draft.url; onUrlChange(ui.draft.url); }
});
document.addEventListener('paste', e => {
  if (e.target.id === 'f-url') setTimeout(() => { const t = e.target; ui.draft.url = fixUrl(t.value); t.value = ui.draft.url; onUrlChange(ui.draft.url); });
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.isComposing) return;
  if (e.target.id === 'recInput') { e.preventDefault(); if (e.target.value.trim()) { addRecTerms(e.target.value); rerender(); } return; }
  if (e.target.id === 'fridgeInput' || e.target.id === 'fridgeQty') { e.preventDefault(); $('[data-act="addFridge"]').click(); }
  if (e.target.id === 'extraInput') { e.preventDefault(); $('[data-act="addExtra"]').click(); }
  if (e.target.dataset.ing === 'amt') { e.preventDefault(); $('[data-act="addIng"]').click(); }
});

/* ---------- 공유로 들어온 링크 (안드로이드: 유튜브 앱 → 공유 → 레시피 노트) ---------- */
(function handleShare() {
  const p = new URLSearchParams(location.search);
  const shared = p.get('url') || p.get('text') || '';
  if (!shared) return;
  const url = fixUrl(shared);
  history.replaceState(null, '', location.pathname + '#/new');
  ui.draft = Object.assign(blankDraft(), { url });
  ui.draftFor = 'new';
  const title = p.get('title');
  if (title && !/^https?:/.test(title)) ui.draft.srcTitle = title;
  setTimeout(() => onUrlChange(url));
})();

render();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
