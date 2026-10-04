/**
 * 레시피 노트 — 구글 연결 (Google Apps Script 웹앱)
 *
 * 1) 링크 읽기: 브라우저는 다른 사이트 페이지를 직접 못 읽어서(CORS) 이 스크립트가 대신 읽어 준다.
 *    레시피를 골라내는 일은 앱(import.js)이 하고, 여기서는 페이지에서 제목·작성자·본문만 뽑아 돌려준다.
 * 2) 동기화: 레시피·냉장고·장보기를 내 구글 드라이브의 recipe-note-data.json 파일 하나에 저장하고,
 *    기기마다 보내온 내용과 합쳐서(항목별로 더 최근에 고친 쪽) 돌려준다.
 *
 * 배포: script.google.com → 새 프로젝트 → 이 코드 붙여넣기(고칠 곳 없음)
 *       → 배포 → 새 배포 → 유형: 웹 앱, 실행: 나, 액세스 권한: 모든 사용자
 *       → 나온 웹앱 주소를 앱의 ⚙︎ 구글 연결에 넣는다.
 * 비밀번호: 처음 연결한 기기의 앱이 무작위 비밀번호를 만들어 이 스크립트(프로젝트 설정 → 스크립트 속성 SECRET)에 저장한다.
 *          다른 기기는 그 기기의 ⚙︎에 나오는 QR·연결 링크로 연결한다. 처음부터 다시 하려면 스크립트 속성 SECRET 을 지운다.
 * 코드를 고친 뒤에는 배포 → 배포 관리 → 수정(연필) → 버전: 새 버전 으로 다시 배포해야 반영된다.
 */
const secret = () => PropertiesService.getScriptProperties().getProperty('SECRET') || '';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const DATA_FILE = 'recipe-note-data.json';

function doGet(e) {
  const p = (e && e.parameter) || {};
  // 처음 연결: 앱이 만든 비밀번호를 한 번만 저장한다 (이미 있으면 거절)
  if (p.setup) {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      if (secret()) return out({ ok: false, error: 'already' });
      if (!/^[a-z0-9]{16,64}$/.test(p.setup)) return out({ ok: false, error: 'setup' });
      PropertiesService.getScriptProperties().setProperty('SECRET', p.setup);
      return out({ ok: true, pong: true, sync: true });
    } finally { lock.releaseLock(); }
  }
  if (!secret()) return out({ ok: false, error: 'nosetup' });
  if (p.key !== secret()) return out({ ok: false, error: 'key' });
  if (!p.url) return out({ ok: true, pong: true, sync: true });
  try {
    return out(Object.assign({ ok: true }, grab(p.url)));
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err) });
  }
}

