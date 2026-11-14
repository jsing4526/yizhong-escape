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
      return { type: 'classroom', name: G.cls + '班 门口' };
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

function barFill(kind, v) {
  $(kind + '-fill').style.width = clamp(v, 0, 100) + '%';
  $(kind + '-num').textContent = Math.round(v);
}

function updateHUD() {
  if (!G) return;
  $('hud-name').textContent = G.name;
  $('hud-form').textContent = G.form;
  $('hud-form').style.color = FORM_STYLE[G.form] || '#e6edf3';
  $('hud-cls').textContent = G.cls + '班';
  barFill('hp', G.hp); barFill('sp', G.sp); barFill('san', G.san);
  const info = locInfo(G.floor, G.nodeId);
  $('hud-loc').textContent = CFG.floorNames[G.floor] + ' · ' + info.name;
  $('game-floor').textContent = CFG.floorNames[G.floor];
  $('game-clock').textContent = fmtGameTime(gameNow());
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
      S('circle', { cx: n.x, cy: n.y, r: 15, fill: 'transparent', cursor: 'pointer' }, ng)
        .addEventListener('click', (function (nid, nf) {
          return function () { onNodeTap(nid, nf); };
        })(n.id, f));
    }
    if (isCur) {
      S('circle', { cx: n.x, cy: n.y, r: 7, fill: '#ffe066', stroke: '#fff', 'stroke-width': 1.5, class: 'pl-pulse' }, ng);
    } else if (nb) {
      S('circle', { cx: n.x, cy: n.y, r: 6, fill: '#57e07a', stroke: '#1a2c20', 'stroke-width': 1 }, ng);
    } else {
      S('circle', { cx: n.x, cy: n.y, r: 4, fill: '#4a5a6a', opacity: 0.8 }, ng);
    }
    if (isStair && !isCur) {
      S('circle', { cx: n.x, cy: n.y, r: 3, fill: '#1a2c33', opacity: 0.9 }, ng);
    }
    if (n.id === 'GATE') {
      S('text', { x: n.x, y: n.y - 10, 'text-anchor': 'middle', fill: '#ffd97a', 'font-size': 8 }, ng).textContent = '大门';
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
    S('path', { d: segs[i], stroke: fc, 'stroke-width': 9, 'stroke-linecap': 'round', opacity: 0.85 }, g);
  }
  if (f === 1) {
    S('path', { d: 'M185 730 L330 630', stroke: fc, 'stroke-width': 7, 'stroke-linecap': 'round', opacity: 0.8, fill: 'none' }, g);
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
    S('text', { x: 257, y: 700, 'text-anchor': 'middle', fill: '#7ad7ff', 'font-size': 7 }, g).textContent = '连廊';
  }

  if (f === 1) {
    S('path', { d: 'M185 525 L258 470', stroke: fc, 'stroke-width': 7, 'stroke-linecap': 'round', opacity: 0.8, fill: 'none' }, g);
    S('text', { x: 205, y: 508, 'text-anchor': 'middle', fill: '#7ad7ff', 'font-size': 7 }, g).textContent = '侧门';
    S('path', { d: 'M308 470 L330 630', stroke: fc, 'stroke-width': 7, 'stroke-linecap': 'round', opacity: 0.8, fill: 'none' }, g);
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
      S('path', { d: segs[i], stroke: fc, 'stroke-width': 11, 'stroke-linecap': 'round', opacity: 0.9 }, g);
    }
    if (f === 1) {
      S('path', { d: 'M185 730 L240 665', stroke: fc, 'stroke-width': 9, 'stroke-linecap': 'round', opacity: 0.85, fill: 'none' }, g);
      S('text', { x: 206, y: 660, 'text-anchor': 'middle', fill: '#7ad7ff', 'font-size': 10 }, g).textContent = '连廊→横段楼';
      S('path', { d: 'M185 525 L240 525', stroke: fc, 'stroke-width': 9, 'stroke-linecap': 'round', opacity: 0.85, fill: 'none' }, g);
      S('text', { x: 208, y: 510, 'text-anchor': 'middle', fill: '#7ad7ff', 'font-size': 10 }, g).textContent = '操场侧门→';
    }
    drawRooms(g, f, CFG.mainSlots());
    drawNodes(g, f, CFG.eightNodes, true);
  } else if (which === 'hbld') {
    S('path', { d: hbldPath(f === 1), fill: '#22303f', stroke: '#47617a', 'stroke-width': 3 }, g);
    S('text', { x: 310, y: 545, 'text-anchor': 'middle', fill: '#9db6cc', 'font-size': 18, 'font-weight': 'bold' }, g).textContent = '横段教学楼';
    S('text', { x: 310, y: 565, 'text-anchor': 'middle', fill: fc, 'font-size': 12 }, g).textContent = CFG.floorNames[f] + ' · ' + d.h.tag;
    S('path', { d: 'M250 630 L383 630', stroke: fc, 'stroke-width': 13, 'stroke-linecap': 'round', opacity: 0.9 }, g);
    if (f === 1) {
      S('path', { d: 'M330 630 L185 730', stroke: fc, 'stroke-width': 9, 'stroke-linecap': 'round', opacity: 0.85, fill: 'none' }, g);
      S('text', { x: 240, y: 700, 'text-anchor': 'middle', fill: '#7ad7ff', 'font-size': 10 }, g).textContent = '←连廊·8字楼';
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
      if (a && b) S('path', { d: 'M' + a.x + ' ' + a.y + ' L' + b.x + ' ' + b.y, stroke: fc, 'stroke-width': 4, 'stroke-linecap': 'round', opacity: 0.5, fill: 'none' }, g);
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
function dirCand(dxDir, dyDir) {
  const nbs = neighborsOf(G.floor, G.nodeId).filter(function (n) { return n.floor === G.floor; });
  const nd = nodeXY(G.floor, G.nodeId);
  let best = null, bestVal = 0;
  for (let i = 0; i < nbs.length; i++) {
    const p = nodeXY(G.floor, nbs[i].id);
    if (!p) continue;
    const dx = p.x - nd.x, dy = p.y - nd.y;
    let ok = false;
    if (dxDir < 0 && dx < -8 && Math.abs(dx) > Math.abs(dy)) ok = true;
    else if (dxDir > 0 && dx > 8 && Math.abs(dx) > Math.abs(dy)) ok = true;
    else if (dyDir < 0 && dy < -8 && Math.abs(dy) >= Math.abs(dx)) ok = true;
    else if (dyDir > 0 && dy > 8 && Math.abs(dy) >= Math.abs(dx)) ok = true;
    if (!ok) continue;
    const val = dxDir !== 0 ? Math.abs(dx) : Math.abs(dy);
    if (val > bestVal) { bestVal = val; best = nbs[i]; }
  }
  return best;
}
/* ---------- 行为面板(休息/冥想,30s冷却) ---------- */
function cdLeft(key) {
  if (!G) return 0;
  return Math.max(0, (G[key] || 0) - Date.now());
}
function syncActUI() {
  const rest = cdLeft('cdRest'), med = cdLeft('cdMed');
  const br = $('btn-act-rest'), bm = $('btn-act-med');
  if (!br || !bm) return;
  br.disabled = rest > 0;
  bm.disabled = med > 0;
  br.textContent = rest > 0 ? '休息 ' + Math.ceil(rest / 1000) + 's' : '休息 +10精力';
  bm.textContent = med > 0 ? '冥想 ' + Math.ceil(med / 1000) + 's' : '冥想 +5SAN';
}
function openAct() {
  syncActUI();
  $('act-box').classList.remove('hidden');
  AudioMgr.sfx('open');
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
  if (G.sp <= 0) { toast('精力耗尽,走不动了。点右上角「行为」休息一下'); return; }
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

  if (id === 'GATE') {
    if (G.won) { toast('你已经通关了!点右下角「冲出去」即可离开'); }
    else if (!dlgBusy) runEvent(CFG.EVENTS.gate);
    return;
  }
  if (G.flags.spawn && !dlgBusy && Math.random() < 0.22) {
    runEvent(CFG.EVENTS.random[Math.floor(Math.random() * CFG.EVENTS.random.length)]);
  }
}

/* ---------- 进入教室 ---------- */
function enterRoom() {
  if (dlgBusy || !G || G.inRoom) return;
  const nr = nearRoom(G.floor, G.nodeId);
  if (!nr) return;
  if (G.sp <= 0) { toast('精力耗尽,先休息一下吧'); return; }
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
  if (fx.hp) G.hp = clamp(G.hp + fx.hp, 0, 100);
  if (fx.sp) G.sp = clamp(G.sp + fx.sp, 0, 100);
  if (fx.san) G.san = clamp(G.san + fx.san, 0, 100);
  if (fx.flag) G.flags[fx.flag] = true;
  if (fx.next === 'win') G.won = true;
  G.form = calcForm();
  updateHUD();
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
function runEvent(evt) {
  if (dlgBusy || !G) return;
  if (evt.flag && G.flags[evt.flag]) return;
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
    }
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
  if (G.san <= 0) { G.dead = true; G.deadReason = 'san'; persist(); showEnd(false); return; }
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
  G.inRoom = false;
  mapOpen = false;
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

  /* 行为面板 */
  $('btn-act-close').addEventListener('click', function () {
    AudioMgr.sfx('tap');
    $('act-box').classList.add('hidden');
  });
  $('btn-act-rest').addEventListener('click', function () {
    if (!G || cdLeft('cdRest') > 0) return;
    AudioMgr.sfx('move');
    const before = G.sp;
    applyFx({ sp: 10 });
    G.cdRest = Date.now() + 30000;
    toast('休息:精力+' + (G.sp - before));
    persist();
    syncActUI();
  });
  $('btn-act-med').addEventListener('click', function () {
    if (!G || cdLeft('cdMed') > 0) return;
    AudioMgr.sfx('event');
    const before = G.san;
    applyFx({ san: 5 });
    G.cdMed = Date.now() + 30000;
    toast('冥想:SAN+' + (G.san - before));
    persist();
    syncActUI();
  });

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
