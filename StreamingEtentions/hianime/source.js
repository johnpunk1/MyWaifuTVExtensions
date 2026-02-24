class HiAnime {
  constructor() {
    this.type = "anime-streaming";
    this.version = "3.0.5";
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

  _cleanCache() {
    const now = Date.now();
    for (const [, cache] of Object.entries(this._cache)) {
      if (!(cache instanceof Map)) continue;

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

  _nativeFetch(url, method, headers, body) {
    try {
      const raw = Native.fetch(
        String(url),
        method ? String(method) : "GET",
        JSON.stringify(headers || {}),
        body == null ? "" : String(body)
      );
      let j = {};
      try { j = JSON.parse(raw || "{}"); } catch { j = {}; }
      return {
        ok: !!j.ok,
        status: Number(j.status || 0),
        headers: (j && j.headers) ? j.headers : {},
        body: (j && j.body != null) ? String(j.body) : "",
        error: (j && j.error) ? String(j.error) : "",
        message: (j && j.message) ? String(j.message) : ""
      };
    } catch (e) {
      return { ok: false, status: 0, headers: {}, body: "", error: "NATIVE_FETCH_FAIL", message: "" + e };
    }
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

      const hrefM = attrs.match(/\bhref=(["'])(.*?)\1/i);
      if (!hrefM) continue;

      let href = String(hrefM[2] || "").trim();
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

      const isNavItem = /\bclass=(["'])[^\1]*\bnav-item\b[^\1]*\1/i.test(attrs) || /\bnav-item\b/i.test(attrs);
      const looksLikeAnimePage = href.includes("/watch/") || /-\d+$/.test(href) || /\bwatch\b/.test(href);
      if (!isNavItem && !looksLikeAnimePage) continue;

      const id = this._extractId(href);
      if (!id) continue;

      let jname = "";
      let title = "";

      const jM = inner.match(/\bdata-jname=(["'])(.*?)\1/i);
      if (jM) jname = this._clean(jM[2]);

      const h3M = inner.match(/<h3[^>]*class=(["'])[^\1]*\bfilm-name\b[^\1]*\1[^>]*>([\s\S]*?)<\/h3>/i);
      if (h3M) title = this._stripTags(this._clean(h3M[2]));

      if (!title) {
        const tAttr = inner.match(/\btitle=(["'])(.*?)\1/i);
        if (tAttr) title = this._stripTags(this._clean(tAttr[2]));
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
      if (!finalPath.startsWith("watch/") && !finalPath.includes("/watch/")) {
      } else {
        finalPath = finalPath.replace(/^\/+/, "");
      }

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

    if (!results.length) {
      const hrefRe = /\bhref=(["'])(\/?[^"'#?]*-\d+)\1/gi;
      let hm;
      while ((hm = hrefRe.exec(html)) !== null) {
        let path = String(hm[2] || "").trim();
        if (!path) continue;
        if (path.startsWith("/")) path = path.slice(1);

        const id = this._extractId(path);
        if (!id) continue;

        const key = id + "|" + path.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        results.push({
          id,
          title: path,
          jname: "",
          normTitle: this._norm(path),
          normTitleJP: "",
          startDate: null,
          url: this.baseUrl + "/" + path
        });

        if (results.length >= maxItems) break;
      }
    }

    return results;
  }

  _searchHtmlPage(q, maxItems = 35) {
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
      const reId = /data-id=(["'])(\d+)\1/g;
      let m;
      while ((m = reId.exec(html)) !== null) {
        const epId = String(m[2] || "").trim();
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
          hasDub = /data-type=(["'])dub\1/i.test(String(sData.html || ""));
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

      const re = /<a[^>]*data-number=(["'])([^"']+)\1[^>]*data-id=(["'])(\d+)\3/gi;
      let m;
      let targetEpId = null;

      while ((m = re.exec(html)) !== null) {
        const num = parseFloat(m[2]);
        if (isFinite(num) && Math.abs(num - episodeNumber) < 0.0001) {
          targetEpId = String(m[4] || "").trim();
          break;
        }
      }

      if (!targetEpId) return false;

      const cacheKey = `${numId}:${targetEpId}`;
      const cached = this._cache.serverCheck.get(cacheKey);
      if (cached) return !!cached.v;

      const sData = this._fetchJson(`${this.baseUrl}/ajax/v2/episode/servers?episodeId=${targetEpId}`, this._headers(true, "/"));
      const hasDub = /data-type=(["'])dub\1/i.test(String(sData.html || ""));

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

    const normTarget = this._norm(media.englishTitle || media.romajiTitle || q);
    const normTargetJP = this._norm(media.romajiTitle || "");

    const cacheKey = `${q}|${track}|${targetYear}`;
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
      return titleMatch && yearMatch;
    });

    if (!items.length) {
      items = this._searchSuggest(q, 35);
      if (!items.length) items = this._searchHtmlPage(q, 45);
    }

    items.sort((a, b) => {
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

  _fetchEpisodeListPage(numId, page) {
    const url = `${this.baseUrl}/ajax/v2/episode/list/${numId}` + (page && page > 1 ? `?page=${page}` : "");
    const data = this._fetchJson(url, this._headers(true, "/"));
    return this._clean(String(data.html || ""));
  }

  findEpisodes(Id) {
    const [id, trackRaw] = String(Id || "").split("/");
    const track = trackRaw === "dub" ? "dub" : "sub";
    const numId = this._extractId(id);
    if (!numId) return [];

    const episodes = [];
    const seen = new Set();

    for (let page = 1; page <= 12; page++) {
      const html = this._fetchEpisodeListPage(numId, page);
      if (!html) break;

      const aTagRe = /<a\b[^>]*\bclass=(["'])[^\1]*\bep-item\b[^\1]*\1[^>]*>/gi;
      const tags = html.match(aTagRe) || [];
      if (!tags.length) break;

      let addedThisPage = 0;

      for (const tag of tags) {
        const idM = tag.match(/\bdata-id=(["'])(\d+)\1/i);
        const numM = tag.match(/\bdata-number=(["'])([^"']+)\1/i);
        const hrefM = tag.match(/\bhref=(["'])([^"']+)\1/i);

        const epId = idM ? String(idM[2] || "").trim() : "";
        const num = numM ? parseFloat(numM[2]) : NaN;
        const href = hrefM ? String(hrefM[2] || "").trim() : "";

        if (!epId || !isFinite(num)) continue;

        const key = `${epId}/${track}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const fullUrl = href
          ? (href.startsWith("http") ? href : `${this.baseUrl}${href}`)
          : "";

        episodes.push({
          id: `${epId}/${track}`,
          number: num,
          title: `Episode ${num}`,
          url: fullUrl
        });

        addedThisPage++;
      }

      if (addedThisPage === 0) break;

    }

    episodes.sort((a, b) => a.number - b.number);
    return episodes;
  }

  findEpisodeServer(episodeObj, serverName) {
    let ep = episodeObj;
    if (typeof episodeObj === "string") {
      try { ep = JSON.parse(episodeObj); } catch { ep = {}; }
    }

    const [epId, trackRaw] = String(ep.id || "").split("/");
    if (!epId) throw new Error("Missing episode id");

    const actualTrack = trackRaw === "dub" ? "dub" : "sub";
    const server = String(serverName || "HD-1").trim() || "HD-1";

    const data = this._fetchJson(`${this.baseUrl}/ajax/v2/episode/servers?episodeId=${epId}`, this._headers(true, "/"));
    const html = this._clean(String(data.html || ""));

    if (!html || !/data-type=(["'])(sub|dub|raw)\1/i.test(html)) {
      throw new Error("No servers found");
    }

    const safeServer = this._escapeRegExp(server);

    let serverId = "";
    const blockRe = new RegExp(
      `data-type=(["'])${actualTrack}\\1[\\s\\S]*?data-id=(["'])(\\d+)\\2[\\s\\S]*?<a[^>]*>\\s*${safeServer}\\s*<\\/a>`,
      "i"
    );
    let m = blockRe.exec(html);

    if (!m) {
      const fb = new RegExp(`data-type=(["'])${actualTrack}\\1[^>]*data-id=(["'])(\\d+)\\2`, "i");
      m = fb.exec(html);
      if (m) serverId = m[3];
    } else {
      serverId = m[3];
    }

    if (!serverId) throw new Error(`No ${actualTrack} server found`);

    const sources = this._fetchJson(`${this.baseUrl}/ajax/v2/episode/sources?id=${serverId}`, this._headers(true, "/"));
    const embed = String(sources.link || "");
    if (!embed) throw new Error("No embed link");

    return this._buildStreamResponse(embed, server);
  }

  _buildStreamResponse(embed, serverName) {
    let decrypt, headers;

    try {
      decrypt = this._extractMega(embed);
      headers = decrypt.headers || {};
    } catch (e) {
      try {
        const fb = this._fetchJson(
          `https://ac-api.ofchaos.com/api/anime/embed/convert/v2?embedUrl=${encodeURIComponent(embed)}`,
          {}
        );
        decrypt = fb || {};
        const u = new URL(embed);
        headers = {
          "Referer": `${u.protocol}//${u.host}/`,
          "Origin": `${u.protocol}//${u.host}`,
          "User-Agent": "Mozilla/5.0"
        };
      } catch (e2) {
        throw new Error("Failed to extract stream: " + e.message);
      }
    }

    const srcs = Array.isArray(decrypt.sources) ? decrypt.sources : [];
    const stream =
      srcs.find(s => s && s.type === "hls" && s.file) ||
      srcs.find(s => s && s.file);

    if (!stream || !stream.file) throw new Error("No stream file found");

    const subs = (Array.isArray(decrypt.tracks) ? decrypt.tracks : [])
      .filter(t => t && t.kind === "captions" && t.file)
      .map((t, i) => ({
        id: `sub-${i}`,
        language: t.label || "Unknown",
        url: t.file,
        isDefault: !!t.default
      }));

    return {
      server: serverName,
      headers: headers || {},
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
    if (!idM) throw new Error("File ID not found");

    let nonce = (html.match(/\b[a-zA-Z0-9]{48}\b/) || [])[0];

    if (!nonce) {
      const parts = [...html.matchAll(/["']([A-Za-z0-9]{16})["']/g)];
      if (parts.length >= 3) nonce = parts[0][1] + parts[1][1] + parts[2][1];
    }
    if (!nonce) throw new Error("Nonce not found");

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
