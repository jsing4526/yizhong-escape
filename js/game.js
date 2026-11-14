/* ============================================================
 * 逃离遵化益众 - 主逻辑 v0.2
 * 新增:楼内/全景双视图地图、楼梯按钮、进入教室剧情、游戏时钟、
 *       galgame 打字机对话+角色头像、科技感 UI
 * ============================================================ */
'use strict';

/* ---------- 小工具 ---------- */
const $ = function (id) { return document.getElementById(id); };
const GT0 = new Date(2026, 9, 30, 6, 0, 0).getTime();   // 初始游戏时间 2026-10-30 06:00

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function pad2(n) { return n < 10 ? '0' + n : '' + n; }

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2000);
}

/* ---------- 全局状态 ---------- */
let G = null;
let mapOpen = false;
let mapMode = 'building';   // building 楼内 | all 全景
let dlgBusy = false;
let typeTimer = null;
let typing = false;

const FORM_STYLE = {
  '清醒': '#57e07a', '恍惚': '#f0c05a', '恐慌': '#ff9a5a', '濒临崩溃': '#f25d5d'
};

/* ---------- 屏幕切换 ---------- */
function show(id) {
  const screens = document.querySelectorAll('.screen');
  for (let i = 0; i < screens.length; i++) screens[i].classList.remove('active');
  $(id).classList.add('active');
}

/* ---------- 设置 ---------- */
function applySettings() {
  const s = Store.settings();
  document.body.classList.toggle('light', s.theme === 'light');
  AudioMgr.setVolume(s.vol / 100);
  AudioMgr.setSfx(s.sfx);
  AudioMgr.startMusic(s.music);
}

function syncSettingsUI(box) {
  const s = Store.settings();
  const musicInputs = box.querySelectorAll('input[data-music]');
  for (let i = 0; i < musicInputs.length; i++) {
    musicInputs[i].checked = (musicInputs[i].value === s.music);
    const lb = musicInputs[i].closest('.pill');
    if (lb) lb.classList.toggle('selected', musicInputs[i].checked);
  }
  const vol = box.querySelector('input[data-vol]');
  if (vol) vol.value = s.vol;
  const themeBtns = box.querySelectorAll('button[data-theme]');
  for (let i = 0; i < themeBtns.length; i++) themeBtns[i].classList.toggle('selected', themeBtns[i].getAttribute('data-theme') === s.theme);
  const sfx = box.querySelector('input[data-sfx]');
  if (sfx) sfx.checked = s.sfx;
}

function collectSettings(box, old) {
  const s = clone(old);
  const mi = box.querySelector('input[data-music]:checked');
  if (mi) s.music = mi.value;
  const vol = box.querySelector('input[data-vol]');
  if (vol) s.vol = parseInt(vol.value, 10) || 0;
  const tb = box.querySelector('button[data-theme].selected');
  if (tb) s.theme = tb.getAttribute('data-theme');
  const sfx = box.querySelector('input[data-sfx]');
  if (sfx) s.sfx = sfx.checked;
  return s;
}

function saveSettingsFrom(box) {
  Store.setSettings(collectSettings(box, Store.settings()));
  applySettings();
}

/* ---------- 游戏时钟(1:12) ---------- */
function gameNow() {
  if (!G) return GT0;
  if (G.rt === undefined || G.gt === undefined) return GT0;
  return G.gt + (Date.now() - G.rt) * 12;
}
function fmtGameTime(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '.' + pad2(d.getMonth() + 1) + '.' + pad2(d.getDate()) + ' ' +
    pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}
function persist() {
  if (!G) return;
  G.gt = gameNow();
  G.rt = Date.now();
  Store.upsert(G);
}

/* ---------- 班级分布生成 ---------- */
function genClassMap() {
  const map = {};
  for (let f = 1; f <= 5; f++) {
    const d = CFG.DIST[f];
    const mSlots = CFG.mainSlots();
    const mCls = shuffle(d.main.classes);
    for (let i = 0; i < mCls.length && i < mSlots.length; i++) {
      map[mCls[i]] = { floor: f, slot: mSlots[i].key, x: mSlots[i].x, y: mSlots[i].y };
    }
    const hSlots = CFG.hSlots();
    const hCls = shuffle(d.h.classes);
    for (let i = 0; i < hCls.length && i < hSlots.length; i++) {
      map[hCls[i]] = { floor: f, slot: hSlots[i].key, x: hSlots[i].x, y: hSlots[i].y };
    }
  }
  return map;
}

function nodeXY(floor, id) {
  let i;
  for (i = 0; i < CFG.eightNodes.length; i++) if (CFG.eightNodes[i].id === id) return CFG.eightNodes[i];
  for (i = 0; i < CFG.hNodes.length; i++) if (CFG.hNodes[i].id === id) return CFG.hNodes[i];
  if (id === 'GATE') return CFG.gateNode;
  for (i = 0; i < CFG.pgGrid.length; i++) if (CFG.pgGrid[i].id === id) return CFG.pgGrid[i];
  return null;
}

function nearestNode(floor, x, y) {
  let best = null, bd = 1e9;
  const cands = CFG.eightNodes.concat(CFG.hNodes);
  for (let i = 0; i < cands.length; i++) {
    const d = Math.hypot(cands[i].x - x, cands[i].y - y);
    if (d < bd) { bd = d; best = cands[i]; }
  }
  return best;
}

function stairName(id) {
  for (let i = 0; i < CFG.stairs.length; i++) if (CFG.stairs[i].id === id) return CFG.stairs[i].name;
  if (id === 'H385') return '横段楼楼梯';
  return null;
}

function isInEight(nodeId) {
  if (nodeId === 'GATE' || nodeId === 'CONN') return false;
  for (let i = 0; i < CFG.eightNodes.length; i++) if (CFG.eightNodes[i].id === nodeId) return true;
  return false;
}

function occOf(floor) {
  const occ = {};
  if (!G || !G.classMap) return occ;
  for (const cls in G.classMap) {
    const p = G.classMap[cls];
    if (p.floor === floor) occ[p.slot] = cls;
  }
  return occ;
}

/* 当前节点位置信息(自家班级门口 > 教室门口 > 楼梯 > 走廊) */
function locInfo(floor, nodeId) {
  if (nodeId === 'GATE') return { type: 'gate', name: '大门口' };
  for (let i = 0; i < CFG.pgGrid.length; i++) {
    if (CFG.pgGrid[i].id === nodeId) {
      return CFG.pgGrid[i].up
        ? { type: 'playground-up', name: '操场 · 上部' }
        : { type: 'playground-down', name: '操场 · 下部' };
    }
  }
  const nd = nodeXY(floor, nodeId);
  if (!nd) return { type: 'corridor', name: '走廊' };
  if (G && G.classMap) {
    const own = G.classMap[G.cls];
    if (own && own.floor === floor && Math.hypot(nd.x - own.x, nd.y - own.y) < 46) {
      return { type: 'corridor', name: G.cls + '班 门口' };
    }
    const nr = nearRoom(floor, nodeId);
    if (nr) return { type: 'corridor', name: (nr.cls ? nr.cls + '班' : '空教室') + ' 前' };
  }
  const st = stairName(nodeId);
  if (st) return { type: 'corridor', name: st };
  return { type: 'corridor', name: '走廊' };
}

/* 距离当前节点最近的教室槽位(优先自己的班级) */
function nearRoom(floor, nodeId) {
  const nd = nodeXY(floor, nodeId);
  if (!nd) return null;
  const occ = occOf(floor);
  if (G && G.classMap) {
    const own = G.classMap[G.cls];
    if (own && own.floor === floor && Math.hypot(nd.x - own.x, nd.y - own.y) < 46) {
      return { slot: own.slot, cls: G.cls };
    }
  }
  let best = null, bd = 45;
  const all = CFG.mainSlots().concat(floor >= 2 ? CFG.hSlots() : []);   // 横段楼 1F 无教室
  for (let i = 0; i < all.length; i++) {
    const sl = all[i];
    const d = Math.hypot(nd.x - sl.x, nd.y - sl.y);
    if (d < bd) { bd = d; best = { slot: sl.key, cls: occ[sl.key] || null }; }
  }
  return best;
}

/* ---------- 邻居计算 ---------- */
function neighborsOf(floor, nodeId) {
  const out = [];
  const pairs = [];
  let i;
  for (i = 0; i < CFG.eightLinks.length; i++) pairs.push(CFG.eightLinks[i]);
  for (i = 0; i < CFG.hLinks.length; i++) pairs.push(CFG.hLinks[i]);
  if (floor === 1) {
    for (i = 0; i < CFG.f1Links.length; i++) pairs.push(CFG.f1Links[i]);
    for (i = 0; i < CFG.pgLinks.length; i++) pairs.push(CFG.pgLinks[i]);
  }

  for (i = 0; i < CFG.stairs.length; i++) {
    if (nodeId === CFG.stairs[i].id) {
      if (floor > 1) out.push({ id: nodeId, floor: floor - 1, via: 'down' });
      if (floor < 5) out.push({ id: nodeId, floor: floor + 1, via: 'up' });
    }
  }
  if (nodeId === 'H385') {
    if (floor > 1) out.push({ id: 'H385', floor: floor - 1, via: 'down' });
    if (floor < 5) out.push({ id: 'H385', floor: floor + 1, via: 'up' });
  }
  for (i = 0; i < pairs.length; i++) {
    if (pairs[i][0] === nodeId) out.push({ id: pairs[i][1], floor: floor });
    if (pairs[i][1] === nodeId) out.push({ id: pairs[i][0], floor: floor });
  }
  return out;
}

/* ---------- HUD / 背景 ---------- */
function calcForm() {
  if (!G) return '清醒';
  if (G.san >= 80) return '清醒';
  if (G.san >= 55) return '恍惚';
  if (G.san >= 30) return '恐慌';
  return '濒临崩溃';
}

function barFill(kind, v, max) {
  const m = max || 100;
  $(kind + '-fill').style.width = clamp(v / m * 100, 0, 100) + '%';
  $(kind + '-num').textContent = Math.round(v) + '/' + m;
}

