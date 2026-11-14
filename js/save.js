/* ============================================================
 * 逃离遵化益众 - 本地存档与设置(localStorage)
 * ============================================================ */
'use strict';

const Store = (function () {
  const SKEY = 'yz_saves_v1';
  const CKEY = 'yz_settings_v1';
  let mem = {};

  function get(key, def) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : def;
    } catch (e) {
      return mem[key] !== undefined ? mem[key] : def;
    }
  }
  function set(key, val) {
    mem[key] = val;
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* 空间不足等,忽略 */ }
  }

  return {
    saves: function () { return get(SKEY, []); },
    saveAll: function (arr) { set(SKEY, arr); },
    upsert: function (s) {
      s.updatedAt = Date.now();
      const arr = get(SKEY, []);
      const i = arr.findIndex(function (x) { return x.id === s.id; });
      if (i >= 0) arr[i] = s; else arr.push(s);
      set(SKEY, arr);
    },
    remove: function (id) {
      set(SKEY, get(SKEY, []).filter(function (x) { return x.id !== id; }));
    },
    settings: function () {
      return get(CKEY, { music: 'morning', vol: 70, theme: 'dark', sfx: true });
    },
    setSettings: function (s) { set(CKEY, s); }
  };
})();
