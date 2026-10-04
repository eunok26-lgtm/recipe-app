'use strict';
/* 기기 간 동기화 — ⚙︎ 구글 연결(앱스 스크립트)로 내 구글 드라이브의 파일 하나에 맞춘다.
   저장할 때마다 바뀐 레시피·냉장고 재료에 updatedAt 을 찍고, 지운 것은 db.deleted 에 남긴다.
   합치는 일은 스크립트(mergeData)가 하고, 앱은 합쳐진 결과를 받아 그대로 쓴다. */

const SYNC_KEY = 'recipe-note-sync';
let snap = null, syncTimer = null, syncing = false, syncAgain = false, localVer = 0, syncErrShown = false;

const withoutTime = o => { const c = Object.assign({}, o); delete c.updatedAt; return JSON.stringify(c); };
function takeSnap() {
  snap = {
    r: new Map(db.recipes.map(x => [x.id, withoutTime(x)])),
    f: new Map(db.fridge.map(x => [x.id, withoutTime(x)])),
    shop: withoutTime(db.shop),
  };
}
// 지난번 저장과 비교해 바뀐 항목에 시각을 찍는다 (어느 화면에서 고쳤든 빠짐없이)
function stampChanges() {
  if (!snap) { takeSnap(); return false; }
  const now = Date.now();
  let changed = false;
  db.deleted = db.deleted || {};
  const scan = (list, prev) => {
    const ids = new Set();
    list.forEach(x => {
      ids.add(x.id);
      if (prev.get(x.id) !== withoutTime(x)) { x.updatedAt = now; changed = true; }
    });
    prev.forEach((_, id) => { if (!ids.has(id)) { db.deleted[id] = now; changed = true; } });
  };
  scan(db.recipes, snap.r);
  scan(db.fridge, snap.f);
  if (withoutTime(db.shop) !== snap.shop) { db.shop.updatedAt = now; changed = true; }
  takeSnap();
  if (changed) localVer++;
  return changed;
}

function syncInfo() { try { return JSON.parse(localStorage.getItem(SYNC_KEY)) || {}; } catch (e) { return {}; } }
function setSyncInfo(o) {
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(o)); } catch (e) {}
  const el = document.getElementById('syncMsg');
  if (el) el.textContent = syncText();
}
function syncText() {
  if (!relayConf().url) return '연결 전이라 이 기기에만 저장돼요.';
  const s = syncInfo();
  if (s.error) return '⚠️ 동기화 실패: ' + s.error;
  if (!s.at) return '아직 동기화 전이에요.';
  const d = new Date(s.at);
  return `☁︎ 마지막 동기화 ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function scheduleSync(delay = 1500) {
  if (!relayConf().url) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(), delay);
}
async function syncNow(manual) {
  const c = relayConf();
  if (!c.url) return false;
  if (syncing) { syncAgain = true; return false; }
  syncing = true;
  const startVer = localVer;
  let ok = false;
  try {
    const res = await fetch(c.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // CORS 사전 요청 없이 보내려고 text/plain
      body: JSON.stringify({ key: c.key, action: 'sync', data: { recipes: db.recipes, fridge: db.fridge, shop: db.shop, deleted: db.deleted || {} } }),
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error === 'key' ? '비밀번호가 맞지 않아요' : j.error === 'action' ? '스크립트를 새 버전으로 다시 배포해 주세요' : j.error);
    // 보내는 동안 또 고쳤으면 받은 결과로 덮어쓰지 않고 한 번 더 맞춘다
    if (localVer === startVer) applyRemote(j.data); else syncAgain = true;
    setSyncInfo({ at: Date.now() });
    syncErrShown = false;
    ok = true;
    if (manual) toast('동기화했어요');
  } catch (e) {
    const msg = e instanceof TypeError ? '인터넷 연결이나 연결 주소를 확인해 주세요' : String(e.message || e);
    setSyncInfo(Object.assign(syncInfo(), { error: msg }));
    if (manual || !syncErrShown) { toast('동기화하지 못했어요: ' + msg); syncErrShown = true; }
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; scheduleSync(300); }
  }
  return ok;
}
function applyRemote(d) {
  if (!d) return;
  const before = JSON.stringify([db.recipes, db.fridge, db.shop]);
  db.recipes = d.recipes || [];
  db.fridge = d.fridge || [];
  db.shop = Object.assign({ ids: [], checked: {}, extra: [] }, d.shop);
  db.deleted = d.deleted || {};
  takeSnap();
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) {}
  updateBadge();
  // 글 쓰는 중이거나 수정 창이 열려 있으면 화면을 건드리지 않는다
  const busy = /^#\/(new|edit)/.test(location.hash) || document.querySelector('.sheet-back');
  if (!busy && before !== JSON.stringify([db.recipes, db.fridge, db.shop])) rerender();
}

takeSnap();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
window.addEventListener('online', () => syncNow());
syncNow();