/* ---------- 等级 / 上限 / 状态 ---------- */
function lvlData() {
  return CFG.LEVELS[Math.min(9, Math.max(0, (G && G.lv ? G.lv : 1) - 1))];
}
function maxFromSan() {
  if (!G) return { hp: 100, sp: 100 };
  if (G.ghost) return { hp: 99999, sp: 99999 };
  if (G.san >= 40) return { hp: 100, sp: 100 };
  if (G.san >= 20) return { hp: 80, sp: 80 };
  if (G.san >= 10) return { hp: 60, sp: 60 };
  return { hp: 30, sp: 30 };
}
function clampStats() {
  if (!G) return;
  const m = maxFromSan();
  G.hp = Math.min(G.hp, m.hp);
  G.sp = Math.min(G.sp, m.sp);
}
function expNeed() { return 5 * (G.lv || 1); }
function addExp(n) {
  if (!G) return;
  G.exp = (G.exp || 0) + n;
  while (G.lv < 10 && G.exp >= expNeed()) {
    G.exp -= expNeed();
    G.lv++;
    AudioMgr.sfx('win');
    toast('升级!Lv.' + G.lv + ' 攻击 ' + lvlData().atk + ' 防御 ' + lvlData().def);
  }
  if (G.lv >= 10 && G.exp >= expNeed()) G.exp = expNeed() - 1;
  updateHUD();
}
function statusList() {
  const arr = [];
  if (!G) return arr;
  if (G.ghost) {
    arr.push({ k: 'ghost', n: '诡化', d: '你的精神已经崩断。血量与精力暴涨至 99999,世界开始扭曲变形——你再也不是原来的自己了。' });
    return arr;
  }
  if (G.san < 10) arr.push({ k: 's3', n: '精神极度混乱', d: '血量与精力上限降为 30。视野里全是重影,耳边全是杂音。' });
  else if (G.san < 20) arr.push({ k: 's2', n: '精神中度混乱', d: '血量与精力上限降为 60。耳边总有窃窃私语,分不清是谁在说话。' });
  else if (G.san < 40) arr.push({ k: 's1', n: '精神轻微混乱', d: '血量与精力上限降为 80。手脚发凉,总觉得身后有人。' });
  if (G.buffUntil && G.buffUntil > Date.now()) arr.push({ k: 'bing', n: '烧饼效果', left: Math.ceil((G.buffUntil - Date.now()) / 1000), d: '每 7 秒回复 5 点血量与精力。内心仍然不安。' });
  return arr;
}

function updateHUD() {
  if (!G) return;
  const lv = lvlData();
  const max = maxFromSan();
  $('hud-name').textContent = G.name;
  $('hud-lv').textContent = 'Lv.' + G.lv;
  $('hud-lv').style.color = lv.color;
  $('hud-lv').style.borderColor = lv.color;
  $('exp-fill').style.width = Math.min(100, (G.exp || 0) / expNeed() * 100) + '%';
  $('exp-num').textContent = (G.exp || 0) + ' / ' + expNeed();
  $('hud-form').textContent = G.form;
  $('hud-form').style.color = FORM_STYLE[G.form] || '#e6edf3';
  const info = locInfo(G.floor, G.nodeId);
  $('hud-id').textContent = '身份:' + G.cls + '班 · ' + CFG.floorNames[G.floor] + ' ' + info.name + ' · 攻' + lv.atk + ' 防' + lv.def;
  barFill('hp', G.hp, max.hp); barFill('sp', G.sp, max.sp); barFill('san', G.san, 100);
  $('game-floor').textContent = CFG.floorNames[G.floor];
  $('game-clock').textContent = fmtGameTime(gameNow());
  renderStatuses();
}

/* 左侧状态列 */
function renderStatuses() {
  const col = $('status-col');
  const list = statusList();
  col.innerHTML = '';
  for (let i = 0; i < list.length; i++) {
    const b = document.createElement('div');
    b.className = 'status-badge' + (list[i].k === 'ghost' ? ' ghost' : '');
    b.textContent = list[i].n + (list[i].left ? ' 剩' + list[i].left + 's' : ' 持续中');
    b.addEventListener('click', (function (st) {
      return function () {
        $('status-title').textContent = st.n;
        $('status-desc').textContent = st.d;
        $('status-box').classList.remove('hidden');
        AudioMgr.sfx('tap');
      };
    })(list[i]));
    col.appendChild(b);
  }
  if (!list.length) col.innerHTML = '';
}

/* 属性变化浮字(显示在属性下方) */
let popTimer = null;
function pop(text) {
  const el = $('stat-pop');
  el.textContent = text;
  el.classList.add('show');
  if (popTimer) clearTimeout(popTimer);
  popTimer = setTimeout(function () { el.classList.remove('show'); }, 1800);
}

function updateBg() {
  if (!G) return;
  const bg = $('game-bg');
  let src = CFG.bgs.corridor;
  if (G.inRoom) {
    const nr = nearRoom(G.floor, G.nodeId);
    src = (nr && nr.cls === G.cls) ? CFG.bgs.classroom : CFG.bgs.classroomOther;
  } else if (G.loc === 'classroom') src = CFG.bgs.classroom;
  else if (stairName(G.nodeId)) src = isInEight(G.nodeId) ? CFG.bgs.stair : CFG.bgs.hStair;
  else if (G.loc === 'gate') src = CFG.bgs.gate;
  else if (G.loc === 'playground-up') src = CFG.bgs.playgroundUp;
  else if (G.loc === 'playground-down') src = CFG.bgs.playgroundDown;
  else if (isInEight(G.nodeId)) src = CFG.bgs.corridor;
  else src = CFG.bgs.hCorridor;
  if (bg.getAttribute('src') !== src) bg.setAttribute('src', src);
  /* 地图背景与场景背景联动 */
  const mb = $('map-bg');
  if (mb && mb.getAttribute('src') !== src) mb.setAttribute('src', src);
}

/* ============================================================
 * 地图渲染
 * ============================================================ */
const SVGNS = 'http://www.w3.org/2000/svg';
function S(tag, attrs, parent) {
  const el = document.createElementNS(SVGNS, tag);
  for (const k in attrs) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
}

function svgPathRoundedRect(x, y, w, h, r) {
  return 'M' + (x + r) + ',' + y + ' L' + (x + w - r) + ',' + y +
    ' Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) +
    ' L' + (x + w) + ',' + (y + h - r) +
    ' Q' + (x + w) + ',' + (y + h) + ' ' + (x + w - r) + ',' + (y + h) +
    ' L' + (x + r) + ',' + (y + h) +
    ' Q' + x + ',' + (y + h) + ' ' + x + ',' + (y + h - r) +
    ' L' + x + ',' + (y + r) +
    ' Q' + x + ',' + y + ' ' + (x + r) + ',' + y + ' Z';
}

function eightPath() {
  return svgPathRoundedRect(40, 300, 160, 440, 18) +
    svgPathRoundedRect(75, 335, 90, 135, 14) +
    svgPathRoundedRect(75, 545, 90, 135, 14);
}

/* 横段楼轮廓:1F 中间断开(大门开口) */
function hbldPath(open) {
  if (!open) return svgPathRoundedRect(230, 560, 160, 140, 10);
  return 'M240,560 L380,560 Q390,560 390,570 L390,690 Q390,700 380,700 L330,700 ' +
    'L324,676 L296,676 L250,700 L240,700 Q230,700 230,690 L230,570 Q230,560 240,560 Z';
}

/* 教室槽位绘制 */
function drawRooms(g, f, roomList) {
  const occ = occOf(f);
  const own = G.classMap[G.cls] || {};
  for (let i = 0; i < roomList.length; i++) {
    const sl = roomList[i];
    const cls = occ[sl.key];
    const isOwn = (own.floor === f && own.slot === sl.key);
    const rg = S('g', { cursor: isOwn ? 'pointer' : 'default' }, g);
    S('rect', {
      x: sl.rx, y: sl.ry, width: sl.rw, height: sl.rh,
      fill: isOwn ? '#4d4020' : (cls ? '#36434f' : '#232c38'),
      stroke: isOwn ? '#ffe066' : (cls ? '#55687c' : '#3d4a5a'),
      'stroke-width': isOwn ? 2 : 1,
      'stroke-dasharray': cls ? 'none' : '3 2'
    }, rg);
    if (cls) {
      const short = cls.charAt(1) + cls.slice(2);
      S('text', {
        x: sl.rx + sl.rw / 2, y: sl.ry + sl.rh / 2 + 2.5,
        'text-anchor': 'middle', fill: isOwn ? '#ffe066' : '#cfd8e0',
        'font-size': 7, 'font-weight': isOwn ? 'bold' : 'normal'
      }, rg).textContent = short;
    }
    if (isOwn) {
      S('text', {
        x: sl.rx + sl.rw / 2, y: sl.ry - 3, 'text-anchor': 'middle',
        fill: '#ffe066', 'font-size': 8
      }, rg).textContent = '★';
      rg.addEventListener('click', function () { toast('你的教室:' + G.cls + '班'); });
    }
  }
}

/* 节点绘制(含楼梯编号) */
function drawNodes(g, f, nodeList, withStairNums) {
  const cur = { id: G.nodeId, floor: G.floor };
  const nbs = neighborsOf(f, cur.id);
  const nbKeys = {};
  for (let i = 0; i < nbs.length; i++) nbKeys[nbs[i].id + '@' + nbs[i].floor] = nbs[i];

  for (let i = 0; i < nodeList.length; i++) {
    const n = nodeList[i];
    const isCur = (n.id === cur.id);
    const isStair = stairName(n.id) !== null;
    let nb = nbKeys[n.id + '@' + f];
    if (!nb && isStair) {
      for (let k = 0; k < nbs.length; k++) {
        if (nbs[k].id === n.id && nbs[k].floor !== f) { nb = nbs[k]; break; }
      }
    }
    const ng = S('g', {}, g);
    if (nb) {
      S('rect', {
        x: n.x - 16, y: n.y - 16, width: 32, height: 32,
        fill: 'transparent', cursor: 'pointer', 'data-nid': n.id
      }, ng).addEventListener('click', (function (nid, nf) {
        return function () { onNodeTap(nid, nf); };
      })(n.id, f));
    }
    /* 位点改为方格 */
    if (isCur) {
      S('rect', { x: n.x - 8, y: n.y - 8, width: 16, height: 16, rx: 3, fill: '#ffe066', stroke: '#fff', 'stroke-width': 1.5, class: 'pl-pulse' }, ng);
    } else if (nb) {
      S('rect', { x: n.x - 6, y: n.y - 6, width: 12, height: 12, rx: 2, fill: '#57e07a', stroke: '#1a2c20', 'stroke-width': 1 }, ng);
    } else {
      S('rect', { x: n.x - 5, y: n.y - 5, width: 10, height: 10, rx: 2, fill: '#4a5a6a', opacity: 0.75 }, ng);
    }
    if (isStair && !isCur) {
      S('rect', { x: n.x - 2, y: n.y - 2, width: 4, height: 4, rx: 1, fill: '#1a2c33', opacity: 0.9 }, ng);
    }
    if (n.id === 'GATE') {
      S('text', { x: n.x, y: n.y - 12, 'text-anchor': 'middle', fill: '#ffd97a', 'font-size': 8 }, ng).textContent = '大门';
    }
  }
  if (withStairNums) {
    for (let i = 0; i < CFG.stairs.length; i++) {
      const st = CFG.stairs[i];
      S('text', { x: st.x + 9, y: st.y - 8, 'text-anchor': 'middle', fill: '#7ad7ff', 'font-size': 7 }, g)
        .textContent = String.fromCharCode(0x2460 + i);
    }
  }
}

