class HiAnime {
  constructor() {
    this.type = "anime-streaming";
    this.version = "3.0.9";
    this.baseUrl = "https://hianime.to";
    this._cache = {
      dub: new Map(),
      search: new Map(),
      serverCheck: new Map(),
      _maxSize: 200,
      _expiry: 5 * 60 * 1000
    };
  }

  getSettings() {
    return {
      episodeServers: ["HD-1", "HD-2", "HD-3"],
      supportsSub: true,
      supportsDub: true,
      supportsHls: true
    };
  }

  stream() { return null; }

  _log(msg) {
    try {
      console.log("[HiAnime] " + msg);
    } catch (e) {}
  }

  _cleanCache() {
    const now = Date.now();
    for (const [name, cache] of Object.entries(this._cache)) {
      if (!(cache instanceof Map)) continue;

      const sizeBefore = cache.size;

      if (cache.size > this._cache._maxSize) {
        const entries = [...cache.entries()];
        entries.sort((a, b) => (b[1]?.t || 0) - (a[1]?.t || 0));
        const keep = entries.slice(0, Math.floor(this._cache._maxSize * 0.7));
        cache.clear();
        for (const [k, v] of keep) cache.set(k, v);
      }

      for (const [k, v] of cache) {
        if (v && v.t && now - v.t > this._cache._expiry) cache.delete(k);
      }

      if (sizeBefore > this._cache._maxSize * 0.9 && cache.size < sizeBefore) {
        this._log(`Cache '${name}' cleaned: ${sizeBefore} -> ${cache.size} items`);
      }
    }
  }

