class AniCrush {
  constructor() {
    this.type = "anime-streaming";
    this.version = "1.0.0";
    this.baseUrl = "https://anicrush.to";
    this.apiUrl = "https://api.anicrush.to";
    this._cache = {
      dub: new Map(),
      dubEp: new Map(),
      search: new Map(),
      episodes: new Map(),
      servers: new Map(),
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
    if (Date.now() - e.t > this._cache._ttl) {
      map.delete(key);
      return undefined;
    }
    return e.v;
  }

  _cacheSet(map, key, value) {
    if (map.size >= this._cache._maxSize) {
      const entries = Array.from(map.entries()).sort((a, b) => a[1].t - b[1].t);
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
      const raw = Native.fetch(
        String(url),
        method || "GET",
        JSON.stringify(headers || {}),
        body == null ? "" : String(body)
      );
      let j = {};
      try { j = JSON.parse(raw || "{}"); } catch (_) { j = {}; }
      return {
        ok: !!j.ok,
        status: Number(j.status || 0),
        headers: j.headers || {},
        body: String(j.body || ""),
        error: String(j.error || ""),
        message: String(j.message || "")
      };
    } catch (e) {
      return {
        ok: false,
        status: 0,
        headers: {},
        body: "",
        error: "NATIVE_FETCH_FAIL",
        message: "" + e
      };
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
      return obj && typeof obj === "object" ? obj : {};
    } catch (_) {
      return {};
    }
  }

  _clean(str) {
    return String(str || "")
      .replace(/\\u0026/g, "&").replace(/&(?:amp|#38);/g, "&")
      .replace(/&quot;/g, '"').replace(/&(?:#39|apos);/g, "'")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(parseInt(n, 10)); });
  }

  _norm(title) {
    let s = String(title || "").toLowerCase();
    s = s.replace(/\b(season|cour|part|the|animation|movie|uncensored)\b/g, " ");
    s = s.replace(/\b(first|one)\b/g, "1");
    s = s.replace(/\b(second|two)\b/g, "2");
    s = s.replace(/\b(third|three)\b/g, "3");
    s = s.replace(/\b(fourth|four)\b/g, "4");
    s = s.replace(/\b(fifth|five)\b/g, "5");
    s = s.replace(/\b(\d+)(st|nd|rd|th)\b/g, function (_, n) { return n; });
    s = s.replace(/\biii\b/g, "3").replace(/\bii\b/g, "2").replace(/\biv\b/g, "4").replace(/\bv\b/g, "5");
    s = s.replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
    return s;
  }

  _normalizeTitle(title) {
    return this._norm(title).replace(/[^a-z0-9]+/g, "");
  }

  _tokenizeTitle(title) {
    const stop = {
      season: 1, cour: 1, part: 1, the: 1, animation: 1, movie: 1, uncensored: 1,
      tv: 1, ova: 1, ona: 1, special: 1, specials: 1
    };
    const s = this._norm(title);
    if (!s) return [];
    const tokens = s.split(/\s+/).filter(function (t) {
      if (!t || stop[t]) return false;
      if (/^\d+$/.test(t)) return false;
      return t.length >= 2;
    });
    return Array.from(new Set(tokens));
  }

  _variantNorms(title) {
    const base = this._normalizeTitle(title);
    const out = {};
    if (base) out[base] = true;

    if (base.indexOf("oshinoko") !== -1) out["mystar" + base.replace(/oshinoko/g, "")] = true;
    if (base.indexOf("mystar") !== -1) out["oshinoko" + base.replace(/mystar/g, "")] = true;

    if (base.indexOf("bokunoyabaiyatsu") !== -1) out["thedangersinmyheart" + base.replace(/bokunoyabaiyatsu/g, "")] = true;
    if (base.indexOf("thedangersinmyheart") !== -1) out["bokunoyabaiyatsu" + base.replace(/thedangersinmyheart/g, "")] = true;

    return Object.keys(out).filter(Boolean);
  }

  _levenshteinSimilarity(a, b) {
    a = String(a || "");
    b = String(b || "");
    const lenA = a.length;
    const lenB = b.length;
    if (!lenA && !lenB) return 1;
    if (!lenA || !lenB) return 0;

    const dp = Array.from({ length: lenA + 1 }, function () {
      return new Array(lenB + 1).fill(0);
    });

    for (let i = 0; i <= lenA; i++) dp[i][0] = i;
    for (let j = 0; j <= lenB; j++) dp[0][j] = j;

    for (let i = 1; i <= lenA; i++) {
      for (let j = 1; j <= lenB; j++) {
        if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
        else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }

    const maxLen = Math.max(lenA, lenB);
    return 1 - dp[lenA][lenB] / maxLen;
  }

  _parseArg(arg) {
    if (typeof arg === "string") {
      const s = arg.trim();
      try {
        return (s.startsWith("{") || s.startsWith("[")) ? JSON.parse(s) : { query: s };
      } catch (_) {
        return { query: s };
      }
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
    const months = { Jan:1, Feb:2, Mar:3, Apr:4, May:5, Jun:6, Jul:7, Aug:8, Sep:9, Oct:10, Nov:11, Dec:12 };
    const m = s.match(/([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})/);
    if (!m) return null;
    return {
      year: parseInt(m[3], 10) || 0,
      month: months[m[1]] || 0
    };
  }

  _resolveServerValue(preferred) {
    const serverMap = {
      "southcloud-1": 4,
      "southcloud-2": 1,
      "southcloud-3": 6
    };
    const key = String(preferred || "").toLowerCase().trim();
    const val = serverMap[key];
    return (val !== undefined && val !== null) ? val : 4;
  }

  _sameYear(date, year) {
    year = parseInt(year, 10) || 0;
    return !!(year && date && date.year === year);
  }

  _sameYearMonth(date, year, month) {
    year = parseInt(year, 10) || 0;
    month = parseInt(month, 10) || 0;
    return !!(year && month && date && date.year === year && date.month === month);
  }

  _tokenOverlap(aTokens, bTokens) {
    const set = {};
    for (let i = 0; i < aTokens.length; i++) set[aTokens[i]] = true;
    let hit = 0;
    for (let j = 0; j < bTokens.length; j++) {
      if (set[bTokens[j]]) hit++;
    }
    return hit;
  }

  _isStrongTitleMatch(movie, targetNorm, targetNormJP, targetTokens, targetTokensJP) {
    const candNorms = []
      .concat(this._variantNorms(movie.title))
      .concat(this._variantNorms(movie.titleJP));

    const targetNorms = []
      .concat(this._variantNorms(targetNorm))
      .concat(this._variantNorms(targetNormJP))
      .concat([targetNorm, targetNormJP])
      .filter(Boolean);

    for (let i = 0; i < candNorms.length; i++) {
      const cn = candNorms[i];
      if (!cn || cn.length < 2) continue;
      for (let j = 0; j < targetNorms.length; j++) {
        const tn = targetNorms[j];
        if (!tn || tn.length < 2) continue;

        if (cn === tn) return true;

        const minLen = Math.min(cn.length, tn.length);
        if (minLen >= 6 && (cn.indexOf(tn) !== -1 || tn.indexOf(cn) !== -1)) return true;

        if (minLen >= 6 && this._levenshteinSimilarity(cn, tn) >= 0.88) return true;
      }
    }

    const candTokens = movie.tokens || [];
    const candTokensJP = movie.tokensJP || [];
    if (this._tokenOverlap(candTokens, targetTokens) >= 2) return true;
    if (this._tokenOverlap(candTokens, targetTokensJP) >= 2) return true;
    if (this._tokenOverlap(candTokensJP, targetTokens) >= 2) return true;
    if (this._tokenOverlap(candTokensJP, targetTokensJP) >= 2) return true;

    return false;
  }

  _rankMatches(matches, targetNorm, targetNormJP, targetTokens, targetTokensJP, targetYear, targetMonth, targetFormat) {
    const self = this;
    return matches.map(function (m) {
      let score = 0;

      const candNorms = []
        .concat(self._variantNorms(m.title))
        .concat(self._variantNorms(m.titleJP));

      const targetNorms = []
        .concat(self._variantNorms(targetNorm))
        .concat(self._variantNorms(targetNormJP))
        .concat([targetNorm, targetNormJP])
        .filter(Boolean);

      let bestSim = 0;
      for (let i = 0; i < candNorms.length; i++) {
        const cn = candNorms[i];
        if (!cn) continue;
        for (let j = 0; j < targetNorms.length; j++) {
          const tn = targetNorms[j];
          if (!tn) continue;
          if (cn === tn) bestSim = Math.max(bestSim, 1);
          else bestSim = Math.max(bestSim, self._levenshteinSimilarity(cn, tn));
          if (cn.length >= 6 && tn.length >= 6 && (cn.indexOf(tn) !== -1 || tn.indexOf(cn) !== -1)) {
            bestSim = Math.max(bestSim, 0.96);
          }
        }
      }

      score += Math.round(bestSim * 1000);

      const overlap =
        Math.max(
          self._tokenOverlap(m.tokens || [], targetTokens || []),
          self._tokenOverlap(m.tokens || [], targetTokensJP || []),
          self._tokenOverlap(m.tokensJP || [], targetTokens || []),
          self._tokenOverlap(m.tokensJP || [], targetTokensJP || [])
        );
      score += overlap * 140;

      if (targetFormat && m.format === targetFormat) score += 60;
      if (self._sameYear(m.startDate, targetYear)) score += 80;
      if (self._sameYearMonth(m.startDate, targetYear, targetMonth)) score += 40;

      if (bestSim < 0.55) score -= 300;
      if (overlap === 0 && bestSim < 0.9) score -= 220;

      m._score = score;
      return m;
    }).sort(function (a, b) {
      return b._score - a._score;
    });
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

    const targetEnglish = String(media.englishTitle || q || "");
    const targetRomaji = String(media.romajiTitle || q || "");

    const targetNorm = this._normalizeTitle(targetEnglish);
    const targetNormJP = this._normalizeTitle(targetRomaji);
    const targetTokens = this._tokenizeTitle(targetEnglish);
    const targetTokensJP = this._tokenizeTitle(targetRomaji);
    const targetFormat = String(media.format || "").toUpperCase();

    const cacheKey = [
      q, track, targetYear, targetMonth, targetEnglish, targetRomaji, targetFormat
    ].join("|");

    const cached = this._cacheGet(this._cache.search, cacheKey);
    if (cached !== undefined) return cached;

    const url = this.apiUrl + "/shared/v2/movie/list?keyword=" + encodeURIComponent(q) + "&limit=48&page=1";
    const data = this._fetchJson(url, this._headers(true));
    const movies = (data && data.result && data.result.movies) || [];

    if (!movies.length) {
      this._cacheSet(this._cache.search, cacheKey, []);
      return [];
    }

    let matches = movies.map((movie) => {
      const en = this._clean(String(movie.name_english || movie.name || ""));
      const jp = this._clean(String(movie.name || ""));
      return {
        id: String(movie.id || ""),
        slug: String(movie.slug || ""),
        title: en,
        titleJP: jp,
        normTitle: this._normalizeTitle(en),
        normTitleJP: this._normalizeTitle(jp),
        tokens: this._tokenizeTitle(en),
        tokensJP: this._tokenizeTitle(jp),
        hasDub: !!movie.has_dub,
        startDate: this._normalizeDate(movie.aired_from),
        format: String(movie.type || "").toUpperCase()
      };
    });

    if (track === "dub") matches = matches.filter((m) => m.hasDub);

    let filtered = matches.filter((m) => this._isStrongTitleMatch(m, targetNorm, targetNormJP, targetTokens, targetTokensJP));

    if (targetFormat) {
      const byFormat = filtered.filter((m) => m.format === targetFormat);
      if (byFormat.length) filtered = byFormat;
    }

    if (targetYear) {
      const ym = filtered.filter((m) => this._sameYearMonth(m.startDate, targetYear, targetMonth));
      const y = filtered.filter((m) => this._sameYear(m.startDate, targetYear));

      if (ym.length) filtered = ym;
      else if (y.length) filtered = y;
    }

    filtered = this._rankMatches(filtered, targetNorm, targetNormJP, targetTokens, targetTokensJP, targetYear, targetMonth, targetFormat);

    if (!filtered.length && track !== "dub") {
      const rankedAll = this._rankMatches(matches, targetNorm, targetNormJP, targetTokens, targetTokensJP, targetYear, targetMonth, targetFormat);
      filtered = rankedAll.filter((m) => m._score >= 900);
    }

    if (!filtered.length) {
      this._cacheSet(this._cache.search, cacheKey, []);
      return [];
    }

    const results = filtered.slice(0, 12).map((m) => {
      return {
        id: m.id + "/" + track,
        title: m.title,
        jname: m.titleJP || "",
        url: this.baseUrl + "/detail/" + m.slug + "." + m.id,
        subOrDub: track,
        startDate: m.startDate
      };
    });

    this._cacheSet(this._cache.search, cacheKey, results);
    return results;
  }

  findEpisodes(Id) {
    const parts = String(Id || "").split("/");
    const id = parts[0];
    const trackRaw = parts[1];
    const track = trackRaw === "dub" ? "dub" : "sub";

    if (!id) return [];

    const cacheKey = id + "|" + track;
    const cached = this._cacheGet(this._cache.episodes, cacheKey);
    if (cached !== undefined) return cached;

    const url = this.apiUrl + "/shared/v2/episode/list?_movieId=" + id;
    const data = this._fetchJson(url, this._headers(true));
    const groups = (data && data.result) || {};
    const episodes = [];

    const values = Object.values(groups);
    for (let i = 0; i < values.length; i++) {
      const group = values[i];
      if (!Array.isArray(group)) continue;

      for (let j = 0; j < group.length; j++) {
        const ep = group[j];
        const numRaw = ep.number !== undefined ? ep.number : ep.num;
        const num = parseFloat(numRaw);
        if (!isFinite(num)) continue;

        episodes.push({
          id: id + "/" + track,
          number: num,
          title: this._clean(String(ep.name_english || ep.name || ("Episode " + num))),
          url: ""
        });
      }
    }

    episodes.sort(function (a, b) { return a.number - b.number; });
    this._cacheSet(this._cache.episodes, cacheKey, episodes);
    return episodes;
  }

  checkDubForEpisode(arg) {
    const obj = this._parseArg(arg);
    const animeIdRaw = String(obj.animeId || obj.id || "").trim();
    const animeId = animeIdRaw.split("/")[0];
    const episodeNumber = parseFloat(obj.episodeNumber !== undefined ? obj.episodeNumber : obj.number);

    if (!animeId || !isFinite(episodeNumber)) return false;

    const cacheKey = animeId + "|" + episodeNumber;
    const cached = this._cacheGet(this._cache.dubEp, cacheKey);
    if (cached !== undefined) return cached;

    try {
      const eps = this.findEpisodes(animeId + "/dub");
      const ok = eps.some(function (ep) { return Number(ep.number) === Number(episodeNumber); });
      this._cacheSet(this._cache.dubEp, cacheKey, ok);
      return ok;
    } catch (_) {
      this._cacheSet(this._cache.dubEp, cacheKey, false);
      return false;
    }
  }

  findEpisodeServer(episodeObj, serverName) {
    let ep = episodeObj;
    if (typeof episodeObj === "string") {
      try { ep = JSON.parse(episodeObj); } catch (_) { ep = {}; }
    }

    const rawId = String((ep && ep.id) || "");
    const parts = rawId.split("/");
    const id = parts[0];
    const trackRaw = parts[1];

    if (!id) throw new Error("Missing episode id in episodeObj");

    const track = trackRaw === "dub" ? "dub" : "sub";
    const sv = this._resolveServerValue(serverName);
    const sc = track;

    const episodeNumber = parseFloat(ep.number);
    if (!isFinite(episodeNumber)) throw new Error("Missing episode number");

    const epParam = String(episodeNumber);
    const cacheKey = "src:" + id + ":" + epParam + ":" + sv + ":" + sc;
    const cached = this._cacheGet(this._cache.servers, cacheKey);
    if (cached !== undefined) return cached;

    const encUrl = this.apiUrl + "/shared/v2/episode/sources?_movieId=" + id + "&ep=" + encodeURIComponent(epParam) + "&sv=" + sv + "&sc=" + sc;
    const json = this._fetchJson(encUrl, this._headers(true));
    const encryptedIframe = String((json && json.result && json.result.link) || "");

    if (!encryptedIframe) {
      throw new Error("No embed link returned from server (sv=" + sv + ", sc=" + sc + ")");
    }

    const resp = this._buildStreamResponse(encryptedIframe, serverName || "Southcloud-1");

    if (!this._looksPlayable(resp)) {
      throw new Error("Server sv=" + sv + " returned no playable video sources");
    }

    this._cacheSet(this._cache.servers, cacheKey, resp);
    return resp;
  }

  _looksPlayable(resp) {
    const vs = resp && resp.videoSources;
    if (!Array.isArray(vs) || !vs.length) return false;
    return vs.some(function (v) {
      return v && typeof v.url === "string" && v.url.length > 10;
    });
  }

  _buildStreamResponse(embed, serverName) {
    let decrypt;
    try {
      decrypt = this._extractMega(embed);
    } catch (e) {
      throw new Error("Stream extraction failed: " + e.message);
    }

    const srcs = Array.isArray(decrypt.sources) ? decrypt.sources : [];
    const stream =
      srcs.find(function (s) { return s && s.type === "hls" && s.file; }) ||
      srcs.find(function (s) { return s && s.file; });

    if (!stream || !stream.file) throw new Error("No stream file in embed response");

    const subs = (Array.isArray(decrypt.tracks) ? decrypt.tracks : [])
      .filter(function (t) { return t && t.kind === "captions" && t.file; })
      .map(function (t, i) {
        return {
          id: "sub-" + i,
          language: t.label || "Unknown",
          url: t.file,
          isDefault: !!t.default
        };
      });

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
    const base = u.protocol + "//" + u.host + "/";
    const headers = {
      "Accept": "*/*",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": base,
      "Origin": u.protocol + "//" + u.host,
      "User-Agent": "Mozilla/5.0"
    };

    const html = this._fetchText(url, headers);

    const idM = html.match(/<title>\s*File\s*[#]?([a-zA-Z0-9]+)/i);
    if (!idM) throw new Error("File ID not found in embed page");

    let nonce = (html.match(/\b[a-zA-Z0-9]{48}\b/) || [])[0];
    if (!nonce) {
      const parts = Array.from(html.matchAll(/["']([A-Za-z0-9]{16})["']/g));
      if (parts.length >= 3) nonce = parts[0][1] + parts[1][1] + parts[2][1];
    }
    if (!nonce) throw new Error("Nonce not found in embed page");

    const data = this._fetchJson(
      base + "embed-2/v3/e-1/getSources?id=" + idM[1] + "&_k=" + nonce,
      headers
    );

    return {
      sources: data.sources || [],
      tracks: data.tracks || [],
      intro: data.intro || null,
      outro: data.outro || null,
      headers: headers
    };
  }
}

module.exports = AniCrush;