/* 走廊线 */
function drawCorridors(g, f) {
  const fc = CFG.floorColors[f];
  const segs = [
    'M55 315 L55 730', 'M185 315 L185 730',
    'M55 315 L185 315', 'M55 525 L185 525', 'M55 730 L185 730',
    'M250 630 L383 630'
  ];
  for (let i = 0; i < segs.length; i++) {
    S('path', { d: segs[i], stroke: fc, 'stroke-width': 8, 'stroke-dasharray': '8 6', 'stroke-linecap': 'round', opacity: 0.55 }, g);
  }
  if (f === 1) {
    /* 连廊:8字右下角 → 横段楼最左节点 */
    S('path', { d: 'M185 730 L250 630', stroke: fc, 'stroke-width': 7, 'stroke-dasharray': '7 6', 'stroke-linecap': 'round', opacity: 0.6, fill: 'none' }, g);
    /* 8字右侧各节点 → 操场不同点位(细线) */
    const pgLinks = [
      'M185 380 L258 210', 'M185 440 L258 300', 'M185 525 L258 470'
    ];
    for (let i = 0; i < pgLinks.length; i++) {
      S('path', { d: pgLinks[i], stroke: fc, 'stroke-width': 4, 'stroke-dasharray': '5 5', 'stroke-linecap': 'round', opacity: 0.5, fill: 'none' }, g);
    }
  }
}

/* 全景图(整个学校) */
function drawAll(g, f) {
  const fc = CFG.floorColors[f];
  S('rect', { x: 0, y: 0, width: 400, height: 760, fill: 'rgba(4,8,14,0.8)' }, g);

  /* 操场 / 宿舍 / 公寓 */
  S('rect', { x: 226, y: 150, width: 164, height: 390, rx: 8, fill: '#16281f', stroke: '#35523f', 'stroke-width': 2 }, g);
  S('rect', { x: 252, y: 176, width: 112, height: 338, rx: 56, fill: 'none', stroke: '#35523f', 'stroke-width': 2, 'stroke-dasharray': '6 4' }, g);
  S('text', { x: 308, y: 352, 'text-anchor': 'middle', fill: '#5f7a6a', 'font-size': 10 }, g).textContent = '操场(可进入)';
  S('rect', { x: 282, y: 28, width: 88, height: 92, rx: 6, fill: '#22303f', stroke: '#47617a', 'stroke-width': 1.5 }, g);
  S('text', { x: 326, y: 78, 'text-anchor': 'middle', fill: '#9db6cc', 'font-size': 10 }, g).textContent = '教师公寓';
  S('rect', { x: 28, y: 28, width: 92, height: 92, rx: 6, fill: '#22303f', stroke: '#47617a', 'stroke-width': 1.5 }, g);
  S('text', { x: 74, y: 78, 'text-anchor': 'middle', fill: '#9db6cc', 'font-size': 10 }, g).textContent = '男生宿舍';
  S('rect', { x: 28, y: 150, width: 92, height: 82, rx: 6, fill: '#22303f', stroke: '#47617a', 'stroke-width': 1.5 }, g);
  S('text', { x: 74, y: 195, 'text-anchor': 'middle', fill: '#9db6cc', 'font-size': 10 }, g).textContent = '女生宿舍';

  S('polygon', { points: '200,6 195,14 205,14', fill: '#8a97a8' }, g);
  S('text', { x: 200, y: 26, 'text-anchor': 'middle', fill: '#8a97a8', 'font-size': 9 }, g).textContent = '北';

  /* 8字形教学楼 */
  S('path', { d: eightPath(), fill: '#22303f', stroke: '#47617a', 'stroke-width': 2, 'fill-rule': 'evenodd' }, g);
  S('text', { x: 120, y: 292, 'text-anchor': 'middle', fill: '#9db6cc', 'font-size': 10 }, g).textContent = '8字形教学楼';

  /* 横段教学楼(1F 中间断开=大门) */
  S('path', { d: hbldPath(f === 1), fill: '#22303f', stroke: '#47617a', 'stroke-width': 2 }, g);
  S('text', { x: 310, y: 552, 'text-anchor': 'middle', fill: '#9db6cc', 'font-size': 10 }, g).textContent = '横段教学楼';
  if (f === 1) {
    S('rect', { x: 298, y: 676, width: 10, height: 24, fill: '#0e1a2a', stroke: '#47617a', 'stroke-width': 1 }, g);
    S('rect', { x: 312, y: 676, width: 10, height: 24, fill: '#0e1a2a', stroke: '#47617a', 'stroke-width': 1 }, g);
    S('rect', { x: 306, y: 700, width: 8, height: 34, fill: '#1a2c42' }, g);
    S('text', { x: 310, y: 746, 'text-anchor': 'middle', fill: '#ffd97a', 'font-size': 8 }, g).textContent = '大门口 → 校外';
    S('text', { x: 214, y: 700, 'text-anchor': 'middle', fill: '#7ad7ff', 'font-size': 7 }, g).textContent = '连廊';
  }

  if (f === 1) {
    S('path', { d: 'M185 525 L258 470', stroke: fc, 'stroke-width': 7, 'stroke-dasharray': '7 6', 'stroke-linecap': 'round', opacity: 0.6, fill: 'none' }, g);
    S('text', { x: 205, y: 508, 'text-anchor': 'middle', fill: '#7ad7ff', 'font-size': 7 }, g).textContent = '侧门';
    S('path', { d: 'M308 470 L330 630', stroke: fc, 'stroke-width': 7, 'stroke-dasharray': '7 6', 'stroke-linecap': 'round', opacity: 0.6, fill: 'none' }, g);
    S('text', { x: 334, y: 555, 'text-anchor': 'start', fill: '#7ad7ff', 'font-size': 7 }, g).textContent = '横段楼入口';
  }

  drawCorridors(g, f);
  drawRooms(g, f, CFG.mainSlots().concat(CFG.hSlots()));

  const nodes = CFG.eightNodes.concat(CFG.hNodes);
  if (f === 1) nodes.push(CFG.gateNode);
  for (let i = 0; i < CFG.pgGrid.length; i++) nodes.push(CFG.pgGrid[i]);
  drawNodes(g, f, nodes, true);

  if (f === 1) {
    S('text', { x: 308, y: 134, 'text-anchor': 'middle', fill: '#cfe0f2', 'font-size': 8 }, g).textContent = '上部(1-2排)';
    S('text', { x: 308, y: 432, 'text-anchor': 'middle', fill: '#cfe0f2', 'font-size': 8 }, g).textContent = '下部(3排)';
  }
}

/* 楼内视图(当前建筑,放大居中) */
function drawBuilding(g, f, which) {
  const fc = CFG.floorColors[f];
  S('rect', { x: 0, y: 0, width: 400, height: 760, fill: 'rgba(4,8,14,0.8)' }, g);
  const d = CFG.DIST[f];

  if (which === 'eight') {
    S('path', { d: eightPath(), fill: '#22303f', stroke: '#47617a', 'stroke-width': 2.5, 'fill-rule': 'evenodd' }, g);
    S('text', { x: 120, y: 268, 'text-anchor': 'middle', fill: '#9db6cc', 'font-size': 16, 'font-weight': 'bold' }, g).textContent = '8字形教学楼';
    S('text', { x: 120, y: 288, 'text-anchor': 'middle', fill: fc, 'font-size': 12 }, g).textContent = CFG.floorNames[f] + ' · ' + d.main.tag;
    const segs = ['M55 315 L55 730', 'M185 315 L185 730', 'M55 315 L185 315', 'M55 525 L185 525', 'M55 730 L185 730'];
    for (let i = 0; i < segs.length; i++) {
      S('path', { d: segs[i], stroke: fc, 'stroke-width': 10, 'stroke-dasharray': '9 7', 'stroke-linecap': 'round', opacity: 0.6 }, g);
    }
    if (f === 1) {
      S('path', { d: 'M185 730 L240 645', stroke: fc, 'stroke-width': 9, 'stroke-linecap': 'round', opacity: 0.85, fill: 'none' }, g);
      S('text', { x: 206, y: 660, 'text-anchor': 'middle', fill: '#7ad7ff', 'font-size': 10 }, g).textContent = '连廊→横段楼';
      /* 右侧各节点 → 操场(短引出线) */
      const stubs = ['M185 380 L240 252', 'M185 440 L240 335', 'M185 525 L240 484'];
      for (let i = 0; i < stubs.length; i++) {
        S('path', { d: stubs[i], stroke: fc, 'stroke-width': 6, 'stroke-dasharray': '6 5', 'stroke-linecap': 'round', opacity: 0.5, fill: 'none' }, g);
      }
      S('text', { x: 208, y: 510, 'text-anchor': 'middle', fill: '#7ad7ff', 'font-size': 10 }, g).textContent = '操场侧门→';
    }
    drawRooms(g, f, CFG.mainSlots());
    drawNodes(g, f, CFG.eightNodes, true);
  } else if (which === 'hbld') {
    S('path', { d: hbldPath(f === 1), fill: '#22303f', stroke: '#47617a', 'stroke-width': 3 }, g);
    S('text', { x: 310, y: 545, 'text-anchor': 'middle', fill: '#9db6cc', 'font-size': 18, 'font-weight': 'bold' }, g).textContent = '横段教学楼';
    S('text', { x: 310, y: 565, 'text-anchor': 'middle', fill: fc, 'font-size': 12 }, g).textContent = CFG.floorNames[f] + ' · ' + d.h.tag;
    S('path', { d: 'M250 630 L383 630', stroke: fc, 'stroke-width': 12, 'stroke-dasharray': '10 7', 'stroke-linecap': 'round', opacity: 0.6 }, g);
    if (f === 1) {
      S('path', { d: 'M250 630 L185 730', stroke: fc, 'stroke-width': 9, 'stroke-linecap': 'round', opacity: 0.85, fill: 'none' }, g);
      S('text', { x: 236, y: 700, 'text-anchor': 'middle', fill: '#7ad7ff', 'font-size': 10 }, g).textContent = '←连廊·8字楼';
      S('path', { d: 'M308 470 L330 630', stroke: fc, 'stroke-width': 9, 'stroke-linecap': 'round', opacity: 0.85, fill: 'none' }, g);
      S('text', { x: 292, y: 540, 'text-anchor': 'end', fill: '#7ad7ff', 'font-size': 10 }, g).textContent = '操场入口↑';
      S('rect', { x: 298, y: 676, width: 10, height: 24, fill: '#0e1a2a', stroke: '#47617a', 'stroke-width': 1.2 }, g);
      S('rect', { x: 312, y: 676, width: 10, height: 24, fill: '#0e1a2a', stroke: '#47617a', 'stroke-width': 1.2 }, g);
      S('rect', { x: 306, y: 700, width: 8, height: 34, fill: '#1a2c42' }, g);
      S('text', { x: 310, y: 746, 'text-anchor': 'middle', fill: '#ffd97a', 'font-size': 9 }, g).textContent = '大门口 → 校外';
    }
    S('text', { x: 383, y: 610, 'text-anchor': 'middle', fill: '#7ad7ff', 'font-size': 9 }, g).textContent = '楼梯';
    drawRooms(g, f, CFG.hSlots());
    const nodes = CFG.hNodes.slice();
    if (f === 1) nodes.push(CFG.gateNode);
    drawNodes(g, f, nodes, false);
  } else {
    /* 操场(放大视图,九宫格) */
    S('rect', { x: 226, y: 150, width: 164, height: 390, rx: 8, fill: '#16281f', stroke: '#35523f', 'stroke-width': 3 }, g);
    S('rect', { x: 252, y: 176, width: 112, height: 338, rx: 56, fill: 'none', stroke: '#3f5f4a', 'stroke-width': 3, 'stroke-dasharray': '8 5' }, g);
    S('text', { x: 308, y: 192, 'text-anchor': 'middle', fill: '#9db6cc', 'font-size': 20, 'font-weight': 'bold' }, g).textContent = '操场';
    S('text', { x: 308, y: 214, 'text-anchor': 'middle', fill: fc, 'font-size': 13 }, g).textContent = '1F · 九宫格活动点';
    /* 网格连线 */
    for (let i = 0; i < CFG.pgLinks.length; i++) {
      const a = nodeXY(f, CFG.pgLinks[i][0]), b = nodeXY(f, CFG.pgLinks[i][1]);
      if (a && b) S('path', { d: 'M' + a.x + ' ' + a.y + ' L' + b.x + ' ' + b.y, stroke: fc, 'stroke-width': 4, 'stroke-dasharray': '5 5', 'stroke-linecap': 'round', opacity: 0.45, fill: 'none' }, g);
    }
    S('text', { x: 308, y: 128, 'text-anchor': 'middle', fill: '#cfe0f2', 'font-size': 11 }, g).textContent = '上部(1-2排)';
    S('text', { x: 308, y: 448, 'text-anchor': 'middle', fill: '#cfe0f2', 'font-size': 11 }, g).textContent = '下部(3排)';
    S('path', { d: 'M185 525 L258 470', stroke: fc, 'stroke-width': 10, 'stroke-linecap': 'round', opacity: 0.85, fill: 'none' }, g);
    S('text', { x: 210, y: 508, 'text-anchor': 'middle', fill: '#7ad7ff', 'font-size': 11 }, g).textContent = '←8字楼侧门';
    S('path', { d: 'M308 470 L330 630', stroke: fc, 'stroke-width': 10, 'stroke-linecap': 'round', opacity: 0.85, fill: 'none' }, g);
    S('text', { x: 330, y: 560, 'text-anchor': 'start', fill: '#7ad7ff', 'font-size': 11 }, g).textContent = '横段楼入口↓';
    drawNodes(g, f, CFG.pgGrid, false);
  }
}