  _escapeRegExp(s) {
    return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  _headers(json = true, refererPath = "/") {
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

  _clean(str) {
    return String(str || "")
      .replace(/\\u0026/g, "&")
      .replace(/&(?:amp|#38);/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&(?:#39|apos);/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
  }

  _stripTags(s) {
    return String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }

  _norm(title) {
    let s = String(title || "").toLowerCase();
    s = s.replace(/\b(season|cour|part|the|animation|movie|uncensored)\b/g, " ");
    s = s.replace(/\b(\d+)(st|nd|rd|th)\b/g, (_, n) => n);
    s = s.replace(/\biii\b/g, "3");
    s = s.replace(/\bii\b/g, "2");
    s = s.replace(/\biv\b/g, "4");
    s = s.replace(/\bv\b/g, "5");
    s = s.replace(/[^\w\s]/g, " ");
    s = s.replace(/\s+/g, " ").trim();
    return s;
  }

  _extractId(input) {
    const s0 = String(input || "").trim();
    if (!s0) return "";

    let s = s0;
    if (s.startsWith("http")) {
      try {
        const u = new URL(s);
        s = (u.pathname || "") + (u.search || "");
      } catch {}
    }

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
      try {
        return (s.startsWith("{") || s.startsWith("[")) ? JSON.parse(s) : { query: s };
      } catch {
        return { query: s };
      }
    }
    return arg || {};
  }

  _getTrack(obj) {
    if (obj && obj.dub === true) return "dub";
    if (obj && obj.dub === false) return "sub";
    const t = String((obj && (obj.subOrDub || obj.track)) || "").toLowerCase();
    return t === "dub" || t === "sub" ? t : "sub";
  }

  _nativeFetch(url, method, headers, body, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const raw = Native.fetch(
          String(url),
          method ? String(method) : "GET",
          JSON.stringify(headers || {}),
          body == null ? "" : String(body)
        );
        let j = {};
        try { j = JSON.parse(raw || "{}"); } catch { j = {}; }
        
        const result = {
          ok: !!j.ok,
          status: Number(j.status || 0),
          headers: (j && j.headers) ? j.headers : {},
          body: (j && j.body != null) ? String(j.body) : "",
          error: (j && j.error) ? String(j.error) : "",
          message: (j && j.message) ? String(j.message) : ""
        };

        if (result.ok || attempt === retries) {
          return result;
        }
      } catch (e) {
        if (attempt === retries) {
          return { ok: false, status: 0, headers: {}, body: "", error: "NATIVE_FETCH_FAIL", message: "" + e };
        }
      }
    }
    return { ok: false, status: 0, headers: {}, body: "", error: "NATIVE_FETCH_FAIL", message: "Max retries exceeded" };
  }

  _fetchText(url, headers) {
    const r = this._nativeFetch(url, "GET", headers || {}, "");
    return String(r.body || "");
  }

  _fetchJson(url, headers) {
    const r = this._nativeFetch(url, "GET", headers || {}, "");
    const txt = String(r.body || "").replace(/^\uFEFF/, "").trim();
    if (!txt) return {};

    const looksHtml =
      txt.startsWith("<!doctype") ||
      txt.startsWith("<html") ||
      txt.startsWith("<head") ||
      txt.startsWith("<body") ||
      txt.includes("<html") ||
      txt.includes("<title");

    try {
      const obj = JSON.parse(txt);
      return obj && typeof obj === "object" ? obj : {};
    } catch {
      if (looksHtml) return { html: txt };
      return {};
    }
  }

  _parseDateToObj(dateStr) {
    const s = String(dateStr || "").trim();
    if (!s) return null;

    const monthMap = {
      Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
      Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12
    };

    const m = s.match(/([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})/);
    if (!m) return null;

    const month = monthMap[m[1]] || 0;
    const day = parseInt(m[2], 10) || 0;
    const year = parseInt(m[3], 10) || 0;
    if (!year) return null;

    return { year, month, day };
  }

  _searchSuggest(q, maxItems = 25) {
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

      const hrefM = attrs.match(/\bhref=["']([^"']+)["']/i);
      if (!hrefM) continue;

      let href = String(hrefM[1] || "").trim();
      if (!href) continue;

      if (href.startsWith("http")) {
        try {
          const u = new URL(href);
          href = (u.pathname || "") + (u.search || "");
        } catch {}
      }

      href = href.replace(/[?#].*$/, "");
      if (href.startsWith("/")) href = href.slice(1);

      if (!href || href.startsWith("search?")) continue;

      const isNavItem = /\bclass=["'][^"']*\bnav-item\b/i.test(attrs);
      const looksLikeAnimePage = href.includes("/watch/") || /-\d+$/.test(href);
      if (!isNavItem && !looksLikeAnimePage) continue;

      const id = this._extractId(href);
      if (!id) continue;

      let jname = "";
      let title = "";

      const jM = inner.match(/\bdata-jname=["']([^"']+)["']/i);
      if (jM) jname = this._clean(jM[1]);

      const h3M = inner.match(/<h3[^>]*\bfilm-name\b[^>]*>([\s\S]*?)<\/h3>/i);
      if (h3M) title = this._stripTags(this._clean(h3M[1]));

      if (!title) {
        const tAttr = inner.match(/\btitle=["']([^"']+)["']/i);
        if (tAttr) title = this._stripTags(this._clean(tAttr[1]));
      }

      if (!title) title = this._stripTags(this._clean(inner));
      title = String(title || "").trim();
      if (!title) continue;

      let startDate = null;
      const dateM = inner.match(/<span>\s*([A-Za-z]{3}\s+\d{1,2},\s*\d{4})\s*<\/span>/i);
      if (dateM) startDate = this._parseDateToObj(dateM[1]);

      const key = id + "|" + title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      let finalPath = href;
      finalPath = finalPath.replace(/^\/+/, "");

      results.push({
        id,
        title,
        jname,
        normTitle: this._norm(title),
        normTitleJP: this._norm(jname),
        startDate,
        url: this.baseUrl + "/" + finalPath
      });

      if (results.length >= maxItems) break;
    }

    return results;
  }

  _searchHtmlPage(q, maxItems = 35) {
    const url = this.baseUrl + "/search?keyword=" + encodeURIComponent(q);
    const html0 = this._clean(this._fetchText(url, this._headers(false, "/search")));
    if (!html0) return [];

    const out = [];
    const seen = new Set();

    const re = /<a\s+href=["']\/watch\/([^"']+)["'][^>]*title=["']([^"']+)["'][^>]*data-id=["'](\d+)["']/gi;
    let m;
    while ((m = re.exec(html0)) !== null) {
      const pageUrl = "watch/" + String(m[1] || "").trim();
      const title = this._clean(String(m[2] || "").trim());
      const id = String(m[3] || "").trim();
      if (!id || !title) continue;

      const key = id + "|" + title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      out.push({
        id,
        title,
        jname: "",
        normTitle: this._norm(title),
        normTitleJP: "",
        startDate: null,
        url: this.baseUrl + "/" + pageUrl
      });

      if (out.length >= maxItems) break;
    }

    return out;
  }

  _checkDub(id) {
    const animeId = this._extractId(id);
    if (!animeId) return false;

    const cached = this._cache.dub.get(animeId);
    if (cached) return !!cached.v;

    try {
      const data = this._fetchJson(`${this.baseUrl}/ajax/v2/episode/list/${animeId}`, this._headers(true, "/"));
      const html = this._clean(String(data.html || ""));
      if (!html) {
        this._cache.dub.set(animeId, { v: false, t: Date.now() });
        return false;
      }

      const episodeIds = [];
      const reId = /data-id=["'](\d+)["']/g;
      let m;
      while ((m = reId.exec(html)) !== null) {
        const epId = String(m[1] || "").trim();
        if (epId) episodeIds.push(epId);
        if (episodeIds.length >= 5) break;
      }

      if (!episodeIds.length) {
        this._cache.dub.set(animeId, { v: false, t: Date.now() });
        return false;
      }

      let dubCount = 0;

      for (const epId of episodeIds) {
        const cacheKey = `${animeId}:${epId}`;
        const epCached = this._cache.serverCheck.get(cacheKey);
        let hasDub;

        if (epCached) {
          hasDub = !!epCached.v;
        } else {
          const sData = this._fetchJson(`${this.baseUrl}/ajax/v2/episode/servers?episodeId=${epId}`, this._headers(true, "/"));
          hasDub = /data-type=["']dub["']/i.test(String(sData.html || ""));
          this._cache.serverCheck.set(cacheKey, { v: hasDub, t: Date.now() });
        }

        if (hasDub) dubCount++;
        if (dubCount >= 2) break;
      }

      const hasDubFinal = dubCount >= 2 || (dubCount > 0 && episodeIds.length <= 2);
      this._cache.dub.set(animeId, { v: hasDubFinal, t: Date.now() });
      return hasDubFinal;
    } catch {
      this._cache.dub.set(animeId, { v: false, t: Date.now() });
      return false;
    }
  }

  checkDubForEpisode(arg) {
    arg = this._parseArg(arg);
    const animeId = String(arg.animeId || "").split("/")[0];
    const episodeNumber = parseFloat(arg.episodeNumber);

    const numId = this._extractId(animeId);
    if (!numId || !isFinite(episodeNumber)) return false;

    try {
      const data = this._fetchJson(`${this.baseUrl}/ajax/v2/episode/list/${numId}`, this._headers(true, "/"));
      const html = this._clean(String(data.html || ""));
      if (!html) return false;

      const re = /<a[^>]*data-number=["']([^"']+)["'][^>]*data-id=["'](\d+)["']/gi;
      let m;
      let targetEpId = null;

      while ((m = re.exec(html)) !== null) {
        const num = parseFloat(m[1]);
        if (isFinite(num) && Math.abs(num - episodeNumber) < 0.0001) {
          targetEpId = String(m[2] || "").trim();
          break;
        }
      }

      if (!targetEpId) return false;

      const cacheKey = `${numId}:${targetEpId}`;
      const cached = this._cache.serverCheck.get(cacheKey);
      if (cached) return !!cached.v;

      const sData = this._fetchJson(`${this.baseUrl}/ajax/v2/episode/servers?episodeId=${targetEpId}`, this._headers(true, "/"));
      const hasDub = /data-type=["']dub["']/i.test(String(sData.html || ""));

      this._cache.serverCheck.set(cacheKey, { v: hasDub, t: Date.now() });
      return hasDub;
    } catch {
      return false;
    }
  }

  search(arg) {
    this._cleanCache();

    arg = this._parseArg(arg);
    const q = String(arg.query || "").trim();
    if (!q) return [];

    const track = this._getTrack(arg);
    const media = arg.media || {};
    const start = media.startDate || {};
    const targetYear = parseInt(start.year, 10) || 0;
    const targetFormat = String(media.format || "").toUpperCase().trim();

    const normTarget = this._norm(media.englishTitle || media.romajiTitle || q);
    const normTargetJP = this._norm(media.romajiTitle || "");

    const cacheKey = `${q}|${track}|${targetYear}|${targetFormat}`;
    const cached = this._cache.search.get(cacheKey);
    if (cached) return cached.v;

    let items = this._searchSuggest(q, 35);
    if (!items.length) items = this._searchHtmlPage(q, 45);
    if (!items.length) return [];

    items = items.filter(x => {
      const nt = x.normTitle || "";
      const nj = x.normTitleJP || "";
      const titleMatch =
        nt === normTarget ||
        (normTargetJP && nj === normTargetJP) ||
        nt.includes(normTarget) ||
        normTarget.includes(nt) ||
        (normTargetJP && (nj.includes(normTargetJP) || normTargetJP.includes(nj)));

      const yearMatch = !targetYear || !x.startDate || x.startDate.year === targetYear;
      
      let formatMatch = true;
      if (targetFormat === "MOVIE") {
        const titleLower = x.title.toLowerCase();
        formatMatch = titleLower.includes("movie") || 
                     titleLower.includes("film") ||
                     /\bmovie\b/.test(titleLower);
      } else if (targetFormat === "TV") {
        const titleLower = x.title.toLowerCase();
        formatMatch = !titleLower.includes("movie") && 
                     !titleLower.includes("film");
      } else if (targetFormat === "OVA") {
        const titleLower = x.title.toLowerCase();
        formatMatch = /\bova\b/i.test(titleLower);
      } else if (targetFormat === "ONA") {
        const titleLower = x.title.toLowerCase();
        formatMatch = /\bona\b/i.test(titleLower);
      } else if (targetFormat === "SPECIAL") {
        const titleLower = x.title.toLowerCase();
        formatMatch = /\bspecial\b/i.test(titleLower);
      }

      return titleMatch && yearMatch && formatMatch;
    });

    if (!items.length) {
      items = this._searchSuggest(q, 35);
      if (!items.length) items = this._searchHtmlPage(q, 45);
    }

    items.sort((a, b) => {
      const aTitle = a.title.toLowerCase();
      const bTitle = b.title.toLowerCase();
      
      if (targetFormat === "MOVIE") {
        const aIsMovie = aTitle.includes("movie");
        const bIsMovie = bTitle.includes("movie");
        if (aIsMovie && !bIsMovie) return -1;
        if (!aIsMovie && bIsMovie) return 1;
      } else if (targetFormat === "OVA") {
        const aIsOVA = /\bova\b/i.test(aTitle);
        const bIsOVA = /\bova\b/i.test(bTitle);
        if (aIsOVA && !bIsOVA) return -1;
        if (!aIsOVA && bIsOVA) return 1;
      } else if (targetFormat === "ONA") {
        const aIsONA = /\bona\b/i.test(aTitle);
        const bIsONA = /\bona\b/i.test(bTitle);
        if (aIsONA && !bIsONA) return -1;
        if (!aIsONA && bIsONA) return 1;
      } else if (targetFormat === "SPECIAL") {
        const aIsSpecial = /\bspecial\b/i.test(aTitle);
        const bIsSpecial = /\bspecial\b/i.test(bTitle);
        if (aIsSpecial && !bIsSpecial) return -1;
        if (!aIsSpecial && bIsSpecial) return 1;
      }

      const yearA = (a.startDate && a.startDate.year) || 0;
      const yearB = (b.startDate && b.startDate.year) || 0;

      if (targetYear && yearA && yearB) {
        const diffA = Math.abs(yearA - targetYear);
        const diffB = Math.abs(yearB - targetYear);
        if (diffA !== diffB) return diffA - diffB;
      }
      return (a.normTitle || "").length - (b.normTitle || "").length;
    });

    if (track === "dub") {
      const top = items.slice(0, 12);
      const ok = [];
      for (const x of top) {
        if (this._checkDub(x.id)) ok.push(x);
      }
      items = ok.length ? ok : top;
    }

    const results = items.map(x => ({
      id: `${x.id}/${track}`,
      title: x.title,
      url: x.url,
      subOrDub: track,
      startDate: x.startDate
    }));

    this._cache.search.set(cacheKey, { v: results, t: Date.now() });
    return results;
  }

  findEpisodes(Id) {
    const [id, trackRaw] = String(Id || "").split("/");
    const track = trackRaw === "dub" ? "dub" : "sub";
    const numId = this._extractId(id);
    if (!numId) return [];

    const data = this._fetchJson(`${this.baseUrl}/ajax/v2/episode/list/${numId}`, this._headers(true, "/"));
    const html = this._clean(String(data.html || ""));
    if (!html) return [];

    const episodes = [];
    const re = /<a[^>]*\bep-item\b[^>]*data-number=["']([^"']+)["'][^>]*data-id=["'](\d+)["'][^>]*href=["']([^"']+)["'][^>]*>[\s\S]*?<div[^>]*\bep-name\b[^>]*title=["']([^"']*)["']/gi;

    let m;
    while ((m = re.exec(html)) !== null) {
      const num = parseFloat(m[1]);
      const epId = String(m[2] || "").trim();
      const href = String(m[3] || "").trim();
      const title = this._clean(m[4]);

      if (!epId || !isFinite(num)) continue;

      episodes.push({
        id: `${epId}/${track}`,
        number: num,
        title: title || `Episode ${num}`,
        url: href ? (href.startsWith("http") ? href : `${this.baseUrl}${href}`) : ""
      });
    }

    episodes.sort((a, b) => a.number - b.number);
    return episodes;
  }

  findEpisodeServer(episodeObj, serverName) {
    let ep = episodeObj;
    if (typeof episodeObj === "string") {
      try { ep = JSON.parse(episodeObj); } catch { ep = {}; }
    }

    const epIdRaw = String(ep.id || "");
    const [epId, trackRaw] = epIdRaw.split("/");
    
    if (!epId) throw new Error(`Missing episode id (got: '${epIdRaw}')`);

    const actualTrack = trackRaw === "dub" ? "dub" : "sub";
    const server = String(serverName || "HD-1").trim() || "HD-1";

    try {
      const serversUrl = `${this.baseUrl}/ajax/v2/episode/servers?episodeId=${epId}`;
      const data = this._fetchJson(serversUrl, this._headers(true, "/"));
      const html = this._clean(String(data.html || ""));

      if (!html) throw new Error("No servers found - empty HTML");

      let serverId = "";
      const safeServer = this._escapeRegExp(server);
      const detailPattern = `data-type=["']${actualTrack}["'][\\s\\S]{0,500}?data-id=["'](\\d+)["'][\\s\\S]{0,200}?${safeServer}`;
      const blockRe = new RegExp(detailPattern, "i");
      let m = blockRe.exec(html);
      
      if (m) {
        serverId = m[1];
      } else {
        const simplePattern = `data-type=["']${actualTrack}["'][^>]{0,200}?data-id=["'](\\d+)["']`;
        const fb = new RegExp(simplePattern, "i");
        m = fb.exec(html);
        if (m) serverId = m[1];
      }

      if (!serverId) throw new Error(`No ${actualTrack} server found for episode ${epId}`);

      const sourcesUrl = `${this.baseUrl}/ajax/v2/episode/sources?id=${serverId}`;
      const sources = this._fetchJson(sourcesUrl, this._headers(true, "/"));
      const embed = String(sources.link || "");
      
      if (!embed) throw new Error("No embed link in sources response");

      return this._buildStreamResponse(embed, server);
    } catch (e) {
      throw new Error(`findEpisodeServer failed (ep=${epId}, track=${actualTrack}): ${e.message}`);
    }
  }

  _buildStreamResponse(embed, serverName) {
    let decrypt = null;
    let headers = {};
    let usedFallback = false;

    try {
      decrypt = this._extractMega(embed);
      headers = decrypt.headers || {};
    } catch (e) {
      try {
        const fbUrl = "https://ac-api.ofchaos.com/api/anime/embed/convert/v2?embedUrl=" + encodeURIComponent(embed);
        const fb = this._fetchJson(fbUrl, {});
        decrypt = fb || {};
        usedFallback = true;
        const u = new URL(embed);
        headers = {
          "Referer": u.protocol + "//" + u.host + "/",
          "Origin": u.protocol + "//" + u.host,
          "User-Agent": "Mozilla/5.0"
        };
      } catch (e2) {
        throw new Error(`Stream extraction failed: ${e.message}`);
      }
    }

    if (!decrypt || typeof decrypt !== "object") {
      throw new Error("Invalid decryption response");
    }

    const srcs = Array.isArray(decrypt.sources) ? decrypt.sources : [];
    let stream = srcs.find(s => s && s.type === "hls" && s.file) || srcs.find(s => s && s.file);

    if (!stream && usedFallback && decrypt.url) {
      stream = { file: decrypt.url, type: "hls" };
    }

    if (!stream || !stream.file) {
      throw new Error("No video source in response");
    }

    const subs = Array.isArray(decrypt.tracks) 
      ? decrypt.tracks.filter(t => t && (t.kind === "captions" || t.kind === "subtitles")) 
      : [];

    const subtitles = subs.map((t, i) => ({
      id: t.label || `sub_${i}`,
      language: t.label || "Unknown",
      url: t.file || "",
      isDefault: !!t.default
    })).filter(s => s.url);

    const intro = decrypt.intro && typeof decrypt.intro === "object" ? {
      start: Number(decrypt.intro.start || 0),
      end: Number(decrypt.intro.end || 0)
    } : null;

    const outro = decrypt.outro && typeof decrypt.outro === "object" ? {
      start: Number(decrypt.outro.start || 0),
      end: Number(decrypt.outro.end || 0)
    } : null;

    return {
      server: serverName,
      headers: headers,
      intro: intro,
      outro: outro,
      videoSources: [{
        url: stream.file,
        type: stream.type || "hls",
        quality: "auto"
      }],
      subtitles: subtitles
    };
  }

  _extractMega(url) {
    const u = new URL(url);
    const base = u.protocol + "//" + u.host + "/";
    
    const html = this._fetchText(url.split("?")[0], {
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent": "Mozilla/5.0",
      "Referer": base
    });

    const fileIdMatch = url.match(/\/e(?:-\d+)?\/([a-zA-Z0-9_-]+)/);
    const fileId = fileIdMatch ? fileIdMatch[1] : null;
    if (!fileId) throw new Error("Could not extract file ID from URL");

    let nonce = null;
    const nonce48 = html.match(/player\s*=\s*{[^}]*_next\s*:\s*function\s*\([^)]*\)\s*{\s*return\s*["']([a-zA-Z0-9]{48})["']/);
    if (nonce48) {
      nonce = nonce48[1];
    } else {
      const nonce16 = html.match(/cid\s*=\s*["']([a-zA-Z0-9]{16})["']/);
      if (nonce16) nonce = nonce16[1];
    }

    if (!nonce) throw new Error("Could not extract nonce from embed page");

    const sourcesUrl = base + "embed-2/v3/e-1/getSources?id=" + fileId + "&_k=" + nonce;
    const data = this._fetchJson(sourcesUrl, {
      "Accept": "*/*",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": base,
      "User-Agent": "Mozilla/5.0"
    });

    data.headers = {
      "Accept": "*/*",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": base,
      "Origin": base.replace(/\/$/, ""),
      "User-Agent": "Mozilla/5.0"
    };

    return data;
  }
}

module.exports = new HiAnime();
