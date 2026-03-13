class AniCrush {
  constructor() {
    this.type = "anime-streaming";
    this.version = "1.0.0";
    this.baseUrl = "https://anicrush.to";
    this.apiUrl = "https://api.anicrush.to";
    this._cache = {
      dub:      new Map(),
      dubEp:    new Map(),
      search:   new Map(),
      episodes: new Map(),
      servers:  new Map(),
      _maxSize: 300,
      _ttl: 8 * 60 * 1000
    };
  }

  getSettings() {
    return {
      episodeServers: ["Southcloud-1", "Southcloud-2", "Southcloud-3"],
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
      const entries = [...map.entries()].sort((a, b) => a[1].t - b[1].t);
      const evict = Math.ceil(entries.length * 0.3);
      for (let i = 0; i < evict; i++) map.delete(entries[i][0]);
    }
    map.set(key, { v: value, t: Date.now() });
  }

  _headers(json) {
    return {
      "User-Agent": "Mozilla/5.0",
      "Accept": json ? "application/json" : "text/html,application/xhtml+xml,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": this.baseUrl + "/",
      "Origin": this.baseUrl,
      "X-Site": "anicrush"
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

  _norm(title) {
    let s = String(title || "").toLowerCase();
    s = s.replace(/\b(season|cour|part|the|animation|movie|uncensored)\b/g, " ");
    s = s.replace(/\b(\d+)(st|nd|rd|th)\b/g, (_, n) => n);
    s = s.replace(/\biii\b/g, "3").replace(/\bii\b/g, "2").replace(/\biv\b/g, "4").replace(/\bv\b/g, "5");
    s = s.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    return s;
  }

  _normalizeTitle(title) {
    return String(title || "").toLowerCase()
      .replace(/(season|cour|part|uncensored)/g, "")
      .replace(/\d+(st|nd|rd|th)/g, m => m.replace(/st|nd|rd|th/, ""))
      .replace(/[^a-z0-9]+/g, "");
  }

  _levenshteinSimilarity(a, b) {
    const lenA = a.length, lenB = b.length;
    const dp = Array.from({ length: lenA + 1 }, () => new Array(lenB + 1).fill(0));
    for (let i = 0; i <= lenA; i++) dp[i][0] = i;
    for (let j = 0; j <= lenB; j++) dp[0][j] = j;
    for (let i = 1; i <= lenA; i++) {
      for (let j = 1; j <= lenB; j++) {
        if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
        else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    const maxLen = Math.max(lenA, lenB);
    return maxLen ? 1 - dp[lenA][lenB] / maxLen : 1;
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

  _normalizeDate(dateStr) {
    const s = String(dateStr || "").trim();
    if (!s) return null;
    const months = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
    const m = s.match(/([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})/);
    if (!m) return null;
    return { year: parseInt(m[3], 10) || 0, month: months[m[1]] || 0 };
  }

  search(arg) {
    arg = this._parseArg(arg);
    const q = String(arg.query || "").trim();
    if (!q) return [];
    const track = this._getTrack(arg);
    const media = arg.media || {};
    const start = media.startDate || {};
    const targetYear = parseInt(start.year, 10) || 0;
    const targetMonth = parseInt(start.month, 10) || 0;

    const cacheKey = `${q}|${track}|${targetYear}`;
    const cached = this._cacheGet(this._cache.search, cacheKey);
    if (cached !== undefined) return cached;

    const url = `${this.apiUrl}/shared/v2/movie/list?keyword=${encodeURIComponent(q)}&limit=48&page=1`;
    const data = this._fetchJson(url, this._headers(true));
    const movies = (data && data.result && data.result.movies) || [];
    if (!movies.length) { this._cacheSet(this._cache.search, cacheKey, []); return []; }

    let matches = movies.map(movie => ({
      id: String(movie.id || ""),
      slug: String(movie.slug || ""),
      title: this._clean(String(movie.name_english || movie.name || "")),
      titleJP: this._clean(String(movie.name || "")),
      normTitle: this._normalizeTitle(movie.name_english || movie.name || ""),
      normTitleJP: this._normalizeTitle(movie.name || ""),
      hasDub: !!movie.has_dub,
      startDate: this._normalizeDate(movie.aired_from),
      format: String((movie.type || "")).toUpperCase()
    }));

    if (track === "dub") matches = matches.filter(m => m.hasDub);

    const targetNormJP = this._normalizeTitle(media.romajiTitle || q);
    const targetNorm = media.englishTitle ? this._normalizeTitle(media.englishTitle) : targetNormJP;
    const targetFormat = String((media.format || "")).toUpperCase();

    const exactTitle = m => m.normTitle === targetNorm || m.normTitleJP === targetNormJP;
    const looseTitle = m =>
      this._levenshteinSimilarity(m.normTitle, targetNorm) > 0.8 ||
      this._levenshteinSimilarity(m.normTitleJP, targetNormJP) > 0.8;
    const dateYM = m => m.startDate && m.startDate.year === targetYear && m.startDate.month === targetMonth;
    const dateY = m => m.startDate && m.startDate.year === targetYear;
    const exactFormat = m => !targetFormat || m.format === targetFormat;

    const tiers = [
      m => exactTitle(m) && dateYM(m) && exactFormat(m),
      m => exactTitle(m) && dateY(m) && exactFormat(m),
      m => looseTitle(m) && dateYM(m) && exactFormat(m),
      m => looseTitle(m) && dateY(m) && exactFormat(m)
    ];

    let filtered = [];
    if (targetYear) {
      for (const tier of tiers) {
        filtered = matches.filter(tier);
        if (filtered.length) break;
      }
    }

    if (!filtered.length) {
      filtered = matches.filter(m => {
        return m.normTitle === targetNorm || m.normTitleJP === targetNormJP ||
          m.normTitle.includes(targetNorm) || targetNorm.includes(m.normTitle) ||
          m.normTitleJP.includes(targetNormJP) || targetNormJP.includes(m.normTitleJP);
      });
      filtered.sort((a, b) => a.normTitle.length - b.normTitle.length);
    }

    if (!filtered.length) filtered = matches;

    const results = filtered.map(m => ({
      id: `${m.id}/${track}`,
      title: m.title,
      jname: m.titleJP || "",
      url: `${this.baseUrl}/detail/${m.slug}.${m.id}`,
      subOrDub: track,
      startDate: m.startDate
    }));

    this._cacheSet(this._cache.search, cacheKey, results);
    return results;
  }

  findEpisodes(Id) {
    const [id, trackRaw] = String(Id || "").split("/");
    const track = trackRaw === "dub" ? "dub" : "sub";
    if (!id) return [];

    const cacheKey = `${id}|${track}`;
    const cached = this._cacheGet(this._cache.episodes, cacheKey);
    if (cached !== undefined) return cached;

    const url = `${this.apiUrl}/shared/v2/episode/list?_movieId=${id}`;
    const data = this._fetchJson(url, this._headers(true));
    const groups = (data && data.result) || {};
    const episodes = [];

    for (const group of Object.values(groups)) {
      if (!Array.isArray(group)) continue;
      for (const ep of group) {
        const num = parseFloat(ep.number);
        if (!isFinite(num)) continue;
        episodes.push({
          id: `${id}/${track}`,
          number: num,
          title: this._clean(String(ep.name_english || ep.name || `Episode ${num}`)),
          url: ""
        });
      }
    }

    episodes.sort((a, b) => a.number - b.number);
    this._cacheSet(this._cache.episodes, cacheKey, episodes);
    return episodes;
  }

  findEpisodeServer(episodeObj, serverName) {
    let ep = episodeObj;
    if (typeof episodeObj === "string") { try { ep = JSON.parse(episodeObj); } catch { ep = {}; } }

    const [id, trackRaw] = String((ep && ep.id) || "").split("/");
    if (!id) throw new Error("Missing episode id in episodeObj");

    const track = trackRaw === "dub" ? "dub" : "sub";
    const preferred = String(serverName || "Southcloud-1").trim();
    const episodeNumber = parseFloat(ep.number);
    if (!isFinite(episodeNumber)) throw new Error("Missing episode number");

    const serverMap = {
      "Southcloud-1": 4,
      "Southcloud-2": 1,
      "Southcloud-3": 6
    };

    const sv = serverMap[preferred] != null ? serverMap[preferred] : 4;
    const sc = track === "dub" ? "dub" : "sub";

    const cacheKey = `src:${id}:${episodeNumber}:${sv}:${sc}`;
    const cached = this._cacheGet(this._cache.servers, cacheKey);
    if (cached !== undefined) return cached;

    const encUrl = `${this.apiUrl}/shared/v2/episode/sources?_movieId=${id}&ep=${episodeNumber}&sv=${sv}&sc=${sc}`;
    const json = this._fetchJson(encUrl, this._headers(true));
    const encryptedIframe = String((json && json.result && json.result.link) || "");
    if (!encryptedIframe) throw new Error(`No embed link returned from server '${preferred}'`);

    const resp = this._buildStreamResponse(encryptedIframe, preferred);
    if (!this._looksPlayable(resp)) throw new Error(`Server '${preferred}' returned no playable video sources`);

    this._cacheSet(this._cache.servers, cacheKey, resp);
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
    const idM = html.match(/<title>\s*File\s*[#]?([a-zA-Z0-9]+)/i);
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

module.exports = AniCrush;