function renderMap() {
  if (!G) return;
  const svg = $('map-svg');
  svg.innerHTML = '';
  const f = G.floor;
  const which = (G.nodeId.indexOf('PG') === 0) ? 'pg' : (isInEight(G.nodeId) ? 'eight' : 'hbld');

  /* 楼内视图:放大居中当前建筑;操场点位放大操场;全景:整校 */
  let tx = 0, ty = 0, sc = 1;
  if (mapMode === 'building') {
    if (which === 'eight') { sc = 1.7; tx = -4; ty = -504; }
    else if (which === 'hbld') { sc = 2.2; tx = -482; ty = -900; }
    else { sc = 1.8; tx = -354; ty = -241; }
  }
  const g = S('g', { transform: 'translate(' + tx + ',' + ty + ') scale(' + sc + ')' }, svg);
  if (mapMode === 'building') drawBuilding(g, f, which);
  else drawAll(g, f);

  $('map-floor-big').textContent = CFG.floorNames[f];
  $('map-floor-big').style.color = CFG.floorColors[f];
  $('btn-map-view').textContent = mapMode === 'building' ? '🌐 全景' : '🏫 楼内';
  const info = locInfo(f, G.nodeId);
  const bldName = which === 'eight' ? '8字楼' : (which === 'hbld' ? '横段楼' : '操场');
  $('map-pos-name').textContent = '你在:' + bldName + ' · ' + info.name;

  renderClassPanel(f, occOf(f));
  updateMapActions();
  updateCbBtn();
}

function renderClassPanel(f, occ) {
  const panel = $('map-class-panel');
  const d = CFG.DIST[f];
  let html = '<div class="cp-title">' + CFG.floorNames[f] + ' · 8字楼 ' + d.main.tag + ' / 横段楼 ' + d.h.tag + '</div><div class="cp-chips">';
  const order = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6',
    'T1', 'T2', 'T3', 'M1', 'M2', 'M3', 'B1', 'B2', 'B3', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'H7', 'H8', 'H9'];
  for (let i = 0; i < order.length; i++) {
    const k = order[i];
    const cls = occ[k];
    const isOwn = (G.classMap[G.cls] && G.classMap[G.cls].slot === k);
    if (cls) {
      html += '<span class="chip' + (isOwn ? ' own' : '') + '">' + (isOwn ? '★' : '') + k + ' ' + cls + '班</span>';
    }
  }
  html += '</div>';
  panel.innerHTML = html;
}

/* ---------- 方向按钮移动 ---------- */
/* 节点所属建筑组:eight / hbld / pg / gate / other */
function groupOf(nodeId) {
  if (nodeId === 'GATE') return 'gate';
  let i;
  for (i = 0; i < CFG.eightNodes.length; i++) if (CFG.eightNodes[i].id === nodeId) return 'eight';
  for (i = 0; i < CFG.hNodes.length; i++) if (CFG.hNodes[i].id === nodeId) return 'hbld';
  for (i = 0; i < CFG.pgGrid.length; i++) if (CFG.pgGrid[i].id === nodeId) return 'pg';
  return 'other';
}
function dirCand(dxDir, dyDir) {
  const nbs = neighborsOf(G.floor, G.nodeId).filter(function (n) { return n.floor === G.floor; });
  const nd = nodeXY(G.floor, G.nodeId);
  const curGroup = groupOf(G.nodeId);
  /* 优先走同一栋楼内的走廊,没有同楼方向的邻居时才走"侧门"(操场入口等) */
  const passes = [true, false];
  for (let pass = 0; pass < passes.length; pass++) {
    const sameOnly = passes[pass];
    let best = null, bestVal = 0;
    for (let i = 0; i < nbs.length; i++) {
      if (sameOnly && groupOf(nbs[i].id) !== curGroup) continue;
      const p = nodeXY(G.floor, nbs[i].id);
      if (!p) continue;
      const dx = p.x - nd.x, dy = p.y - nd.y;
      let ok = false;
      if (sameOnly) {
        if (dxDir < 0 && dx < -8 && Math.abs(dx) > Math.abs(dy)) ok = true;
        else if (dxDir > 0 && dx > 8 && Math.abs(dx) > Math.abs(dy)) ok = true;
        else if (dyDir < 0 && dy < -8 && Math.abs(dy) >= Math.abs(dx)) ok = true;
        else if (dyDir > 0 && dy > 8 && Math.abs(dy) >= Math.abs(dx)) ok = true;
      } else {
        /* 侧门方向放宽:只要大致朝向该方向即可(右侧各门) */
        if (dxDir < 0 && dx < -8) ok = true;
        else if (dxDir > 0 && dx > 8) ok = true;
        else if (dyDir < 0 && dy < -8) ok = true;
        else if (dyDir > 0 && dy > 8) ok = true;
      }
      if (!ok) continue;
      const val = dxDir !== 0 ? Math.abs(dx) : Math.abs(dy);
      if (val > bestVal) { bestVal = val; best = nbs[i]; }
    }
    if (best) return best;
  }
  return null;
}
/* ---------- 行为面板(休息/冥想,30s冷却) ---------- */
function cdLeft(key) {
  if (!G) return 0;
  return Math.max(0, (G[key] || 0) - Date.now());
}
function syncActUI() {
  const busy = busyLeft() > 0;
  const rest = cdLeft('cdRest'), med = cdLeft('cdMed');
  const br = $('btn-act-rest'), bm = $('btn-act-med');
  if (!br || !bm) return;
  br.disabled = busy || rest > 0;
  bm.disabled = busy || med > 0;
  br.textContent = busy && G && G.busyKind === 'rest' ? '进行中…' : (rest > 0 ? '休息 ' + Math.ceil(rest / 1000) + 's' : '休息 +10精力');
  bm.textContent = busy && G && G.busyKind === 'med' ? '进行中…' : (med > 0 ? '冥想 ' + Math.ceil(med / 1000) + 's' : '冥想 +5SAN');
}
function openAct() {
  syncActUI();
  $('act-box').classList.remove('hidden');
  AudioMgr.sfx('open');
}

/* ---------- 休息 / 冥想:5 秒读条 ---------- */
let busyTimer = null;
let busyTimeout = null;
function busyLeft() {
  return G ? Math.max(0, (G.busyUntil || 0) - Date.now()) : 0;
}
function busyKindName() {
  return G && G.busyKind === 'med' ? '冥想' : '休息';
}
function busyTick() {
  const total = 3000, left = busyLeft();
  $('busy-bar').style.width = Math.min(100, (total - left) / total * 100) + '%';
  $('busy-left').textContent = (Math.max(0, left) / 1000).toFixed(1) + 's';
}
function doAct(kind) {
  if (!G) return;
  if (F) { toast('先处理眼前的遭遇'); return; }
  if (busyLeft() > 0) { toast('你正在' + busyKindName() + '中,不能动'); return; }
  if (dlgBusy) return;
  const cdKey = kind === 'rest' ? 'cdRest' : 'cdMed';
  if (cdLeft(cdKey) > 0) return;
  G.busyUntil = Date.now() + 3000;
  G.busyKind = kind;
  $('busy-label').textContent = kind === 'rest' ? '休息中…' : '冥想中…';
  $('busy-box').classList.remove('hidden');
  $('busy-cancel').classList.remove('hidden');
  busyTick();
  busyTimer = setInterval(busyTick, 100);
  persist();
  busyTimeout = setTimeout(function () {
    clearInterval(busyTimer);
    busyTimer = null;
    busyTimeout = null;
    $('busy-box').classList.add('hidden');
    if (!G) return;
    G.busyUntil = 0;
    if (kind === 'rest') {
      G.sp = Math.min(G.sp + 10, maxFromSan().sp);
      G.cdRest = Date.now() + 30000;
      pop('精力 +10');
    } else {
      G.san = Math.min(100, G.san + 5);
      G.cdMed = Date.now() + 30000;
      pop('SAN +5');
    }
    addExp(1);
    updateHUD();
    persist();
    syncActUI();
    checkGhost();
  }, 3000);
}

