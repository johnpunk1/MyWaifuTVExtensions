class HiAnime {
  constructor() {
    this.type = "anime-streaming";
    this.version = "3.1.0";
    this.baseUrl = "https://hianime.to";
    this._cache = {
      dub:     new Map(), 
      dubEp:   new Map(), 
      search:  new Map(), 
      episodes:new Map(), 
      servers: new Map(), 
      _maxSize: 300,
      _ttl: 8 * 60 * 1000
    };
  }

  getSettings() {
    return {
      episodeServers: ["HD-1", "HD-2", "HD-3"],
      supportsSub: true,
      supportsDub: true,
      supportsHls: true,
      supportsPlayback: true
    };
  }

  stream() { return null; }

  _cacheGet(map, key) {
    const e = map.get(key);
    if (!e) return undefined;
    if (Date.now() - e.t > this._cache._ttl) { map.delete(key); return undefined; }
    return e.v;
  }

  _cacheSet(map, key, value) {
    if (map.size >= this._cache._maxSize) {
      // Evict oldest 30 %
      const entries = [...map.entries()].sort((a, b) => a[1].t - b[1].t);
      const evict = Math.ceil(entries.length * 0.3);
      for (let i = 0; i < evict; i++) map.delete(entries[i][0]);
    }
    map.set(key, { v: value, t: Date.now() });
  }

  _headers(json, refererPath) {
    const ref = this.baseUrl + (refererPath && String(refererPath).startsWith("/") ? refererPath : "/");
    return {
      "Accept": json ? "application/json, text/plain, */*" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "User-Agent": "Mozilla/5.0",
      "Referer": ref,
      "Origin": this.baseUrl,
      "X-Requested-With": "XMLHttpRequest"
    };
  }

  _nativeFetch(url, method, headers, body) {
    try {
      const raw = Native.fetch(String(url), method || "GET", JSON.stringify(headers || {}), body == null ? "" : String(body));
      let j = {};
      try { j = JSON.parse(raw || "{}"); } catch { j = {}; }
      return { ok: !!j.ok, status: Number(j.status || 0), headers: j.headers || {}, body: String(j.body || ""), error: String(j.error || ""), message: String(j.message || "") };
    } catch (e) {
      return { ok: false, status: 0, headers: {}, body: "", error: "NATIVE_FETCH_FAIL", message: "" + e };
    }
  }

  _fetchText(url, headers) {
    return String(this._nativeFetch(url, "GET", headers || {}, "").body || "");
  }

  _fetchJson(url, headers) {
    const txt = this._fetchText(url, headers).replace(/^\uFEFF/, "").trim();
    if (!txt) return {};
    try {
      const obj = JSON.parse(txt);
      return (obj && typeof obj === "object") ? obj : {};
    } catch {
      return {};
    }
  }

  _clean(str) {
    return String(str || "")
      .replace(/\\u0026/g, "&").replace(/&(?:amp|#38);/g, "&")
      .replace(/&quot;/g, '"').replace(/&(?:#39|apos);/g, "'")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
  }

  _stripTags(s) { return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(); }

  _norm(title) {
    let s = String(title || "").toLowerCase();
    s = s.replace(/\b(season|cour|part|the|animation|movie|uncensored)\b/g, " ");
    s = s.replace(/\b(\d+)(st|nd|rd|th)\b/g, (_, n) => n);
    s = s.replace(/\biii\b/g, "3").replace(/\bii\b/g, "2").replace(/\biv\b/g, "4").replace(/\bv\b/g, "5");
    s = s.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    return s;
  }

  _normalizeServerName(name) {
    return String(name || "").trim().replace(/\u2013|\u2014/g, "-").replace(/\s+/g, "-").toUpperCase();
  }

  _extractId(input) {
    const s0 = String(input || "").trim();
    if (!s0) return "";
    let s = s0;
    if (s.startsWith("http")) { try { const u = new URL(s); s = (u.pathname || "") + (u.search || ""); } catch {} }
    s = s.replace(/[?#].*$/, "");
    const m1 = s.match(/-(\d+)(?:\/|$)/);
    if (m1) return m1[1];
    const m2 = s.match(/\/(\d+)(?:\/|$)/);
    if (m2) return m2[1];
    return /^\d+$/.test(s0) ? s0 : "";
  }

  _parseArg(arg) {
    if (typeof arg === "string") {
      const s = arg.trim();
      try { return (s.startsWith("{") || s.startsWith("[")) ? JSON.parse(s) : { query: s }; } catch { return { query: s }; }
    }
    return arg || {};
  }

  _getTrack(obj) {
    if (obj && obj.dub === true) return "dub";
    if (obj && obj.dub === false) return "sub";
    const t = String((obj && (obj.subOrDub || obj.track)) || "").toLowerCase();
    return (t === "dub" || t === "sub") ? t : "sub";
  }

  _parseDateToObj(dateStr) {
    const s = String(dateStr || "").trim();
    if (!s) return null;
    const monthMap = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
    const m = s.match(/([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})/);
    if (!m) return null;
    return { year: parseInt(m[3], 10) || 0, month: monthMap[m[1]] || 0, day: parseInt(m[2], 10) || 0 };
  }

  _searchSuggest(q, maxItems) {
    const url = this.baseUrl + "/ajax/search/suggest?keyword=" + encodeURIComponent(q);
    const data = this._fetchJson(url, this._headers(true, "/"));
    const html = this._clean(String((data && data.html) || ""));
    if (!html) return [];

    const results = [];
    const seen = new Set();
    const aRe = /<a\b([^>]*?)>([\s\S]*?)<\/a>/gi;
    let am;
    while ((am = aRe.exec(html)) !== null) {
      const attrs = am[1] || "";
      const inner = am[2] || "";
      const hrefM = attrs.match(/\bhref=(["'])(.*?)\1/i);
      if (!hrefM) continue;
      let href = String(hrefM[2] || "").trim();
      if (!href) continue;
      if (href.startsWith("http")) { try { const u = new URL(href); href = (u.pathname || "") + (u.search || ""); } catch {} }
      href = href.replace(/[?#].*$/, "");
      if (href.startsWith("/")) href = href.slice(1);
      if (!href || href.startsWith("search?")) continue;
      const looksAnime = href.includes("/watch/") || /-\d+$/.test(href) || /\bwatch\b/i.test(href);
      if (!looksAnime && /\bnav-item\b/i.test(attrs) === false) continue;
      const id = this._extractId(href);
      if (!id) continue;
      let jname = "";
      const jM = inner.match(/\bdata-jname=(["'])(.*?)\1/i);
      if (jM) jname = this._clean(jM[2]);
      let title = "";
      const h3M = inner.match(/<h3[^>]*\bfilm-name\b[^>]*>([\s\S]*?)<\/h3>/i);
      if (h3M) title = this._stripTags(this._clean(h3M[1]));
      if (!title) { const tA = inner.match(/\btitle=(["'])(.*?)\1/i); if (tA) title = this._stripTags(this._clean(tA[2])); }
      if (!title) title = this._stripTags(this._clean(inner));
      title = String(title || "").trim();
      if (!title) continue;
      let startDate = null;
      const dateM = inner.match(/<span>\s*([A-Za-z]{3}\s+\d{1,2},\s*\d{4})\s*<\/span>/i);
      if (dateM) startDate = this._parseDateToObj(dateM[1]);
      const key = id + "|" + title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ id, title, jname, normTitle: this._norm(title), normTitleJP: this._norm(jname), startDate, url: this.baseUrl + "/" + href.replace(/^\/+/, "") });
      if (results.length >= (maxItems || 25)) break;
    }
    return results;
  }

  _searchHtmlPage(q, maxItems) {
    const url = this.baseUrl + "/search?keyword=" + encodeURIComponent(q);
    const html0 = this._clean(this._fetchText(url, this._headers(false, "/search")));
    if (!html0) return [];
    const out = [];
    const seen = new Set();
    const re = /<a\s+href=(["'])\/watch\/([^"']+)\1[^>]*title=(["'])(.*?)\3[^>]*data-id=(["'])(\d+)\5/gi;
    let m;
    while ((m = re.exec(html0)) !== null) {
      const pageUrl = "watch/" + String(m[2] || "").trim();
      const title = this._clean(String(m[4] || "").trim());
      const id = String(m[6] || "").trim();
      if (!id || !title) continue;
      const key = id + "|" + title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ id, title, jname: "", normTitle: this._norm(title), normTitleJP: "", startDate: null, url: this.baseUrl + "/" + pageUrl });
      if (out.length >= (maxItems || 35)) break;
    }
    return out;
  }

  _checkDub(id) {
    const numId = this._extractId(id);
    if (!numId) return false;
    const cached = this._cacheGet(this._cache.dub, numId);
    if (cached !== undefined) return cached;
    try {
      const data = this._fetchJson(`${this.baseUrl}/ajax/v2/episode/list/${numId}`, this._headers(true, "/"));
      const html = this._clean(String((data && data.html) || ""));
      if (!html) { this._cacheSet(this._cache.dub, numId, false); return false; }
      const epIds = [];
      const reId = /data-id=(["'])(\d+)\1/g;
      let m;
      while ((m = reId.exec(html)) !== null) { epIds.push(String(m[2]).trim()); if (epIds.length >= 5) break; }
      if (!epIds.length) { this._cacheSet(this._cache.dub, numId, false); return false; }
      let dubCount = 0;
      for (const epId of epIds) {
        const ck = `${numId}:${epId}`;
        const epCached = this._cacheGet(this._cache.dubEp, ck);
        let hasDub;
        if (epCached !== undefined) {
          hasDub = epCached;
        } else {
          const sData = this._fetchJson(`${this.baseUrl}/ajax/v2/episode/servers?episodeId=${epId}`, this._headers(true, "/"));
          hasDub = /data-type=(["'])dub\1/i.test(String((sData && sData.html) || ""));
          this._cacheSet(this._cache.dubEp, ck, hasDub);
        }
        if (hasDub) dubCount++;
        if (dubCount >= 2) break;
      }
      const result = dubCount >= 2 || (dubCount > 0 && epIds.length <= 2);
      this._cacheSet(this._cache.dub, numId, result);
      return result;
    } catch {
      this._cacheSet(this._cache.dub, numId, false);
      return false;
    }
  }

  search(arg) {
    arg = this._parseArg(arg);
    const q = String(arg.query || "").trim();
    if (!q) return [];
    const track = this._getTrack(arg);
    const media = arg.media || {};
    const start = media.startDate || {};
    const targetYear = parseInt(start.year, 10) || 0;
    const normTarget = this._norm(media.englishTitle || media.romajiTitle || q);
    const normTargetJP = this._norm(media.romajiTitle || "");
    const cacheKey = `${q}|${track}|${targetYear}`;
    const cached = this._cacheGet(this._cache.search, cacheKey);
    if (cached !== undefined) return cached;

    let items = this._searchSuggest(q, 35);
    if (!items.length) items = this._searchHtmlPage(q, 45);
    if (!items.length) { this._cacheSet(this._cache.search, cacheKey, []); return []; }

    const filtered = items.filter(x => {
      const nt = x.normTitle || "";
      const nj = x.normTitleJP || "";
      const titleMatch = nt === normTarget || (normTargetJP && nj === normTargetJP) ||
        nt.includes(normTarget) || normTarget.includes(nt) ||
        (normTargetJP && (nj.includes(normTargetJP) || normTargetJP.includes(nj)));
      const yearMatch = !targetYear || !x.startDate || x.startDate.year === targetYear || Math.abs(x.startDate.year - targetYear) <= 1;
      return titleMatch && yearMatch;
    });

    const pool = filtered.length ? filtered : items;
    pool.sort((a, b) => {
      const yA = (a.startDate && a.startDate.year) || 0;
      const yB = (b.startDate && b.startDate.year) || 0;
      if (targetYear && yA && yB) {
        const dA = Math.abs(yA - targetYear);
        const dB = Math.abs(yB - targetYear);
        if (dA !== dB) return dA - dB;
      }
      return (a.normTitle || "").length - (b.normTitle || "").length;
    });

    let finalPool = pool;
    if (track === "dub") {
      const dubItems = pool.slice(0, 12).filter(x => this._checkDub(x.id));
      if (dubItems.length) finalPool = dubItems;
    }

    const results = finalPool.map(x => ({
      id: `${x.id}/${track}`,
      title: x.title,
      jname: x.jname || "",
      url: x.url,
      subOrDub: track,
      startDate: x.startDate
    }));

    this._cacheSet(this._cache.search, cacheKey, results);
    return results;
  }

  findEpisodes(Id) {
    const [id, trackRaw] = String(Id || "").split("/");
    const track = trackRaw === "dub" ? "dub" : "sub";
    const numId = this._extractId(id);
    if (!numId) return [];

    const cacheKey = `${numId}|${track}`;
    const cached = this._cacheGet(this._cache.episodes, cacheKey);
    if (cached !== undefined) return cached;

    const episodes = [];
    const seen = new Set();

    for (let page = 1; page <= 12; page++) {
      const url = `${this.baseUrl}/ajax/v2/episode/list/${numId}` + (page > 1 ? `?page=${page}` : "");
      const data = this._fetchJson(url, this._headers(true, "/"));
      const html = this._clean(String((data && data.html) || ""));
      if (!html) break;

      let addedThisPage = 0;
      const aTagRe = /<a\b[^>]*>/gi;
      let m;
      while ((m = aTagRe.exec(html)) !== null) {
        const tag = m[0] || "";
        if (!tag.includes("data-id") || !tag.includes("data-number")) continue;
        const idM = tag.match(/\bdata-id=(["'])(\d+)\1/i);
        const numM = tag.match(/\bdata-number=(["'])([^"']+)\1/i);
        const hrefM = tag.match(/\bhref=(["'])([^"']+)\1/i);
        const epId = idM ? String(idM[2]).trim() : "";
        const num = numM ? parseFloat(numM[2]) : NaN;
        const href = hrefM ? String(hrefM[2]).trim() : "";
        if (!epId || !isFinite(num)) continue;
        const key = `${epId}/${track}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const fullUrl = href ? (href.startsWith("http") ? href : `${this.baseUrl}${href}`) : "";
        episodes.push({ id: `${epId}/${track}`, number: num, title: `Episode ${num}`, url: fullUrl });
        addedThisPage++;
      }
      if (addedThisPage === 0) break;
    }

    episodes.sort((a, b) => a.number - b.number);
    this._cacheSet(this._cache.episodes, cacheKey, episodes);
    return episodes;
  }


  checkDubForEpisode(arg) {
    arg = this._parseArg(arg);
    const numId = this._extractId(String(arg.animeId || "").split("/")[0]);
    const episodeNumber = parseFloat(arg.episodeNumber);
    if (!numId || !isFinite(episodeNumber)) return false;

    try {
      const data = this._fetchJson(`${this.baseUrl}/ajax/v2/episode/list/${numId}`, this._headers(true, "/"));
      const html = this._clean(String((data && data.html) || ""));
      if (!html) return false;

      const re = /<a[^>]*data-number=(["'])([^"']+)\1[^>]*data-id=(["'])(\d+)\3/gi;
      let m, targetEpId = null;
      while ((m = re.exec(html)) !== null) {
        if (Math.abs(parseFloat(m[2]) - episodeNumber) < 0.0001) { targetEpId = String(m[4]).trim(); break; }
      }
      if (!targetEpId) return false;

      const cacheKey = `${numId}:${targetEpId}`;
      const cached = this._cacheGet(this._cache.dubEp, cacheKey);
      if (cached !== undefined) return cached;

      const sData = this._fetchJson(`${this.baseUrl}/ajax/v2/episode/servers?episodeId=${targetEpId}`, this._headers(true, "/"));
      const hasDub = /data-type=(["'])dub\1/i.test(String((sData && sData.html) || ""));
      this._cacheSet(this._cache.dubEp, cacheKey, hasDub);
      return hasDub;
    } catch {
      return false;
    }
  }

  _parseServersForTrack(html, track) {
    const t = track === "dub" ? "dub" : "sub";
    const src = String(html || "");
    if (!src) return [];
    const blocks = [];
    const seen = new Map();
    const add = (id, name) => {
      const norm = this._normalizeServerName(name);
      if (id && norm && !seen.has(norm)) { seen.set(norm, id); blocks.push({ name: norm, id }); }
    };

    const attrRe = /<(?:div|li|span|button|a)\b([^>]*)\bdata-type=(["'])(\w+)\2([^>]*)>/gi;
    let am;
    while ((am = attrRe.exec(src)) !== null) {
      const attrs = am[1] + am[4];
      if (am[3].toLowerCase() !== t) continue;
      const idM = attrs.match(/\bdata-id=(["'])(\d+)\1/) || attrs.match(/\bdata-server-id=(["'])(\d+)\1/);
      if (!idM) continue;
      const serverId = idM[2];
      const chunk = src.slice(am.index + am[0].length, am.index + am[0].length + 200);
      const label = this._stripTags(this._clean(chunk.split(/<\/?(?:div|li|ul)[^>]*>/i)[0] || ""));
      if (label) add(serverId, label);
    }

    if (blocks.length) return blocks;
    const wrapRe = new RegExp(
      `(?:class|data-value)=(["'])[^"']*(?:${t}|ps_-block-${t}|server-${t})[^"']*\\1[\\s\\S]*?` +
      `(?=(?:class|data-value)=(["'])[^"']*(?:sub|dub)[^"']*\\2|$)`,
      "i"
    );
    const wm = wrapRe.exec(src);
    const section = wm ? wm[0] : src;

    const elemRe = /<(?:div|li|span|button|a)\b([^>]*)>/gi;
    let em;
    while ((em = elemRe.exec(section)) !== null) {
      const attrs = em[1];
      if (!/\bdata-id=/.test(attrs)) continue;
      const idM = attrs.match(/\bdata-id=(["'])(\d+)\1/);
      if (!idM) continue;
      const chunk = section.slice(em.index + em[0].length, em.index + em[0].length + 200);
      const label = this._stripTags(this._clean(chunk.split(/<\/?(div|li|ul)[^>]*>/i)[0] || ""));
      if (label) add(idM[2], label);
    }

    return blocks;
  }

  findEpisodeServer(episodeObj, serverName) {
    let ep = episodeObj;
    if (typeof episodeObj === "string") { try { ep = JSON.parse(episodeObj); } catch { ep = {}; } }

    const [epId, trackRaw] = String((ep && ep.id) || "").split("/");
    if (!epId) throw new Error("Missing episode id in episodeObj");

    const track = trackRaw === "dub" ? "dub" : "sub";
    const preferred = this._normalizeServerName(serverName || "HD-1") || "HD-1";

    const listCacheKey = `srvlist:${epId}:${track}`;
    let servers = this._cacheGet(this._cache.servers, listCacheKey);

    if (!servers) {
      const data = this._fetchJson(
        `${this.baseUrl}/ajax/v2/episode/servers?episodeId=${epId}`,
        this._headers(true, "/")
      );
      const html = this._clean(String((data && data.html) || ""));
      if (!html) throw new Error(`No server list found for episode ${epId}`);

      servers = this._parseServersForTrack(html, track);
      if (!servers.length) {
        try { Native.log("findEpisodeServer: parsed 0 servers from HTML: " + html.slice(0, 500)); } catch {}
      }

      const hasDub = /data-type=(["'])dub\1/i.test(html);
      const numId = this._extractId(ep.animeId || epId);
      if (numId) {
        this._cacheSet(this._cache.dubEp, `${numId}:${epId}`, hasDub);
      }

      this._cacheSet(this._cache.servers, listCacheKey, servers);
    }

    const idByName = new Map(servers.map(x => [x.name, x.id]));
    const serverId = idByName.get(preferred);

    if (!serverId) {
      const available = [...idByName.keys()].join(", ") || "none";
      throw new Error(`Server '${preferred}' not available for this episode. Available: [${available}]`);
    }

    const sources = this._fetchJson(
      `${this.baseUrl}/ajax/v2/episode/sources?id=${serverId}`,
      this._headers(true, "/")
    );
    const embed = String((sources && sources.link) || "");
    if (!embed) throw new Error(`No embed link returned from server '${preferred}'`);

    const resp = this._buildStreamResponse(embed, preferred);
    if (!this._looksPlayable(resp)) {
      throw new Error(`Server '${preferred}' returned no playable video sources`);
    }

    return resp;
  }

  _looksPlayable(resp) {
    const vs = resp && resp.videoSources;
    if (!Array.isArray(vs) || !vs.length) return false;
    return vs.some(v => v && typeof v.url === "string" && v.url.length > 10);
  }

  _buildStreamResponse(embed, serverName) {
    let decrypt;
    try { decrypt = this._extractMega(embed); } catch (e) { throw new Error("Stream extraction failed: " + e.message); }

    const srcs = Array.isArray(decrypt.sources) ? decrypt.sources : [];
    const stream = srcs.find(s => s && s.type === "hls" && s.file) || srcs.find(s => s && s.file);
    if (!stream || !stream.file) throw new Error("No stream file in embed response");

    const subs = (Array.isArray(decrypt.tracks) ? decrypt.tracks : [])
      .filter(t => t && t.kind === "captions" && t.file)
      .map((t, i) => ({ id: `sub-${i}`, language: t.label || "Unknown", url: t.file, isDefault: !!t.default }));

    return {
      server: serverName,
      headers: decrypt.headers || {},
      intro: decrypt.intro || null,
      outro: decrypt.outro || null,
      videoSources: [{
        url: stream.file,
        type: stream.type === "hls" ? "m3u8" : "mp4",
        quality: "auto",
        subtitles: subs,
        intro: decrypt.intro || null,
        outro: decrypt.outro || null
      }]
    };
  }

  _extractMega(url) {
    const u = new URL(url);
    const base = `${u.protocol}//${u.host}/`;
    const headers = {
      "Accept": "*/*",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": base,
      "Origin": `${u.protocol}//${u.host}`,
      "User-Agent": "Mozilla/5.0"
    };

    const html = this._fetchText(url, headers);
    const idM = html.match(/<title>\s*File\s*#([a-zA-Z0-9]+)/i);
    if (!idM) throw new Error("File ID not found in embed page");

    let nonce = (html.match(/\b[a-zA-Z0-9]{48}\b/) || [])[0];
    if (!nonce) {
      const parts = [...html.matchAll(/["']([A-Za-z0-9]{16})["']/g)];
      if (parts.length >= 3) nonce = parts[0][1] + parts[1][1] + parts[2][1];
    }
    if (!nonce) throw new Error("Nonce not found in embed page");

    const data = this._fetchJson(`${base}embed-2/v3/e-1/getSources?id=${idM[1]}&_k=${nonce}`, headers);

    return {
      sources: data.sources || [],
      tracks: data.tracks || [],
      intro: data.intro || null,
      outro: data.outro || null,
      headers
    };
  }
}

module.exports = HiAnime;