// 동기화는 내용이 커서 POST 로 받는다 (앱은 text/plain 으로 보내 CORS 사전 요청을 피한다)
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'json' }); }
  if (!secret() || body.key !== secret()) return out({ ok: false, error: 'key' });
  if (body.action !== 'sync') return out({ ok: false, error: 'action' });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000); // 폰과 PC가 동시에 보내도 하나씩 처리
  try {
    const files = DriveApp.getFilesByName(DATA_FILE);
    const file = files.hasNext() ? files.next() : null;
    const saved = file ? JSON.parse(file.getBlob().getDataAsString('UTF-8') || '{}') : {};
    const merged = mergeData(saved, body.data || {});
    const text = JSON.stringify(merged);
    if (file) file.setContent(text); else DriveApp.createFile(DATA_FILE, text, MimeType.PLAIN_TEXT);
    return out({ ok: true, data: merged });
  } catch (err) {
    return out({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// 두 기기의 데이터를 합친다: 레시피·냉장고 재료는 id 별로 updatedAt 이 더 최근인 쪽,
// 지운 항목은 deleted 에 {id: 지운 시각} 으로 남겨 다른 기기에서도 지워지게 한다. 장보기는 통째로 최근 쪽.
function mergeData(a, b) {
  const deleted = Object.assign({}, a.deleted || {});
  Object.keys(b.deleted || {}).forEach(id => { if (!(deleted[id] >= b.deleted[id])) deleted[id] = b.deleted[id]; });
  const now = Date.now();
  Object.keys(deleted).forEach(id => { if (now - deleted[id] > 180 * 86400000) delete deleted[id]; }); // 반년 지난 기록은 정리
  const mergeList = (x, y) => {
    const byId = {};
    (x || []).concat(y || []).forEach(it => {
      if (!it || !it.id) return;
      const old = byId[it.id];
      if (!old || (it.updatedAt || 0) > (old.updatedAt || 0)) byId[it.id] = it;
    });
    return Object.keys(byId).map(id => byId[id]).filter(it => !(deleted[it.id] >= (it.updatedAt || 0)));
  };
  const sa = a.shop, sb = b.shop;
  const shop = !sa ? sb : !sb ? sa : ((sb.updatedAt || 0) >= (sa.updatedAt || 0) ? sb : sa);
  return {
    v: 1,
    recipes: mergeList(a.recipes, b.recipes),
    fridge: mergeList(a.fridge, b.fridge),
    shop: shop || { ids: [], checked: {}, extra: [] },
    deleted: deleted,
  };
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// 리다이렉트를 직접 따라가서 최종 주소를 알아낸다 (naver.me 같은 짧은 주소 때문)
function get(url) {
  for (let i = 0; i < 6; i++) {
    const res = UrlFetchApp.fetch(url, {
      muteHttpExceptions: true,
      followRedirects: false,
      headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
    });
    const code = res.getResponseCode();
    if (code >= 300 && code < 400) {
      const h = res.getHeaders();
      const loc = h.Location || h.location;
      if (!loc) break;
      url = loc.indexOf('http') === 0 ? loc : url.replace(/^(https?:\/\/[^/]+).*$/, '$1') + (loc[0] === '/' ? '' : '/') + loc;
      continue;
    }
    return { url: url, html: res.getContentText(), code: code };
  }
  throw new Error('too many redirects');
}

function ytId(url) {
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/);
  return m ? m[1] : null;
}

function naverMobile(url) {
  if (/blog\.naver\.com\/PostView/.test(url)) {
    const b = url.match(/[?&]blogId=([\w-]+)/), n = url.match(/[?&]logNo=(\d+)/);
    if (b && n) return 'https://m.blog.naver.com/' + b[1] + '/' + n[1];
  }
  const m = url.match(/^https?:\/\/(?:m\.)?blog\.naver\.com\/([\w-]+)\/(\d+)/);
  if (m) return 'https://m.blog.naver.com/' + m[1] + '/' + m[2];
  return url;
}

function grab(url) {
  let id = ytId(url);
  if (!id && /naver\.me|youtu/.test(url)) { // 짧은 주소는 먼저 풀어 본다
    const r = get(url);
    url = r.url;
    id = ytId(url);
  }
  if (id) return youtube(id);

  let page = get(naverMobile(url));
  if (/blog\.naver\.com/.test(page.url) && !/m\.blog\.naver\.com/.test(page.url)) page = get(naverMobile(page.url));
  // 옛날 데스크톱 블로그는 본문이 iframe 안에 있다
  const frame = page.html.match(/<iframe[^>]+id="mainFrame"[^>]+src="([^"]+)"/i);
  if (frame) page = get(naverMobile(frame[1].indexOf('http') === 0 ? frame[1] : 'https://blog.naver.com' + frame[1]));

  const html = page.html;
  const meta = (name) => {
    const re = new RegExp('<meta[^>]+(?:property|name)=["\']' + name + '["\'][^>]*>', 'i');
    const tag = html.match(re);
    if (!tag) return '';
    const c = tag[0].match(/content=["']([^"']*)["']/i);
    return c ? decode(c[1]) : '';
  };
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const jsonld = [];
  html.replace(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi, (m, s) => { jsonld.push(s.trim()); return m; });

  // 네이버 블로그는 본문 영역만 잘라서 잡음을 줄인다
  let body = html;
  const se = html.search(/class="se-main-container"|id="postViewArea"|class="post_ct"/);
  if (se > 0) body = html.slice(se);

  return {
    kind: /blog\.naver\.com/.test(page.url) ? 'naver' : 'web',
    finalUrl: page.url,
    title: meta('og:title') || (titleTag ? decode(titleTag[1]).trim() : ''),
    siteName: meta('og:site_name'),
    author: meta('naverblog:nickname') || meta('og:article:author') || meta('article:author') || meta('author'),
    description: meta('og:description') || meta('description'),
    jsonld: jsonld,
    text: toText(body).slice(0, 40000),
  };
}

function youtube(id) {
  const page = get('https://www.youtube.com/watch?v=' + id + '&hl=ko');
  const m = page.html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\});\s*(?:var\s|<\/script>)/);
  if (!m) throw new Error('youtube parse');
  const v = JSON.parse(m[1]).videoDetails || {};
  return { kind: 'youtube', finalUrl: 'https://www.youtube.com/watch?v=' + id, title: v.title || '', author: v.author || '', text: v.shortDescription || '', jsonld: [] };
}

function toText(html) {
  return decode(html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article|blockquote|dt|dd)>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[​ ]/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function decode(s) {
  return String(s)
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