/* 中途终止休息/冥想 */
function cancelBusy() {
  if (!G || busyLeft() <= 0) return;
  if (busyTimer) { clearInterval(busyTimer); busyTimer = null; }
  if (busyTimeout) { clearTimeout(busyTimeout); busyTimeout = null; }
  G.busyUntil = 0;
  G.busyKind = '';
  $('busy-box').classList.add('hidden');
  toast('已中止');
  syncActUI();
  persist();
}

/* ---------- 背包 ---------- */
function addItem(kind, n) {
  if (!G) return;
  G.inv = G.inv || {};
  G.inv[kind] = (G.inv[kind] || 0) + (n || 1);
  toast('获得:' + (CFG.ITEMS[kind] ? CFG.ITEMS[kind].name : kind) + ' ×' + (n || 1));
  renderBag();
}
function renderBag() {
  const box = $('bag-list');
  if (!box) return;
  const inv = (G && G.inv) || {};
  let html = '';
  const keys = Object.keys(inv).filter(function (k) { return inv[k] > 0; });
  if (!keys.length) {
    html = '<div class="contact-tip">背包里空空如也。遇到别人时,也许能捡到点什么。</div>';
  } else {
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const item = CFG.ITEMS[k] || { name: k, icon: '?' };
      const usable = (k === 'hpPotion' || k === 'energyPotion' || k === 'bing');
      html += '<div class="bag-row">' +
        '<span class="bag-name">' + item.icon + ' ' + item.name + ' ×' + inv[k] + '</span>' +
        (usable ? '<button class="btn-mini ok" data-use="' + k + '">使用</button>' : '<span class="bag-note">收藏</span>') +
        '</div>';
    }
  }
  box.innerHTML = html;
  const btns = box.querySelectorAll('button[data-use]');
  for (let i = 0; i < btns.length; i++) {
    btns[i].addEventListener('click', function () {
      useItem(btns[i].getAttribute('data-use'));
    });
  }
}
function useItem(kind) {
  if (!G || !G.inv || !G.inv[kind]) return;
  if (busyLeft() > 0) { toast('正在' + busyKindName() + '中'); return; }
  if (ghostAction()) return;
  const max = maxFromSan();
  if (kind === 'hpPotion') {
    const heal = 1 + Math.floor(Math.random() * 20);
    G.hp = Math.min(G.hp + heal, max.hp);
    pop('血量 +' + heal);
  } else if (kind === 'energyPotion') {
    const heal = 1 + Math.floor(Math.random() * 20);
    G.sp = Math.min(G.sp + heal, max.sp);
    pop('精力 +' + heal);
  } else if (kind === 'bing') {
    G.buffUntil = Date.now() + 120000;
    G.buffNext = Date.now() + 7000;
    G.san = Math.max(0, G.san - 20);
    pop('烧饼生效 2 分钟 · SAN-20');
    checkGhost();
  } else {
    toast('这个物品现在用不上');
    return;
  }
  G.inv[kind]--;
  if (G.inv[kind] <= 0) delete G.inv[kind];
  clampStats();
  renderBag();
  updateHUD();
  persist();
}

/* ---------- 遭遇与战斗 ---------- */
let F = null;
function rollEnemy(base) {
  const e = clone(base);
  /* 等级:普通 0-3,邪恶 2-3;防御统一 0;血量随之小幅提升 */
  e.lv = base.align === 'evil' ? (2 + Math.floor(Math.random() * 2)) : Math.floor(Math.random() * 4);
  e.maxHp = base.hp + e.lv * 4;
  e.hp = e.maxHp;
  if (Array.isArray(base.atk)) {
    const a0 = base.atk[0], a1 = base.atk[1];
    e.atk = Math.min(15, a0 + Math.floor(Math.random() * (a1 - a0 + 1)) + e.lv);
  } else {
    e.atk = base.atk;
  }
  e.def = 0;
  return e;
}
function startBattle(e) {
  if (!G || dlgBusy) return;
  if (G.ghost) { toast('那些影子已经不需要战斗了'); return; }
  if (busyLeft() > 0) { toast('正在' + busyKindName() + '中'); return; }
  F = e;
  F.attacked = false;
  F.log = e.align === 'evil' ? '它的动作很不自然……' : '你们对视着。';
  if (e.weird) {
    G.san = Math.max(0, G.san - 5);
    toast('遇到诡异,失去 5 点 SAN');
  }
  $('btn-foe-flee').classList.add('hidden');   // 剧情过完之前没有"逃离"
  $('foe-box').classList.remove('hidden');
  AudioMgr.sfx('event');
  renderFoe();
  updateHUD();
  if (!e.storyDone) {
    e.storyDone = true;
    runEvent(encounterStory(e));               // 攻击与剧情同时触发
  } else {
    $('btn-foe-flee').classList.remove('hidden');
  }
  if (e.align === 'evil') {
    // 邪恶生物先手攻击
    setTimeout(function () { if (F && !dlgBusy) { foeHit(); renderFoe(); updateHUD(); } }, 1200);
  }
}

/* 普通生物的遭遇剧情(模板来自 config,较复杂) */
function encounterStory(e) {
  let pool;
  if (e.weird) pool = CFG.ENCOUNTER_STORIES.weird;
  else if (e.align === 'evil') pool = CFG.ENCOUNTER_STORIES.evil;
  else if (e.align === 'kind') pool = CFG.ENCOUNTER_STORIES.kind;
  else pool = CFG.ENCOUNTER_STORIES.neutral;
  const tpl = pool[Math.floor(Math.random() * pool.length)];
  const lines = [];
  for (let i = 0; i < tpl.lines.length; i++) {
    lines.push({ s: 'n', t: tpl.lines[i].replace('{name}', e.name) });
  }
  const choices = [];
  for (let i = 0; i < tpl.choices.length; i++) {
    choices.push({
      t: tpl.choices[i].t,
      fx: tpl.choices[i].fx || {},
      reply: { s: 'n', t: String(tpl.choices[i].reply).replace('{name}', e.name) }
    });
  }
  return { id: 'enc', lines: lines, choices: choices };
}
function renderFoe() {
  if (!F) return;
  const an = F.align === 'evil' ? '邪恶' : (F.align === 'kind' ? '善良' : '中立');
  $('foe-name').textContent = F.name;
  $('foe-tag').textContent = 'Lv.' + F.lv + ' · ' + (F.weird ? '诡异 · ' : '') + an + ' · 攻' + F.atk + ' 防' + F.def;
  $('foe-hp').style.width = Math.max(0, F.hp / F.maxHp * 100) + '%';
  $('foe-hp-num').textContent = Math.max(0, Math.round(F.hp)) + '/' + F.maxHp;
  $('foe-log').textContent = F.log;
}
function foeHit() {
  if (!F || !G) return;
  const lv = lvlData();
  const dmg = Math.max(0, F.atk - lv.def);
  G.hp = Math.max(0, G.hp - dmg);
  F.log += ' 它反击,造成 ' + dmg + ' 点伤害。';
  pop('血量 -' + dmg);
  clampStats();
  updateHUD();
  if (G.hp <= 0) { endBattle('lose'); }
}
function attackFoe() {
  if (!F || !G || dlgBusy) return;
  if (busyLeft() > 0) { toast('正在' + busyKindName() + '中'); return; }
  if (ghostAction()) return;
  const lv = lvlData();
  const dmg = Math.max(0, lv.atk - F.def);
  F.hp -= dmg;
  F.attacked = true;
  F.log = '你造成 ' + dmg + ' 点伤害' + (dmg === 0 ? '(全部被防御住了)' : '') + '。';
  AudioMgr.sfx('tap');
  if (F.hp <= 0) { endBattle('win'); return; }
  if (F.align === 'evil' || F.align === 'neutral') {
    setTimeout(function () { if (F) { foeHit(); renderFoe(); updateHUD(); } }, 450);
  } else {
    F.log += ' 它没有还手。';
    renderFoe();
  }
  updateHUD();
}
function fleeBattle() {
  if (!F) return;
  registerNearby(clone(F));
  F = null;
  $('foe-box').classList.add('hidden');
  toast('对方退到一旁,还在原地看着你。');
}function endBattle(kind) {
  if (!F) return;
  const name = F.name;
  if (kind === 'win') {
    F = null;
    $('foe-box').classList.add('hidden');
    clearNearby();
    addExp(5);
    let drop;
    const r = Math.random();
    if (r < 0.30) drop = 'energyPotion';
    else if (r < 0.60) drop = 'hpPotion';
    else if (r < 0.78) drop = 'paper';
    else if (r < 0.90) drop = 'pen';
    else drop = 'bing';
    toast('「' + name + '」逃走了,丢下了' + CFG.ITEMS[drop].name);
    addItem(drop);
    updateHUD();
    persist();
  } else {
    F = null;
    $('foe-box').classList.add('hidden');
    G.hp = 0;
    G.dead = true;
    G.deadReason = 'hp';
    persist();
    showEnd(false);
  }
}
/* 移动/教室后有一定概率遭遇 */
function maybeEncounter(area) {
  if (!G || G.ghost || dlgBusy) return;
  if (window.__testNoEnc) return;
  if (F) return;
  if (busyLeft() > 0) return;
  if (Math.random() > 0.3) return;
  let pool;
  if (area === 'play') {
    pool = CFG.ENEMIES.play;
  } else if (Math.random() < 0.06) {
    startBattle(rollEnemy(CFG.ENEMIES.zhang));
    return;
  } else if (Math.random() < 0.25) {
    pool = CFG.ENEMIES.weird;
  } else {
    pool = CFG.ENEMIES.hall;
  }
  startBattle(rollEnemy(pool[Math.floor(Math.random() * pool.length)]));
}

