/* Sabbir — Digital Projects & Web Apps Hub — front-end logic.
 * Reads window.HUB_CONFIG (see ../config.js). All spreadsheet content is inserted with textContent / DOM APIs
 * (never innerHTML) and every URL is re-validated here even though the server validated it first. */
(function () {
  'use strict';

  var CFG = window.HUB_CONFIG || {};
  var API_URL = String(CFG.API_URL || '').trim();
  var CACHE_KEY = 'hub_bootstrap_v1';
  var CACHE_MAX_AGE_MS = 24 * 3600 * 1000;
  var STATUS_ORDER = ['live', 'beta', 'unverified', 'in_development', 'temporarily_unavailable', 'archived'];
  var SOCIAL_ORDER = ['youtube', 'facebook', 'instagram', 'linkedin', 'github', 'x', 'whatsapp'];
  var SOCIAL_LABEL = { youtube: 'YouTube', facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', github: 'GitHub', x: 'X', whatsapp: 'WhatsApp' };

  var state = { data: null, config: {}, projects: [], categories: [], filters: { q: '', category: '', type: '', tech: '', status: '', sort: 'featured' },
    shown: 0, pageSize: 12, opener: null, openSlug: '', loadedFresh: false, deferredInstall: null, dialogOpen: false };

  function $(id) { return document.getElementById(id); }

  /* ------------------------------ helpers ------------------------------ */
  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (v === false || v === null || v === undefined) { return; }
      if (k === 'class') { node.className = v; }
      else if (k === 'text') { node.textContent = v; }
      else { node.setAttribute(k, v === true ? '' : String(v)); }
    });
    (kids || []).forEach(function (c) { if (c) { node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); } });
    return node;
  }
  function clear(node) { while (node && node.firstChild) { node.removeChild(node.firstChild); } }
  function isHttp(u) { return typeof u === 'string' && /^https?:\/\/[^\s<>"']+$/i.test(u) && u.length < 2000; }
  function isHttps(u) { return isHttp(u) && /^https:/i.test(u); }
  function str(v) { return (v === undefined || v === null) ? '' : String(v); }
  function arr(v) { return Array.isArray(v) ? v.map(str).filter(Boolean) : []; }
  function paras(parent, text) {
    str(text).split(/\n{2,}/).forEach(function (chunk) { chunk = chunk.trim(); if (chunk) { parent.appendChild(el('p', { class: 'hub-pre', text: chunk })); } });
  }
  function fmtDate(iso) {
    if (!iso) { return ''; }
    var d = new Date(iso); if (isNaN(d.getTime())) { return ''; }
    try { return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); } catch (e) { return d.toISOString().slice(0, 10); }
  }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function debounce(fn, ms) { var t; return function () { var a = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(null, a); }, ms); }; }
  function storageGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function storageSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* private mode / blocked */ } }

  /* ------------------------------ network ------------------------------ */
  function apiUrl(params) { return API_URL + (API_URL.indexOf('?') === -1 ? '?' : '&') + params; }

  function viaFetch(url) {
    return new Promise(function (resolve, reject) {
      if (typeof window.fetch !== 'function') { reject(new Error('no fetch')); return; }
      var ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) { ctrl.abort(); } reject(new Error('timeout')); }, 10000);
      window.fetch(url, { method: 'GET', credentials: 'omit', redirect: 'follow', signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { if (!r.ok) { throw new Error('http ' + r.status); } return r.json(); })
        .then(function (j) { clearTimeout(timer); resolve(j); })
        .catch(function (e) { clearTimeout(timer); reject(e); });
    });
  }
  var jsonpCount = 0;
  function viaJsonp(url) {
    return new Promise(function (resolve, reject) {
      var name = '__hubcb' + (++jsonpCount) + '_' + Date.now().toString(36);
      var s = document.createElement('script'); var done = false;
      var timer = setTimeout(function () { if (!done) { fin(); reject(new Error('timeout')); } }, 10000);
      function fin() { done = true; clearTimeout(timer); try { delete window[name]; } catch (e) { window[name] = undefined; } if (s.parentNode) { s.parentNode.removeChild(s); } }
      window[name] = function (d) { if (!done) { fin(); resolve(d); } };
      s.onerror = function () { if (!done) { fin(); reject(new Error('script')); } };
      s.async = true; s.src = url + '&callback=' + name; document.head.appendChild(s);
    });
  }
  /* Primary: fetch (simple GET => no CORS pre-flight). Fallback: JSONP (public read-only data only). */
  function fetchJson(params) { var u = apiUrl(params); return viaFetch(u).catch(function () { return viaJsonp(u); }); }

  function readCache() {
    var raw = storageGet(CACHE_KEY); if (!raw) { return null; }
    try { var o = JSON.parse(raw); if (o && o.data && o.t && Date.now() - o.t < CACHE_MAX_AGE_MS) { return o; } } catch (e) { /* ignore */ }
    return null;
  }
  function writeCache(data) { storageSet(CACHE_KEY, JSON.stringify({ t: Date.now(), data: data })); }

  /* ------------------------------ data ------------------------------ */
  function normalize(p) {
    if (!p || typeof p !== 'object' || !p.slug || !p.name) { return null; }
    var out = {
      id: str(p.id), slug: str(p.slug), name: str(p.name), short_description: str(p.short_description), full_description: str(p.full_description),
      category_id: str(p.category_id), category: str(p.category) || 'Other', project_type: str(p.project_type),
      technologies: arr(p.technologies), keywords: arr(p.keywords), features: arr(p.features), screenshots: arr(p.screenshots).filter(isHttps),
      thumbnail_url: isHttps(p.thumbnail_url) ? p.thumbnail_url : '', logo_url: isHttps(p.logo_url) ? p.logo_url : '',
      live_url: isHttp(p.live_url) ? p.live_url : '', details_url: isHttp(p.details_url) ? p.details_url : '', documentation_url: isHttp(p.documentation_url) ? p.documentation_url : '',
      status: str(p.status) || 'in_development', public_status: str(p.public_status) || str(p.status) || 'in_development', status_label: str(p.status_label),
      featured: p.featured === true, display_order: parseInt(p.display_order, 10), target_audience: str(p.target_audience), instructions: str(p.instructions),
      changelog: str(p.changelog), created_at: str(p.created_at), updated_at: str(p.updated_at), last_verified_at: str(p.last_verified_at)
    };
    if (isNaN(out.display_order)) { out.display_order = 1000; }
    if (!out.status_label) { out.status_label = out.public_status.replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }); }
    out._hay = [out.name, out.short_description, out.full_description, out.category, out.project_type, out.technologies.join(' '), out.keywords.join(' ')].join(' ').toLowerCase();
    out._updated = Date.parse(out.updated_at || out.created_at) || 0;
    out._created = Date.parse(out.created_at || out.updated_at) || 0;
    return out;
  }

  function launchInfo(p) {
    if (p.live_url && (p.status === 'live' || p.status === 'beta')) { return { enabled: true, url: p.live_url, label: 'Open Project' }; }
    var reason, label = 'Unavailable';
    if (p.status === 'archived') { reason = 'This project has been archived and is no longer maintained.'; }
    else if (p.status === 'temporarily_unavailable') { reason = 'This project is temporarily unavailable. Please check back later.'; }
    else if (p.status === 'in_development') { reason = 'This project is still in development and is not open to the public yet.'; label = 'Coming soon'; }
    else { reason = 'The link for this project has not been published yet.'; }
    return { enabled: false, reason: reason, label: label };
  }

  /* ------------------------------ theme + text ------------------------------ */
  function hexMix(hex, withHex, t) {
    function c(h, i) { return parseInt(h.slice(1 + i * 2, 3 + i * 2), 16); }
    var out = '#'; for (var i = 0; i < 3; i++) { var v = Math.round(c(hex, i) * (1 - t) + c(withHex, i) * t); out += ('0' + v.toString(16)).slice(-2); }
    return out;
  }
  function lum(hex) {
    var c = [1, 3, 5].map(function (i) { var v = parseInt(hex.substr(i, 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  /* Colours are owner-configurable; make sure text/buttons stay readable (WCAG AA 4.5:1 against white). */
  function darkenForWhite(hex, min) {
    var h = hex, n = 0;
    while (1.05 / (lum(h) + 0.05) < min && n < 25) { h = hexMix(h, '#000000', 0.08); n++; }
    return h;
  }
  function applyTheme(cfg) {
    var root = document.documentElement.style;
    var map = { theme_primary: '--hub-primary', theme_accent: '--hub-accent', theme_background: '--hub-bg', theme_text: '--hub-text', theme_border: '--hub-border' };
    var needsContrast = { theme_primary: 1, theme_accent: 1, theme_text: 1 };
    var accent = '';
    Object.keys(map).forEach(function (k) {
      var v = str(cfg[k]); if (!/^#[0-9a-fA-F]{6}$/.test(v)) { return; }
      if (needsContrast[k]) { v = darkenForWhite(v, 4.5); }
      if (k === 'theme_accent') { accent = v; }
      root.setProperty(map[k], v);
    });
    if (accent) { root.setProperty('--hub-accent-soft', hexMix(accent, '#ffffff', 0.9)); }
  }
  function setText(id, v) { var n = $(id); if (n && v) { n.textContent = v; } }
  function setMeta(sel, v) { var m = document.querySelector(sel); if (m && v) { m.setAttribute('content', v); } }

  var ICONS = {
    youtube: [['rect', { x: 2, y: 5, width: 20, height: 14, rx: 4 }], ['path', { d: 'M10 9.5v5l4.5-2.5z' }]],
    facebook: [['path', { d: 'M15.5 3.5H13a3.5 3.5 0 0 0-3.5 3.5v3H7v3.5h2.5V21H13v-7.5h2.7l.8-3.5H13V7.2c0-.4.3-.7.7-.7h1.8z' }]],
    instagram: [['rect', { x: 3, y: 3, width: 18, height: 18, rx: 5 }], ['circle', { cx: 12, cy: 12, r: 4 }], ['circle', { cx: 17.5, cy: 6.5, r: 0.7 }]],
    linkedin: [['rect', { x: 3, y: 3, width: 18, height: 18, rx: 3 }], ['path', { d: 'M8 10.5V16M8 7.5v.01M12 16v-5.5M12 12.5c0-1.4 1-2 2.2-2 1.4 0 1.8 1 1.8 2.3V16' }]],
    github: [['path', { d: 'M8 8l-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14' }]],
    x: [['path', { d: 'M5 5l14 14M19 5L5 19' }]],
    whatsapp: [['path', { d: 'M3.5 20.5l1.2-4.2A8.5 8.5 0 1 1 8 19.3z' }], ['path', { d: 'M9 9.5c.3 2 2.5 4.2 4.5 4.5l1.3-1.3-1.8-1-.8.7c-.8-.4-1.5-1.1-1.9-1.9l.7-.8-1-1.8z' }]],
    link: [['path', { d: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1' }]]
  };
  function icon(name) {
    var ns = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
    (ICONS[name] || ICONS.link).forEach(function (part) {
      var n = document.createElementNS(ns, part[0]);
      Object.keys(part[1]).forEach(function (k) { n.setAttribute(k, part[1][k]); });
      svg.appendChild(n);
    });
    return svg;
  }

  function applyBranding(cfg) {
    var brand = str(cfg.brand_name) || 'Sabbir';
    setText('hub-brand-name', brand); setText('hub-footer-brand', brand);
    var logo = isHttps(cfg.logo_url) ? cfg.logo_url : (isHttps(CFG.LOGO_URL) ? CFG.LOGO_URL : '');
    var img = $('hub-logo'), fb = $('hub-logo-fb');
    if (logo) {
      img.onerror = function () { img.hidden = true; fb.hidden = false; };
      img.src = logo; img.alt = ''; img.hidden = false; fb.hidden = true;
    } else { img.hidden = true; fb.hidden = false; }
    fb.textContent = brand.charAt(0).toUpperCase() || 'S';
    if (cfg.site_title) { document.title = cfg.site_title; setMeta('meta[property="og:title"]', cfg.site_title); }
    if (cfg.tagline) { setMeta('meta[name="description"]', cfg.tagline); setMeta('meta[property="og:description"]', cfg.tagline); }
    setText('hub-hero-title', cfg.hero_title); setText('hub-hero-sub', cfg.hero_subtitle);
    setText('hub-about-title', cfg.about_heading);
    clear($('hub-about-intro')); paras($('hub-about-intro'), cfg.about_intro);
    clear($('hub-about-philosophy')); paras($('hub-about-philosophy'), cfg.about_philosophy);
    clear($('hub-about-purpose')); paras($('hub-about-purpose'), cfg.about_purpose);
    // technologies
    var tl = $('hub-tech-list'); clear(tl);
    str(cfg.about_technologies).split(/,|\band\b/i).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (t) { tl.appendChild(el('li', { text: t })); });
    // reference site
    var ref = isHttps(cfg.reference_site_url) ? cfg.reference_site_url : '';
    ['hub-ref-link', 'hub-footer-ref'].forEach(function (id) {
      var a = $(id); if (!a) { return; }
      if (ref) { a.href = ref; a.hidden = false; if (id === 'hub-ref-link') { a.textContent = str(cfg.reference_site_label) || 'Visit my main website'; } else { a.textContent = 'Reference website'; } }
      else { a.hidden = true; }
    });
    // contact (published only when the owner configured it)
    clear($('hub-contact-note')); $('hub-contact-note').textContent = str(cfg.contact_note);
    var mail = str(cfg.contact_email);
    var okMail = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(mail);
    $('hub-contact-email-wrap').hidden = !okMail; $('hub-contact-none').hidden = okMail;
    if (okMail) { $('hub-contact-email').href = 'mailto:' + mail; $('hub-contact-email').textContent = 'Email ' + mail; }
    // footer
    $('hub-footer-text').textContent = str(cfg.footer_text);
    $('hub-copy').textContent = '© ' + new Date().getFullYear() + ' ' + brand + '. All rights reserved.';
    renderSocial(cfg, brand);
  }

  function renderSocial(cfg, brand) {
    var found = [];
    Object.keys(cfg).forEach(function (k) {
      var m = /^social_([a-z0-9_]+)$/.exec(k);
      if (m && isHttps(cfg[k])) { found.push({ key: m[1], url: cfg[k] }); }
    });
    found.sort(function (a, b) {
      var ia = SOCIAL_ORDER.indexOf(a.key), ib = SOCIAL_ORDER.indexOf(b.key);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.key.localeCompare(b.key);
    });
    ['hub-social-top', 'hub-social-foot'].forEach(function (id) {
      var ul = $(id); clear(ul);
      found.forEach(function (s) {
        var label = SOCIAL_LABEL[s.key] || (s.key.charAt(0).toUpperCase() + s.key.slice(1));
        var a = el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': brand + ' on ' + label + ' (opens in a new tab)', title: label });
        a.appendChild(icon(s.key)); ul.appendChild(el('li', {}, [a]));
      });
      ul.hidden = found.length === 0;
    });
  }

  /* ------------------------------ filters ------------------------------ */
  function fillSelect(id, label, items) {
    var sel = $(id); var cur = sel.value; clear(sel);
    sel.appendChild(el('option', { value: '', text: label }));
    items.forEach(function (it) { sel.appendChild(el('option', { value: it.value, text: it.text })); });
    var still = items.some(function (it) { return it.value === cur; });
    sel.value = still ? cur : '';
  }
  function populateFilters() {
    var cats = state.categories.map(function (c) { return { value: c.id, text: c.name }; });
    var hasOther = state.projects.some(function (p) { return !state.categories.some(function (c) { return c.id === p.category_id; }); });
    if (hasOther) { cats.push({ value: '__other', text: 'Other' }); }
    fillSelect('hub-f-category', 'All categories', cats);
    var types = {}, techs = {}, stats = {};
    state.projects.forEach(function (p) {
      if (p.project_type) { types[p.project_type] = 1; }
      p.technologies.forEach(function (t) { techs[t] = 1; });
      stats[p.public_status] = p.status_label;
    });
    function sortedItems(o) { return Object.keys(o).sort(function (a, b) { return a.toLowerCase() < b.toLowerCase() ? -1 : 1; }).map(function (k) { return { value: k, text: k }; }); }
    fillSelect('hub-f-type', 'All types', sortedItems(types));
    fillSelect('hub-f-tech', 'All technologies', sortedItems(techs));
    var statItems = Object.keys(stats).sort(function (a, b) { return STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b); }).map(function (k) { return { value: k, text: stats[k] }; });
    fillSelect('hub-f-status', 'All statuses', statItems);
    syncFiltersFromControls();
  }
  function syncFiltersFromControls() {
    var f = state.filters;
    f.q = $('hub-q').value.trim().toLowerCase(); f.category = $('hub-f-category').value; f.type = $('hub-f-type').value;
    f.tech = $('hub-f-tech').value; f.status = $('hub-f-status').value; f.sort = $('hub-sort').value || 'featured';
  }
  function matchesFilters(p, terms) {
    var f = state.filters;
    if (f.category) {
      if (f.category === '__other') { if (state.categories.some(function (c) { return c.id === p.category_id; })) { return false; } }
      else if (p.category_id !== f.category) { return false; }
    }
    if (f.type && p.project_type !== f.type) { return false; }
    if (f.tech && p.technologies.indexOf(f.tech) === -1) { return false; }
    if (f.status) { if (p.public_status !== f.status) { return false; } }
    else if (p.status === 'archived') { return false; }       // archived projects only appear when asked for
    for (var i = 0; i < terms.length; i++) { if (p._hay.indexOf(terms[i]) === -1) { return false; } }
    return true;
  }
  function sortProjects(list) {
    var mode = state.filters.sort;
    var byOrder = function (a, b) { return (a.display_order - b.display_order) || a.name.localeCompare(b.name); };
    list.sort(function (a, b) {
      if (mode === 'newest') { return (b._updated - a._updated) || byOrder(a, b); }
      if (mode === 'oldest') { return (a._created - b._created) || byOrder(a, b); }
      if (mode === 'az') { return a.name.localeCompare(b.name); }
      return ((b.featured ? 1 : 0) - (a.featured ? 1 : 0)) || byOrder(a, b);
    });
    return list;
  }
  function currentMatches() {
    var terms = state.filters.q ? state.filters.q.split(/\s+/).filter(Boolean) : [];
    return sortProjects(state.projects.filter(function (p) { return matchesFilters(p, terms); }));
  }
  function anyFilter() {
    var f = state.filters; return !!(f.q || f.category || f.type || f.tech || f.status || f.sort !== 'featured');
  }

  /* ------------------------------ rendering ------------------------------ */
  function mediaNode(p) {
    var media = el('div', { class: 'hub-card-media' });
    var initial = el('span', { class: 'hub-card-initial', 'aria-hidden': 'true', text: p.name.charAt(0).toUpperCase() });
    var src = p.thumbnail_url || p.logo_url;
    if (src) {
      var img = el('img', { src: src, alt: p.name + ' thumbnail', loading: 'lazy', decoding: 'async', width: '640', height: '360', referrerpolicy: 'no-referrer' });
      img.addEventListener('error', function () { if (img.parentNode) { img.parentNode.removeChild(img); } media.insertBefore(initial, media.firstChild); });
      media.appendChild(img);
    } else { media.appendChild(initial); }
    var badges = el('div', { class: 'hub-card-badges' }, [el('span', { class: 'hub-badge hub-badge-' + p.public_status, text: p.status_label })]);
    if (p.featured) { badges.appendChild(el('span', { class: 'hub-badge hub-badge-featured', text: '★ Featured' })); }
    media.appendChild(badges);
    return media;
  }
  function cardNode(p) {
    var info = launchInfo(p);
    var chips = el('ul', { class: 'hub-chips', 'aria-label': 'Technologies' });
    p.technologies.slice(0, 4).forEach(function (t) { chips.appendChild(el('li', { text: t })); });
    if (p.technologies.length > 4) { chips.appendChild(el('li', { text: '+' + (p.technologies.length - 4) })); }
    var actions = el('div', { class: 'hub-card-actions' });
    if (info.enabled) {
      actions.appendChild(el('a', { class: 'hub-btn hub-btn-primary', href: info.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': 'Open ' + p.name + ' (opens in a new tab)', text: 'Open Project' }));
    } else {
      actions.appendChild(el('button', { type: 'button', class: 'hub-btn hub-btn-ghost', 'data-action': 'details', 'data-slug': p.slug, 'aria-disabled': 'true', 'aria-label': p.name + ': ' + info.label + '. Select for details.', text: info.label }));
    }
    actions.appendChild(el('button', { type: 'button', class: 'hub-btn hub-btn-ghost', 'data-action': 'details', 'data-slug': p.slug, 'aria-label': 'View details of ' + p.name, text: 'View Details' }));
    var body = el('div', { class: 'hub-card-body' }, [
      el('p', { class: 'hub-card-cat', text: p.category }),
      el('h3', { text: p.name }),
      el('p', { class: 'hub-card-desc', text: p.short_description }),
      p.technologies.length ? chips : null,
      p.updated_at && fmtDate(p.updated_at) ? el('p', { class: 'hub-card-meta', text: 'Updated ' + fmtDate(p.updated_at) }) : null,
      actions
    ]);
    return el('article', { class: 'hub-card' }, [mediaNode(p), body]);
  }
  function showSkeleton(n) {
    var g = $('hub-grid'); clear(g); g.setAttribute('aria-busy', 'true');
    for (var i = 0; i < n; i++) { g.appendChild(el('div', { class: 'hub-skel', 'aria-hidden': 'true' })); }
  }
  function renderFeatured() {
    var limit = parseInt(state.config.featured_limit, 10); if (isNaN(limit)) { limit = 3; }
    var list = state.projects.filter(function (p) { return p.featured && p.status !== 'archived'; })
      .sort(function (a, b) { return (a.display_order - b.display_order) || a.name.localeCompare(b.name); }).slice(0, Math.max(0, limit));
    var sec = $('featured'), grid = $('hub-featured-grid'); clear(grid);
    list.forEach(function (p) { grid.appendChild(cardNode(p)); });
    sec.hidden = list.length === 0;
  }
  function renderList(resetShown) {
    var all = currentMatches();
    if (resetShown) { state.shown = state.pageSize; }
    var grid = $('hub-grid'); clear(grid); grid.setAttribute('aria-busy', 'false');
    all.slice(0, state.shown).forEach(function (p) { grid.appendChild(cardNode(p)); });
    var count = $('hub-count');
    if (all.length === 0) { count.textContent = 'No projects found'; }
    else if (state.shown < all.length) { count.textContent = 'Showing ' + state.shown + ' of ' + plural(all.length, 'project', 'projects'); }
    else { count.textContent = plural(all.length, 'project', 'projects') + (anyFilter() ? ' match your search' : ''); }
    $('hub-empty').hidden = all.length !== 0;
    $('hub-more-wrap').hidden = state.shown >= all.length;
  }
  function renderCategories() {
    var ul = $('hub-cats'), fl = $('hub-footer-cats'); clear(ul); clear(fl);
    state.categories.forEach(function (c) {
      var n = state.projects.filter(function (p) { return p.category_id === c.id && p.status !== 'archived'; }).length;
      var btn = el('button', { type: 'button', class: 'hub-cat-btn', 'data-cat': c.id }, [
        el('strong', { text: c.name }), el('span', { text: c.description || '' }), el('span', { text: plural(n, 'project', 'projects') })]);
      ul.appendChild(el('li', {}, [btn]));
      fl.appendChild(el('li', {}, [el('button', { type: 'button', class: 'hub-linkbtn', 'data-cat': c.id, text: c.name })]));
    });
    if (!state.categories.length) { ul.appendChild(el('li', { class: 'hub-muted', text: 'Categories will appear here soon.' })); }
  }
  function renderStat() {
    var n = state.projects.filter(function (p) { return p.status !== 'archived'; }).length;
    $('hub-hero-stat').textContent = n ? plural(n, 'project', 'projects') + ' across ' + plural(state.categories.length, 'category', 'categories') : '';
  }

  /* ------------------------------ dialog ------------------------------ */
  function dlg() { return $('hub-dialog'); }
  function openDialog(title, bodyNodes, footNodes, opener) {
    var d = dlg();
    if (!state.dialogOpen) { state.opener = opener || document.activeElement; }
    $('hub-dialog-title').textContent = title;
    var body = $('hub-dialog-body'), foot = $('hub-dialog-foot'); clear(body); clear(foot);
    bodyNodes.forEach(function (n) { if (n) { body.appendChild(n); } });
    (footNodes || []).forEach(function (n) { if (n) { foot.appendChild(n); } });
    foot.hidden = !foot.firstChild;
    if (!d.open) { if (typeof d.showModal === 'function') { d.showModal(); } else { d.setAttribute('open', ''); } }
    state.dialogOpen = true; document.body.style.overflow = 'hidden'; body.scrollTop = 0;
    $('hub-dialog-close').focus();
  }
  function closeDialog() {
    var d = dlg();
    if (typeof d.close === 'function' && d.open) { d.close(); } else { d.removeAttribute('open'); onDialogClosed(); }
  }
  function onDialogClosed() {
    if (!state.dialogOpen) { return; }
    state.dialogOpen = false; document.body.style.overflow = '';
    if (state.openSlug) { state.openSlug = ''; if (/^#p=/.test(location.hash)) { try { history.replaceState(null, '', location.pathname + location.search + '#projects'); } catch (e) { /* ignore */ } } }
    var o = state.opener; state.opener = null;
    if (o && typeof o.focus === 'function' && document.contains(o)) { try { o.focus(); } catch (e) { /* ignore */ } }
  }
  function note(text, bad) { return el('p', { class: 'hub-note' + (bad ? ' hub-note-bad' : ''), role: 'note', text: text }); }
  function section(title, children) { return [el('h3', { text: title })].concat(children); }
  function bulletList(items) { return el('ul', { class: 'hub-bul' }, items.map(function (t) { return el('li', { text: t }); })); }

  function openDetails(p, opener) {
    var info = launchInfo(p);
    var body = [];
    if (!info.enabled) { body.push(note(info.reason, p.status === 'temporarily_unavailable' || p.status === 'archived')); }
    else if (p.public_status === 'unverified') { body.push(note('We could not recently confirm that this link is working. You can still try to open it.')); }
    var meta = el('ul', { class: 'hub-chips', 'aria-label': 'Project facts' }, [
      el('li', { text: p.status_label }), el('li', { text: p.category }), p.project_type ? el('li', { text: p.project_type }) : null, p.featured ? el('li', { text: '★ Featured' }) : null]);
    body.push(meta);
    body = body.concat(section('Overview', [el('div', {}, [])]));
    var ov = body[body.length - 1]; paras(ov, p.full_description || p.short_description);
    if (p.screenshots.length) {
      var shots = el('div', { class: 'hub-shots' });
      p.screenshots.forEach(function (u, i) { shots.appendChild(el('img', { src: u, alt: p.name + ' screenshot ' + (i + 1), loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' })); });
      body = body.concat(section('Screenshots', [shots]));
    }
    if (p.features.length) { body = body.concat(section('Main features', [bulletList(p.features)])); }
    if (p.target_audience) { body = body.concat(section('Intended audience', [el('p', { text: p.target_audience })])); }
    if (p.technologies.length) { body = body.concat(section('Technology stack', [el('ul', { class: 'hub-chips' }, p.technologies.map(function (t) { return el('li', { text: t }); }))])); }
    if (p.instructions) { var ins = el('div'); paras(ins, p.instructions); body = body.concat(section('How to use', [ins])); }
    var facts = [];
    if (p.updated_at && fmtDate(p.updated_at)) { facts.push('Last updated: ' + fmtDate(p.updated_at)); }
    if (p.last_verified_at && fmtDate(p.last_verified_at)) { facts.push('Link last checked: ' + fmtDate(p.last_verified_at)); }
    if (facts.length) { body = body.concat(section('Updates', [bulletList(facts)])); }
    if (p.changelog) { var cl = el('div'); paras(cl, p.changelog); body = body.concat(section('Changelog', [cl])); }

    var foot = [];
    foot.push(el('button', { type: 'button', class: 'hub-btn hub-btn-ghost', 'data-action': 'copy', 'data-slug': p.slug, text: 'Copy link' }));
    if (p.documentation_url) { foot.push(el('a', { class: 'hub-btn hub-btn-ghost', href: p.documentation_url, target: '_blank', rel: 'noopener noreferrer', text: 'Documentation' })); }
    if (p.details_url) { foot.push(el('a', { class: 'hub-btn hub-btn-ghost', href: p.details_url, target: '_blank', rel: 'noopener noreferrer', text: 'More information' })); }
    if (info.enabled) { foot.push(el('a', { class: 'hub-btn hub-btn-primary', href: info.url, target: '_blank', rel: 'noopener noreferrer', text: 'Open Project' })); }
    else { foot.push(el('span', { class: 'hub-btn hub-btn-ghost', 'aria-disabled': 'true', text: info.label })); }

    state.openSlug = p.slug;
    openDialog(p.name, body, foot, opener);
    try { history.replaceState(null, '', location.pathname + location.search + '#p=' + encodeURIComponent(p.slug)); } catch (e) { /* ignore */ }
  }
  function findProject(slug) { for (var i = 0; i < state.projects.length; i++) { if (state.projects[i].slug === slug) { return state.projects[i]; } } return null; }

  function openLegal(kind, opener) {
    var title = kind === 'privacy' ? 'Privacy policy' : 'Terms of use';
    var text = kind === 'privacy' ? state.config.privacy_text : state.config.terms_text;
    var body = el('div'); paras(body, text || 'This page has not been written yet.');
    state.openSlug = '';
    openDialog(title, [body], [], opener);
  }
  function openInstallHelp(opener) {
    var body = [
      el('p', { text: 'You can keep this directory one tap away on your phone, tablet or computer.' }),
      el('h3', { text: 'Android (Chrome)' }), bulletList(['Open the ⋮ menu in Chrome.', 'Tap "Add to Home screen" (or "Install app" if you see it).', 'Confirm the name and tap Add.']),
      el('h3', { text: 'iPhone / iPad (Safari)' }), bulletList(['Tap the Share button.', 'Choose "Add to Home Screen".', 'Tap Add.']),
      el('h3', { text: 'Computer (Chrome / Edge)' }), bulletList(['Click the install icon in the address bar, or open the browser menu.', 'Choose "Install" or "Add to desktop / Create shortcut".'])
    ];
    var foot = [];
    if (state.deferredInstall) {
      foot.push(el('button', { type: 'button', class: 'hub-btn hub-btn-primary', 'data-action': 'install', text: 'Install app' }));
    }
    state.openSlug = '';
    openDialog('Add to home screen', body, foot, opener);
  }

  function routeHash(final) {
    var m = /^#p=([^&]+)/.exec(location.hash || ''); if (!m) { return; }
    var slug; try { slug = decodeURIComponent(m[1]); } catch (e) { return; }
    if (state.openSlug === slug && state.dialogOpen) { return; }
    var p = findProject(slug);
    if (p) { openDetails(p, null); }
    else if (final) { state.openSlug = ''; openDialog('Project not found', [note('We could not find that project. It may have been renamed or removed.', true)], [], null); }
  }

  /* ------------------------------ load flow ------------------------------ */
  function showError(msg) {
    $('hub-error-msg').textContent = msg; $('hub-error').hidden = false; $('hub-empty').hidden = true;
    $('hub-more-wrap').hidden = true; clear($('hub-grid')); $('hub-grid').setAttribute('aria-busy', 'false'); $('hub-count').textContent = '';
  }
  function applyData(data) {
    state.data = data; state.config = data.config || {};
    state.categories = (data.categories || []).filter(function (c) { return c && c.id && c.name; });
    state.projects = (data.projects || []).map(normalize).filter(Boolean);
    var ps = parseInt(state.config.page_size, 10); state.pageSize = (ps >= 4 && ps <= 60) ? ps : 12;
    applyTheme(state.config); applyBranding(state.config); populateFilters(); renderCategories(); renderFeatured(); renderStat();
    $('hub-error').hidden = true; renderList(true);
  }
  function load() {
    $('hub-error').hidden = true; $('hub-empty').hidden = true;
    if (!API_URL || /PASTE|YOUR_/i.test(API_URL) || !isHttps(API_URL)) {
      showError('This directory is not connected to its database yet. The owner needs to set the API address (see the setup guide).'); return Promise.resolve();
    }
    var cached = state.data ? null : readCache();
    if (cached) { applyData(cached.data); routeHash(false); } else if (!state.data) { showSkeleton(Math.min(state.pageSize, 6)); }
    return fetchJson('action=bootstrap').then(function (res) {
      if (!res || res.ok !== true || !res.data) { throw new Error('bad response'); }
      writeCache(res.data); state.loadedFresh = true; applyData(res.data); routeHash(true);
    }).catch(function () {
      if (state.data) { $('hub-count').textContent = 'Showing a saved copy — could not refresh right now.'; routeHash(true); }
      else { showError('Please check your internet connection and try again.'); }
    });
  }

  /* ------------------------------ events ------------------------------ */
  function resetFilters() {
    $('hub-q').value = ''; ['hub-f-category', 'hub-f-type', 'hub-f-tech', 'hub-f-status'].forEach(function (id) { $(id).value = ''; });
    $('hub-sort').value = 'featured'; syncFiltersFromControls(); renderList(true);
  }
  function scrollToProjects() { var s = $('projects'); if (s && s.scrollIntoView) { s.scrollIntoView({ behavior: 'auto', block: 'start' }); } }
  function copyLink(slug, btn) {
    var url = location.href.split('#')[0] + '#p=' + encodeURIComponent(slug);
    function ok() { btn.textContent = 'Link copied'; setTimeout(function () { btn.textContent = 'Copy link'; }, 2000); }
    function fail() { btn.textContent = 'Copy failed'; setTimeout(function () { btn.textContent = 'Copy link'; }, 2000); }
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(url).then(ok, fail); return; } } catch (e) { /* fall through */ }
    fail();
  }
  function setMenu(open) {
    var nav = $('hub-nav'), btn = $('hub-menu-btn');
    nav.classList.toggle('is-open', open); btn.setAttribute('aria-expanded', String(open)); btn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }

  function bind() {
    var onFilter = function () { syncFiltersFromControls(); renderList(true); };
    $('hub-q').addEventListener('input', debounce(onFilter, 150));
    ['hub-f-category', 'hub-f-type', 'hub-f-tech', 'hub-f-status', 'hub-sort'].forEach(function (id) { $(id).addEventListener('change', onFilter); });
    $('hub-filters').addEventListener('submit', function (e) { e.preventDefault(); });
    $('hub-clear').addEventListener('click', resetFilters);
    $('hub-empty-clear').addEventListener('click', resetFilters);
    $('hub-retry').addEventListener('click', function () { showSkeleton(6); load(); });
    $('hub-more').addEventListener('click', function () { state.shown += state.pageSize; renderList(false); });

    document.addEventListener('click', function (e) {
      var t = e.target; if (!t || !t.closest) { return; }
      var d = t.closest('[data-action]');
      if (d) {
        var act = d.getAttribute('data-action');
        if (act === 'details') { var p = findProject(d.getAttribute('data-slug')); if (p) { openDetails(p, d); } }
        else if (act === 'copy') { copyLink(d.getAttribute('data-slug'), d); }
        else if (act === 'install' && state.deferredInstall) { state.deferredInstall.prompt(); state.deferredInstall = null; closeDialog(); }
        return;
      }
      var cat = t.closest('[data-cat]');
      if (cat) { $('hub-f-category').value = cat.getAttribute('data-cat'); syncFiltersFromControls(); renderList(true); if (state.dialogOpen) { closeDialog(); } scrollToProjects(); return; }
      var legal = t.closest('[data-legal]');
      if (legal) { openLegal(legal.getAttribute('data-legal'), legal); return; }
      if (t.closest('#hub-install-help')) { openInstallHelp($('hub-install-help')); return; }
      if (t.closest('#hub-nav a')) { setMenu(false); return; }
      if (!t.closest('.hub-header')) { setMenu(false); }
    });
    $('hub-menu-btn').addEventListener('click', function () { setMenu(!$('hub-nav').classList.contains('is-open')); });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') { return; }
      if ($('hub-nav').classList.contains('is-open')) { setMenu(false); $('hub-menu-btn').focus(); }
      else if (state.dialogOpen && typeof dlg().showModal !== 'function') { closeDialog(); }     // browsers without <dialog> modal support
    });
    window.addEventListener('resize', debounce(function () { if (window.innerWidth > 900) { setMenu(false); } }, 150));

    var d = dlg();
    $('hub-dialog-close').addEventListener('click', closeDialog);
    d.addEventListener('click', function (e) { if (e.target === d) { closeDialog(); } });     // click on the backdrop
    d.addEventListener('close', onDialogClosed);
    d.addEventListener('cancel', function () { /* Esc: native dialog closes itself and fires "close" */ });

    window.addEventListener('hashchange', function () { routeHash(true); });
    window.addEventListener('online', function () { if (!$('hub-error').hidden || !state.loadedFresh) { load(); } });
    window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); state.deferredInstall = e; });
  }

  function registerServiceWorker() {
    if (!CFG.SW_URL || !('serviceWorker' in navigator) || !window.isSecureContext) { return; }
    window.addEventListener('load', function () { navigator.serviceWorker.register(CFG.SW_URL).catch(function () { /* optional feature */ }); });
  }

  function init() {
    $('hub-year').textContent = String(new Date().getFullYear());
    bind(); registerServiceWorker(); showSkeleton(6); load();
  }
  window.__HUB__ = { state: state, load: load, normalize: normalize, launchInfo: launchInfo };   // test hook; contains no secrets
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();