/* ---------- 诡化 ---------- */
let ghostTimer = null;
function ghostAction() {
  if (!G || !G.ghost) return false;
  G.ghostLeft = (G.ghostLeft || 0) - 1;
  persist();
  if (G.ghostLeft <= 0) {
    endGhost();
    return true;
  }
  return false;
}
function checkGhost() {
  if (!G || G.ghost) return;
  if (G.san > 0) return;
  G.ghost = true;
  G.ghostLeft = 3;
  G.hp = 99999;
  G.sp = 99999;
  $('ghost-overlay').classList.remove('hidden');
  ghostTick();
  ghostTimer = setInterval(ghostTick, 1600);
  toast('你的精神崩断了……');
  AudioMgr.sfx('lose');
  updateHUD();
  persist();
}
function ghostTick() {
  if (!G || !G.ghost) return;
  const ov = $('ghost-overlay');
  const t = CFG.GHOST_TEXTS[Math.floor(Math.random() * CFG.GHOST_TEXTS.length)];
  const el = document.createElement('div');
  el.className = 'ghost-text';
  el.style.left = (5 + Math.random() * 60) + '%';
  el.style.top = (8 + Math.random() * 80) + '%';
  el.textContent = t;
  ov.appendChild(el);
  if (ov.children.length > 14) ov.removeChild(ov.firstChild);
}
function endGhost() {
  if (ghostTimer) { clearInterval(ghostTimer); ghostTimer = null; }
  const ov = $('ghost-overlay');
  ov.classList.add('ghost-final');
  G.dead = true;
  G.deadReason = 'ghost';
  persist();
  setTimeout(function () {
    $('end-title').textContent = '迷失';
    $('end-text').textContent = CFG.GHOST_ENDING + '。';
    $('end-title').style.color = '#ff2d55';
    show('scr-end');
  }, 900);
}

function moveDir(dxDir, dyDir) {
  if (dlgBusy || !G || G.inRoom) return;
  const c = dirCand(dxDir, dyDir);
  if (c) moveTo(c.id, G.floor);
  else { toast('这个方向走不了'); AudioMgr.sfx('tap'); }
}

/* 地图悬浮操作按钮 */
function updateMapActions() {
  if (!G) return;
  const f = G.floor, id = G.nodeId;
  const st = stairName(id);
  $('btn-stair-up').classList.toggle('hidden', !st || f >= 5);
  $('btn-stair-down').classList.toggle('hidden', !st || f <= 1);
  const nr = nearRoom(f, id);
  $('btn-enter-room').classList.toggle('hidden', !nr || !!G.inRoom);
  if (nr && !G.inRoom) $('btn-enter-room').textContent = '🚪 进入' + (nr.cls ? nr.cls + '班' : '空教室');
  $('btn-gate-act').classList.toggle('hidden', !(id === 'GATE' && f === 1));
  $('btn-d-up').disabled = !dirCand(0, -1);
  $('btn-d-down').disabled = !dirCand(0, 1);
  $('btn-d-left').disabled = !dirCand(-1, 0);
  $('btn-d-right').disabled = !dirCand(1, 0);
}

/* ---------- 节点点击 / 移动 ---------- */
function onNodeTap(id, floor) {
  if (dlgBusy) return;
  if (id === G.nodeId && floor === G.floor) {
    const nbs = neighborsOf(G.floor, G.nodeId);
    let hop = null;
    for (let i = 0; i < nbs.length; i++) {
      if (nbs[i].id === id && nbs[i].floor === G.floor - 1) { hop = nbs[i]; break; }
    }
    if (!hop) {
      for (let i = 0; i < nbs.length; i++) {
        if (nbs[i].id === id && nbs[i].floor === G.floor + 1) { hop = nbs[i]; break; }
      }
    }
    if (hop) { moveTo(id, hop.floor, hop.via); return; }
    toast('你就在这里');
    return;
  }
  const nbs = neighborsOf(G.floor, G.nodeId);
  let hit = null;
  for (let i = 0; i < nbs.length; i++) {
    if (nbs[i].id === id && nbs[i].floor === floor) { hit = nbs[i]; break; }
  }
  if (!hit) { toast('太远了,只能移动到相邻的点位'); AudioMgr.sfx('tap'); return; }
  moveTo(id, floor, hit.via);
}

function moveTo(id, floor, via) {
  if (dlgBusy || G.inRoom) return;
  if (F) { toast('先处理眼前的遭遇'); return; }
  if (busyLeft() > 0) { toast('你正在' + busyKindName() + '中,不能动'); return; }
  if (G.sp <= 0) { toast('精力耗尽,走不动了。点右上角「行为」休息一下'); return; }
  if (ghostAction()) return;
  const oldFloor = G.floor;
  G.sp = Math.max(0, G.sp - 2);
  G.floor = floor;
  G.nodeId = id;
  G.steps = (G.steps || 0) + 1;
  G.loc = locInfo(floor, id).type;
  G.form = calcForm();
  AudioMgr.sfx('move');
  if (mapOpen) renderMap();
  updateHUD();
  updateBg();
  persist();

  if (floor !== oldFloor) {
    const st = stairName(id);
    toast('到达 ' + CFG.floorNames[floor] + (st ? '(' + st + (via === 'up' ? '·上楼' : '·下楼') + ')' : ''));
  }

  if (G.nearby) clearNearby();   // 离开点位后周边生物消失

  if (id === 'GATE') {
    if (G.won) { toast('你已经通关了!点右下角「冲出去」即可离开'); }
    else if (!dlgBusy) runEvent(CFG.EVENTS.gate);
    return;
  }
  if (G.flags.spawn && !dlgBusy && !window.__testNoEvt && Math.random() < 0.22) {
    runEvent(CFG.EVENTS.random[Math.floor(Math.random() * CFG.EVENTS.random.length)]);
    return;
  }
  if (!dlgBusy) {
    const area = G.nodeId.indexOf('PG') === 0 ? 'play' : 'hall';
    maybeEncounter(area);
  }
}

/* ---------- 进入教室 ---------- */
function enterRoom() {
  if (dlgBusy || !G || G.inRoom) return;
  if (F) { toast('先处理眼前的遭遇'); return; }
  if (busyLeft() > 0) { toast('你正在' + busyKindName() + '中,不能动'); return; }
  const nr = nearRoom(G.floor, G.nodeId);
  if (!nr) return;
  if (G.sp <= 0) { toast('精力耗尽,先休息一下吧'); return; }
  if (ghostAction()) return;
  G.sp = Math.max(0, G.sp - 2);
  const isOwn = nr.cls === G.cls;
  const key = 'room:' + G.floor + ':' + nr.slot;
  const visited = !!G.flags[key];
  G.flags[key] = true;
  G.inRoom = true;
  mapOpen = false;
  AudioMgr.sfx('open');
  show('scr-game');
  updateBg();
  updateHUD();
  persist();

  let evt;
  if (isOwn && !G.flags.ownRoom) evt = CFG.ownRoom;
  else if (!visited) evt = CFG.roomEvents[Math.floor(Math.random() * CFG.roomEvents.length)];
  else evt = CFG.roomRepeat;
  runEvent(evt);
}

/* ---------- 剧情效果 ---------- */
function applyFx(fx) {
  if (!fx) return;
  const max = maxFromSan();
  if (fx.hp) G.hp = clamp(G.hp + fx.hp, 0, max.hp);
  if (fx.sp) G.sp = clamp(G.sp + fx.sp, 0, max.sp);
  if (fx.san) G.san = clamp(G.san + fx.san, 0, 100);
  if (fx.flag) G.flags[fx.flag] = true;
  if (fx.next === 'win') G.won = true;
  if (fx.item) addItem(fx.item);
  clampStats();
  G.form = calcForm();
  updateHUD();
  checkGhost();
}

function resolveChoice(c) {
  if (c.rand) {
    let r = Math.random(), acc = 0;
    for (let i = 0; i < c.rand.length; i++) {
      acc += c.rand[i].p;
      if (r <= acc) return { fx: c.rand[i].fx, reply: c.rand[i].reply };
    }
    return { fx: {}, reply: c.rand[c.rand.length - 1].reply };
  }
  return { fx: c.fx, reply: c.reply };
}

/* ---------- 对话(galgame 打字机 + 头像) ---------- */
let dlgImgFallback = false;
function setDlgImg(img) {
  const im = $('dlg-img');
  const ic = $('dlg-icon');
  if (img) {
    im.style.display = 'block';
    ic.style.display = 'none';
    if (im.getAttribute('src') !== img) im.setAttribute('src', img);
  } else {
    im.style.display = 'none';
    ic.style.display = 'block';
  }
}
/* ---------- 周边生物(剧情生物留在原地,离开点位才消失) ---------- */
function enemyFor(key) {
  if (key === 'zhang') return CFG.ENEMIES.zhang;
  if (key === 'zhixi') return CFG.ENEMIES.hall[0];
  return null;
}
function registerNearby(e) {
  if (!G || !e) return;
  G.nearby = e;
  updateCbBtn();
}
function clearNearby() {
  if (G) G.nearby = null;
  updateCbBtn();
}
function updateCbBtn() {
  const b = $('btn-cb');
  if (!b) return;
  const has = !!(G && G.nearby);
  b.classList.toggle('hidden', !has);
}
function openCb() {
  if (!G || !G.nearby) { toast('这附近已经没有人了'); return; }
  renderCb();
  $('cb-box').classList.remove('hidden');
  AudioMgr.sfx('open');
}
function renderCb() {
  const box = $('cb-list');
  if (!box || !G || !G.nearby) return;
  const e = G.nearby;
  const an = e.align === 'evil' ? '邪恶' : (e.align === 'kind' ? '善良' : '中立');
  box.innerHTML = '<div class="foe-head">' +
    '<div class="foe-pic">?</div>' +
    '<div class="foe-info">' +
    '<div class="foe-name">' + e.name + '</div>' +
    '<div class="foe-tag">Lv.' + e.lv + ' · ' + (e.weird ? '诡异 · ' : '') + an + ' · 攻' + e.atk + ' 防' + e.def + '</div>' +
    '<div class="stat-row"><span class="stat-name">血量</span><div class="stat-bar"><div class="stat-fill foe-hp" style="width:' + Math.max(0, e.hp / e.maxHp * 100) + '%"></div></div><span class="stat-num">' + Math.max(0, Math.round(e.hp)) + '/' + e.maxHp + '</span></div>' +
    '</div></div>';
}
function attackNearby() {
  if (!G || !G.nearby) return;
  const e = clone(G.nearby);
  $('cb-box').classList.add('hidden');
  startBattle(e);
}

function runEvent(evt) {
  if (dlgBusy || !G) return;
  if (evt.flag && G.flags[evt.flag]) return;
  if (evt.enemy && !G.ghost) registerNearby(rollEnemy(enemyFor(evt.enemy)));
  dlgBusy = true;
  AudioMgr.sfx('event');
  const dlg = $('dlg');
  dlg.classList.remove('hidden');
  dlg.classList.add('dlg-in');
  let li = 0;
  let stage = 'lines';
  let reply = null;

  function setFace(sp) {
    $('dlg-name').textContent = sp.name;
    $('dlg-portrait').style.background = sp.color;
    setDlgImg(sp.img);
    if (!sp.img) $('dlg-icon').textContent = sp.icon;
  }
  function startTyping(text) {
    clearTimeout(typeTimer);
    typing = true;
    const el = $('dlg-text');
    el.textContent = '';
    let i = 0;
    const tick = function () {
      i += 1;
      el.textContent = text.slice(0, i);
      if (i >= text.length) { typing = false; return; }
      typeTimer = setTimeout(tick, 24);
    };
    tick();
  }
  function finishTyping() {
    clearTimeout(typeTimer);
    typing = false;
    $('dlg-text').textContent = $('dlg-text').textContent;   // 保持
    // 直接补全当前文本
    const full = curFullText;
    if (full !== undefined) $('dlg-text').textContent = full;
  }
  let curFullText = '';
  function render() {
    const box = $('dlg-choices');
    box.innerHTML = '';
    if (stage === 'lines') {
      const ln = evt.lines[li];
      const sp = CFG.SPEAKERS[ln.s] || CFG.SPEAKERS.n;
      setFace(sp);
      curFullText = ln.t;
      startTyping(curFullText);
    } else if (stage === 'choices') {
      setFace(CFG.SPEAKERS.n);
      curFullText = '你要怎么做?';
      startTyping(curFullText);
      for (let i = 0; i < evt.choices.length; i++) {
        (function (c) {
          const b = document.createElement('button');
          b.className = 'choice-btn';
          b.textContent = c.t;
          b.addEventListener('click', function (e) { e.stopPropagation(); pick(c); });
          box.appendChild(b);
        })(evt.choices[i]);
      }
    } else if (stage === 'reply') {
      const sp = CFG.SPEAKERS[reply.s] || CFG.SPEAKERS.n;
      setFace(sp);
      curFullText = reply.t;
      startTyping(curFullText);
    }
  }
  function pick(c) {
    const r = resolveChoice(c);
    applyFx(r.fx);
    reply = r.reply;
    if (reply) { stage = 'reply'; render(); }
    else closeDlg();
  }
  function closeDlg() {
    dlg.classList.add('hidden');
    dlg.classList.remove('dlg-in');
    dlgBusy = false;
    typing = false;
    clearTimeout(typeTimer);
    if (evt.flag) G.flags[evt.flag] = true;
    if (G.inRoom) {
      G.inRoom = false;
      updateBg();
      updateHUD();
      if (mapOpen) { renderMap(); }
      if (Math.random() < 0.2) { maybeEncounter('hall'); }
    }
    if (F) $('btn-foe-flee').classList.remove('hidden');
    persist();
    checkEnd();
  }
  dlg.onclick = function () {
    AudioMgr.sfx('tap');
    if (typing) { clearTimeout(typeTimer); typing = false; $('dlg-text').textContent = curFullText; return; }
    if (stage === 'lines') {
      li++;
      if (li >= evt.lines.length) stage = 'choices';
      render();
    } else if (stage === 'reply') {
      closeDlg();
    }
  };
  render();
}

function checkEnd() {
  if (!G) return;
  if (G.won) { showEnd(true); return; }
  if (G.hp <= 0) { G.dead = true; G.deadReason = 'hp'; persist(); showEnd(false); return; }
  if (G.san <= 0) { checkGhost(); return; }
}

/* ---------- 结局 ---------- */
function showEnd(win) {
  if (win) {
    $('end-title').textContent = '逃离成功!';
    $('end-text').textContent = '你撞开校门,冲进了夜色里。身后的益众中学渐渐远去,只有路灯一路送你回家。……通关存档已保存。';
    $('end-title').style.color = '#ffe066';
    AudioMgr.sfx('win');
  } else {
    $('end-title').style.color = '#f25d5d';
    AudioMgr.sfx('lose');
    if (G && G.deadReason === 'san') {
      $('end-title').textContent = '你疯了……';
      $('end-text').textContent = '当最后的理智崩断,你转身走回教学楼深处,和那些走不出去的人一样,再也没出来。';
    } else {
      $('end-title').textContent = '你倒下了……';
      $('end-text').textContent = '体力耗尽,你靠着墙滑坐下去。迷迷糊糊中,似乎有人在喊你的名字。';
    }
  }
  show('scr-end');
}

/* 强制关闭残留对话(退出/读档/开新局时清理) */
function cancelDlg() {
  const dlg = $('dlg');
  dlg.classList.add('hidden');
  dlg.classList.remove('dlg-in');
  dlgBusy = false;
  typing = false;
  clearTimeout(typeTimer);
}

/* ---------- 新游戏 / 读档 ---------- */
function newGame(name, grade, dept, num) {
  const cls = grade + dept.charAt(0) + num;
  const classMap = genClassMap();
  const pos = classMap[cls];
  if (!pos) { toast('班级生成失败,请重试'); return; }
  const node = nearestNode(pos.floor, pos.x, pos.y);
  const now = Date.now();
  G = {
    id: now.toString(36) + Math.random().toString(36).slice(2, 6),
    name: name || '无名同学',
    grade: grade, dept: dept, num: num, cls: cls,
    floor: pos.floor, nodeId: node.id, loc: 'classroom',
    hp: 100, sp: 100, san: 100,
    lv: 1, exp: 0, inv: {}, nearby: null,
    ghost: false, ghostLeft: 0,
    buffUntil: 0, buffNext: 0,
    cdRest: 0, cdMed: 0, busyUntil: 0, busyKind: '',
    form: '清醒', steps: 0,
    flags: {}, classMap: classMap,
    won: false, dead: false, deadReason: null,
    inRoom: false,
    gt: GT0, rt: now,
    updatedAt: now
  };
  persist();
  mapOpen = false;
  showGame();
  toast('你出生在' + cls + '班(' + CFG.floorNames[pos.floor] + ')');
  runEvent(CFG.EVENTS.spawn);
}

function showGame() {
  show('scr-game');
  updateHUD();
  updateBg();
}

function loadSave(id) {
  const s = Store.saves().find(function (x) { return x.id === id; });
  if (!s) return;
  cancelDlg();
  G = clone(s);
  if (G.gt === undefined) { G.gt = GT0; G.rt = Date.now(); }
  if (G.lv === undefined) G.lv = 1;
  if (G.exp === undefined) G.exp = 0;
  if (!G.inv) G.inv = {};
  if (G.ghost === undefined) G.ghost = false;
  if (G.buffUntil === undefined) G.buffUntil = 0;
  if (G.cdRest === undefined) G.cdRest = 0;
  if (G.cdMed === undefined) G.cdMed = 0;
  G.busyUntil = 0;
  G.inRoom = false;
  G.nearby = null;
  mapOpen = false;
  $('ghost-overlay').classList.add('hidden');
  $('foe-box').classList.add('hidden');
  $('busy-box').classList.add('hidden');
  $('cb-box').classList.add('hidden');
  updateCbBtn();
  F = null;
  clampStats();
  if (G.won) {
    G.floor = 1; G.nodeId = 'GATE'; G.loc = 'gate';
    persist();
    showGame();
    toast('该存档已通关:已传送到大门口,点「冲出去」离开');
    return;
  }
  if (G.dead) {
    const pos = G.classMap[G.cls];
    const node = nearestNode(pos.floor, pos.x, pos.y);
    G.floor = pos.floor; G.nodeId = node.id; G.loc = 'classroom';
    G.hp = 100; G.sp = 100; G.san = 100;
    G.dead = false; G.deadReason = null;
    G.ghost = false; G.ghostLeft = 0;
    G.buffUntil = 0;
    G.form = '清醒';
    persist();
    showGame();
    toast('你从教室里醒来,仿佛做了一场噩梦……');
    return;
  }
  showGame();
}

/* ---------- 存档列表 ---------- */
function renderSaves() {
  const box = $('saves-list');
  const arr = Store.saves();
  box.innerHTML = '';
  if (!arr.length) {
    box.innerHTML = '<div class="empty-tip">暂无存档<br>点击主页「开始游戏」创建第一个存档</div>';
    return;
  }
  arr.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
  for (let i = 0; i < arr.length; i++) {
    (function (s) {
      const row = document.createElement('div');
      row.className = 'save-row';
      const info = locInfo(s.floor, s.nodeId);
      let badge = '进行中', bcls = 'badge-run';
      if (s.won) { badge = '已通关'; bcls = 'badge-win'; }
      else if (s.dead) { badge = '已失败'; bcls = 'badge-dead'; }
      const when = new Date(s.updatedAt);
      const timeStr = (when.getMonth() + 1) + '/' + when.getDate() + ' ' +
        String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0');
      const gtime = (s.gt !== undefined) ? fmtGameTime(s.gt) : '';
      row.innerHTML =
        '<div class="save-main">' +
          '<div class="save-title">' + escapeHtml(s.name) + ' · ' + escapeHtml(s.cls) + '班 <span class="badge ' + bcls + '">' + badge + '</span></div>' +
          '<div class="save-sub">位置:' + CFG.floorNames[s.floor] + ' · ' + escapeHtml(info.name) + ' | 血量' + Math.round(s.hp) + ' 精力' + Math.round(s.sp) + ' SAN' + Math.round(s.san) + '</div>' +
          '<div class="save-sub">' + (gtime ? '游戏时间 ' + gtime + ' · ' : '') + '保存于 ' + timeStr + '</div>' +
        '</div>' +
        '<div class="save-btns">' +
          '<button class="btn-mini ok">继续</button>' +
          '<button class="btn-mini danger">删除</button>' +
        '</div>';
      row.querySelector('.ok').addEventListener('click', function () {
        AudioMgr.sfx('open');
        loadSave(s.id);
      });
      row.querySelector('.danger').addEventListener('click', function () {
        if (window.confirm('确定删除该存档吗?此操作不可恢复。')) {
          Store.remove(s.id);
          renderSaves();
        }
      });
      box.appendChild(row);
    })(arr[i]);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

/* ---------- 复制文本 ---------- */
function fallbackCopy(t) {
  const ta = document.createElement('textarea');
  ta.value = t;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
}
function copyText(t) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(t).catch(function () { fallbackCopy(t); });
  } else {
    fallbackCopy(t);
  }
}

/* ---------- 游戏内菜单 ---------- */
function openGmenu() {
  syncSettingsUI($('gmenu'));
  $('gmenu').classList.remove('hidden');
  AudioMgr.sfx('open');
}
function closeGmenu() {
  $('gmenu').classList.add('hidden');
}

/* ---------- 角色卡 ---------- */
let cardState = { grade: '高一', dept: 'A部' };

function renderCard() {
  const grades = document.querySelectorAll('#card-grade button');
  for (let i = 0; i < grades.length; i++) {
    grades[i].classList.toggle('selected', grades[i].getAttribute('data-grade') === cardState.grade);
  }
  const depts = document.querySelectorAll('#card-dept button');
  for (let i = 0; i < depts.length; i++) {
    depts[i].classList.toggle('selected', depts[i].getAttribute('data-dept') === cardState.dept);
  }
}

/* ---------- 初始化 ---------- */
function init() {
  if (window.__initDone) return;   // 防止 DOMContentLoaded 重复触发导致事件重复绑定
  window.__initDone = true;
  document.addEventListener('pointerdown', function () {
    AudioMgr.boot();
    AudioMgr.startMusic(Store.settings().music);
  }, { once: true });

  /* 游戏时钟每秒刷新 */
  setInterval(function () {
    if (G && $('scr-game').classList.contains('active')) {
      $('game-clock').textContent = fmtGameTime(gameNow());
    }
    if (!$('act-box').classList.contains('hidden')) syncActUI();
    /* 烧饼 buff:每 7 秒回复 */
    if (G && !G.ghost && G.buffUntil && G.buffUntil > Date.now()) {
      if (!G.buffNext || Date.now() >= G.buffNext) {
        G.buffNext = Date.now() + 7000;
        const m = maxFromSan();
        G.hp = Math.min(G.hp + 5, m.hp);
        G.sp = Math.min(G.sp + 5, m.sp);
        pop('烧饼:血量+5 精力+5');
        updateHUD();
      }
    }
  }, 1000);

  /* 对话头像加载失败回退 */
  $('dlg-img').addEventListener('error', function () {
    $('dlg-img').style.display = 'none';
    $('dlg-icon').style.display = 'block';
  });

  /* 主页 */
  $('btn-start').addEventListener('click', function () {
    AudioMgr.sfx('open');
    renderCard();
    show('scr-card');
  });
  $('btn-saves').addEventListener('click', function () {
    AudioMgr.sfx('open');
    renderSaves();
    show('scr-saves');
  });
  $('btn-settings').addEventListener('click', function () {
    AudioMgr.sfx('open');
    syncSettingsUI($('scr-settings'));
    show('scr-settings');
  });
  $('btn-changelog').addEventListener('click', function () {
    AudioMgr.sfx('open');
    renderChangelog();
    $('changelog-box').classList.remove('hidden');
  });
  $('btn-changelog-close').addEventListener('click', function () {
    AudioMgr.sfx('tap');
    $('changelog-box').classList.add('hidden');
  });

  /* 存档页 */
  $('btn-saves-back').addEventListener('click', function () { show('scr-home'); });

  /* 设置页 */
  const setBox = $('scr-settings');
  setBox.querySelectorAll('input[data-music]').forEach(function (el) {
    el.addEventListener('change', function () { saveSettingsFrom(setBox); syncSettingsUI(setBox); });
  });
  setBox.querySelector('input[data-vol]').addEventListener('input', function () { saveSettingsFrom(setBox); });
  setBox.querySelectorAll('button[data-theme]').forEach(function (el) {
    el.addEventListener('click', function () {
      setBox.querySelectorAll('button[data-theme]').forEach(function (b) { b.classList.remove('selected'); });
      el.classList.add('selected');
      saveSettingsFrom(setBox);
    });
  });
  setBox.querySelector('input[data-sfx]').addEventListener('change', function () { saveSettingsFrom(setBox); });
  $('btn-set-back').addEventListener('click', function () { show('scr-home'); });

  /* 角色卡 */
  document.querySelectorAll('#card-grade button').forEach(function (el) {
    el.addEventListener('click', function () {
      cardState.grade = el.getAttribute('data-grade');
      renderCard();
      AudioMgr.sfx('tap');
    });
  });
  document.querySelectorAll('#card-dept button').forEach(function (el) {
    el.addEventListener('click', function () {
      cardState.dept = el.getAttribute('data-dept');
      renderCard();
      AudioMgr.sfx('tap');
    });
  });
  $('btn-card-back').addEventListener('click', function () { show('scr-home'); });
  $('btn-card-back2').addEventListener('click', function () { show('scr-home'); });
  document.querySelectorAll('#card-faction .faction').forEach(function (el) {
    el.addEventListener('click', function () {
      if (el.classList.contains('disabled')) {
        AudioMgr.sfx('tap');
        toast(el.getAttribute('data-faction') === 'teacher' ? '「老师」阵营暂未开放' : '「主任」阵营暂未开放');
      }
    });
  });
  $('btn-card-start').addEventListener('click', function () {
    const name = ($('card-name').value || '').trim();
    const num = $('card-num').value;
    AudioMgr.sfx('open');
    newGame(name || '无名同学', cardState.grade, cardState.dept, num);
  });

  /* 游戏内 */
  $('btn-map').addEventListener('click', function () {
    mapOpen = true;
    mapMode = 'building';
    AudioMgr.sfx('open');
    $('map-class-panel').classList.add('hidden');
    renderMap();
    show('scr-map');
  });
  $('btn-menu').addEventListener('click', openGmenu);
  $('btn-act').addEventListener('click', openAct);
  $('btn-cb').addEventListener('click', openCb);
  $('btn-cb-attack').addEventListener('click', attackNearby);
  $('btn-cb-close').addEventListener('click', function () {
    AudioMgr.sfx('tap');
    $('cb-box').classList.add('hidden');
  });

  /* 背包 */
  $('btn-bag').addEventListener('click', function () {
    AudioMgr.sfx('open');
    renderBag();
    $('bag-box').classList.remove('hidden');
  });
  $('btn-bag-close').addEventListener('click', function () {
    AudioMgr.sfx('tap');
    $('bag-box').classList.add('hidden');
  });

  /* 状态详情 */
  $('btn-status-close').addEventListener('click', function () {
    AudioMgr.sfx('tap');
    $('status-box').classList.add('hidden');
  });

  /* 行为面板 */
  $('btn-act-close').addEventListener('click', function () {
    AudioMgr.sfx('tap');
    $('act-box').classList.add('hidden');
  });
  $('btn-act-rest').addEventListener('click', function () { doAct('rest'); });
  $('busy-cancel').addEventListener('click', cancelBusy);
  $('btn-act-med').addEventListener('click', function () { doAct('med'); });

  /* 战斗 */
  $('btn-foe-attack').addEventListener('click', attackFoe);
  $('btn-foe-flee').addEventListener('click', fleeBattle);

  /* 地图 */
  $('btn-map-back').addEventListener('click', function () {
    mapOpen = false;
    AudioMgr.sfx('tap');
    show('scr-game');
  });
  $('btn-map-view').addEventListener('click', function () {
    AudioMgr.sfx('tap');
    mapMode = mapMode === 'building' ? 'all' : 'building';
    renderMap();
  });
  $('btn-map-classes').addEventListener('click', function () {
    AudioMgr.sfx('tap');
    $('map-class-panel').classList.toggle('hidden');
  });
  $('btn-stair-up').addEventListener('click', function () {
    if (dlgBusy || !G) return;
    if (G.floor < 5) moveTo(G.nodeId, G.floor + 1, 'up');
  });
  $('btn-stair-down').addEventListener('click', function () {
    if (dlgBusy || !G) return;
    if (G.floor > 1) moveTo(G.nodeId, G.floor - 1, 'down');
  });
  $('btn-enter-room').addEventListener('click', enterRoom);
  $('btn-gate-act').addEventListener('click', function () {
    if (dlgBusy || !G) return;
    if (G.won) { showEnd(true); return; }
    runEvent(CFG.EVENTS.gate);
  });
  $('btn-d-up').addEventListener('click', function () { moveDir(0, -1); });
  $('btn-d-down').addEventListener('click', function () { moveDir(0, 1); });
  $('btn-d-left').addEventListener('click', function () { moveDir(-1, 0); });
  $('btn-d-right').addEventListener('click', function () { moveDir(1, 0); });

  /* 联系作者 */
  $('btn-contact').addEventListener('click', function () {
    AudioMgr.sfx('open');
    $('contact-box').classList.remove('hidden');
  });
  $('btn-contact-close').addEventListener('click', function () {
    AudioMgr.sfx('tap');
    $('contact-box').classList.add('hidden');
  });
  $('btn-copy-qq').addEventListener('click', function () {
    AudioMgr.sfx('tap');
    copyText('1132666296');
    toast('QQ群号已复制:1132666296');
  });
  $('btn-open-qq').addEventListener('click', function () {
    AudioMgr.sfx('tap');
    try {
      window.location.href = 'mqqwpa://im/chat?chat_type=group&uin=1132666296&version=1&src_type=web';
    } catch (e) {}
    setTimeout(function () { toast('若未跳转,请复制群号到 QQ 搜索加入'); }, 1300);
  });

  /* 游戏内菜单 */
  const gmBox = $('gmenu');
  gmBox.querySelectorAll('input[data-music]').forEach(function (el) {
    el.addEventListener('change', function () { saveSettingsFrom(gmBox); syncSettingsUI(gmBox); });
  });
  gmBox.querySelector('input[data-vol]').addEventListener('input', function () { saveSettingsFrom(gmBox); });
  gmBox.querySelectorAll('button[data-theme]').forEach(function (el) {
    el.addEventListener('click', function () {
      gmBox.querySelectorAll('button[data-theme]').forEach(function (b) { b.classList.remove('selected'); });
      el.classList.add('selected');
      saveSettingsFrom(gmBox);
    });
  });
  gmBox.querySelector('input[data-sfx]').addEventListener('change', function () { saveSettingsFrom(gmBox); });
  $('btn-gm-exit').addEventListener('click', function () {
    if (G) {
      persist();
      G = null;
    }
    cancelDlg();
    closeGmenu();
    AudioMgr.sfx('tap');
    toast('已保存,欢迎再回来');
    show('scr-home');
  });
  $('btn-gm-close').addEventListener('click', function () { closeGmenu(); });

  /* 结局 */
  $('btn-end-home').addEventListener('click', function () {
    G = null;
    cancelDlg();
    show('scr-home');
  });

  applySettings();
  show('scr-home');
}

window.addEventListener('DOMContentLoaded', init);

/* ---------- 更新日志 ---------- */
function renderChangelog() {
  const box = $('changelog-list');
  if (!box) return;
  let html = '';
  const list = CFG.CHANGELOG || [];
  for (let i = list.length - 1; i >= 0; i--) {
    html += '<div class="log-row">' +
      '<div class="log-head"><b>' + list[i].v + '</b><span class="log-time">' + list[i].t + '</span></div>' +
      '<div class="log-text">' + list[i].c + '</div>' +
      '</div>';
  }
  box.innerHTML = html;
}
