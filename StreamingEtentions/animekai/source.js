class AniWatchTV {
  constructor() {
    this.type = "anime-streaming";
    this.version = "1.0.0";
    this.baseUrl = "https://aniwatchtv.to";
    this._cache = {
      search: new Map(),
      episodes: new Map(),
      servers: new Map(),
      _maxSize: 200,
      _ttl: 8 * 60 * 1000
    };
  }

  getSettings() {
    return {
      episodeServers: ["VidSrc", "MegaCloud", "T-Cloud"],
      supportsSub: true,
      supportsDub: true,
      supportsHls: true,
      supportsPlayback: true
    };
  }

  stream() { return null; }

  // ── Cache ────────────────────────────────────────────────────────────────

  _cacheGet(map, key) {
    var e = map.get(key);
    if (!e) return undefined;
    if (Date.now() - e.t > this._cache._ttl) { map.delete(key); return undefined; }
    return e.v;
  }

  _cacheSet(map, key, value) {
    if (map.size >= this._cache._maxSize) {
      var entries = Array.from(map.entries()).sort(function(a, b) { return a[1].t - b[1].t; });
      for (var i = 0; i < Math.ceil(entries.length * 0.3); i++) map.delete(entries[i][0]);
    }
    map.set(key, { v: value, t: Date.now() });
  }

  // ── Native fetch ─────────────────────────────────────────────────────────

  _nativeFetch(url, method, headers, body) {
    try {
      var raw = Native.fetch(String(url), method || "GET", JSON.stringify(headers || {}), body == null ? "" : String(body));
      var j = {};
      try { j = JSON.parse(raw || "{}"); } catch (_) {}
      return { ok: !!j.ok, status: Number(j.status || 0), body: String(j.body || "") };
    } catch (e) {
      return { ok: false, status: 0, body: "" };
    }
  }

  _fetchText(url, headers) {
    return String(this._nativeFetch(url, "GET", headers || {}, "").body || "");
  }

  _fetchJson(url, headers) {
    var txt = this._fetchText(url, headers).replace(/^\uFEFF/, "").trim();
    if (!txt) return {};
    try { var o = JSON.parse(txt); return (o && typeof o === "object") ? o : {}; } catch (_) { return {}; }
  }

  // ── String helpers ────────────────────────────────────────────────────────

  _parseArg(arg) {
    if (typeof arg === "string") {
      var s = arg.trim();
      try { return (s[0] === "{" || s[0] === "[") ? JSON.parse(s) : { query: s }; } catch (_) { return { query: s }; }
    }
    return arg || {};
  }

  _getTrack(obj) {
    if (obj && obj.dub === true) return "dub";
    if (obj && obj.dub === false) return "sub";
    var t = String((obj && (obj.subOrDub || obj.track)) || "").toLowerCase();
    return (t === "dub" || t === "sub") ? t : "sub";
  }

  _decodeHtml(str) {
    return String(str || "")
      .replace(/\\u0026/g, "&")
      .replace(/&#(\d+);?/g, function(_, d) { return String.fromCharCode(parseInt(d, 10)); })
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  _normalize(title) {
    return String(title || "").toLowerCase()
      .replace(/(season|cour|part|the animation|the movie|movie)/g, "")
      .replace(/\d+(st|nd|rd|th)/g, function(m) { return m.replace(/st|nd|rd|th/, ""); })
      .replace(/[^a-z0-9]+/g, "")
      .replace(/(?<!i)ii(?!i)/g, "2");
  }

  _prefixSim(a, b) {
    var shorter = a.length <= b.length ? a : b;
    var longer  = a.length <= b.length ? b : a;
    var pfx = 0;
    while (pfx < shorter.length && shorter[pfx] === longer[pfx]) pfx++;
    return (pfx / shorter.length) * 0.7 + (shorter.length / longer.length) * 0.3;
  }

  _levenSim(a, b) {
    var la = a.length, lb = b.length;
    var dp = [];
    for (var i = 0; i <= la; i++) {
      dp[i] = [];
      for (var j = 0; j <= lb; j++) dp[i][j] = 0;
    }
    for (var i = 0; i <= la; i++) dp[i][0] = i;
    for (var j = 0; j <= lb; j++) dp[0][j] = j;
    for (var i = 1; i <= la; i++) {
      for (var j = 1; j <= lb; j++) {
        if (a[i-1] === b[j-1]) dp[i][j] = dp[i-1][j-1];
        else dp[i][j] = 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
      }
    }
    return 1 - dp[la][lb] / Math.max(la, lb);
  }

  // ── Search HTML parsers ───────────────────────────────────────────────────

  _parseSuggestHtml(html) {
    var results = [];
    var monthMap = { Jan:1, Feb:2, Mar:3, Apr:4, May:5, Jun:6, Jul:7, Aug:8, Sep:9, Oct:10, Nov:11, Dec:12 };
    // Match each nav-item block
    var re = /<a href="\/([^"]+)" class="nav-item">([\s\S]*?)<\/a>/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      var pageUrl = m[1];
      if (pageUrl.indexOf("search?") === 0) continue;
      var block = m[2];

      var jnameM = /data-jname="([^"]+)"/.exec(block);
      var titleM = /<h3 class="film-name"[^>]*>([^<]+)<\/h3>/.exec(block);
      var dateM  = /<span>([^<]+)<\/span>/.exec(block);
      var fmtM   = block.match(/<\/i>\s*([^<\s][^<]*?)\s*<i/);

      if (!titleM) continue;

      var jname = jnameM ? jnameM[1].trim() : "";
      var title = titleM[1].trim();
      var dateStr = dateM ? dateM[1].trim() : "";
      var format = fmtM ? fmtM[1].trim().toUpperCase() : "";

      var startDate = { year: 0, month: 0, day: 0 };
      var dm = dateStr.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
      if (dm) {
        startDate = { year: parseInt(dm[3], 10), month: monthMap[dm[1]] || 0, day: parseInt(dm[2], 10) };
      }

      var idM = pageUrl.match(/-(\d+)(?=$|\?)/);
      var id = idM ? idM[1] : pageUrl;

      results.push({
        id: id,
        pageUrl: pageUrl,
        title: this._decodeHtml(title),
        normTitle: this._normalize(this._decodeHtml(title)),
        normTitleJP: this._normalize(this._decodeHtml(jname)),
        startDate: startDate,
        format: format
      });
    }
    return results;
  }

  _parseSearchHtml(html) {
    var results = [];
    var re = /<a href="\/([^"]+)"[^>]+title="([^"]+)"[^>]+data-id="(\d+)"/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      var pageUrl = m[1], title = m[2], id = m[3];
      // Try to find jname
      var escapedUrl = pageUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      var jnameRe = new RegExp('data-jname="([^"]+)"[^>]*>[\\s\\S]{0,200}href="\\/' + escapedUrl, "i");
      var jnameM = jnameRe.exec(html);
      var jname = jnameM ? jnameM[1] : "";
      results.push({
        id: id,
        pageUrl: pageUrl,
        title: this._decodeHtml(title),
        normTitle: this._normalize(this._decodeHtml(title)),
        normTitleJP: this._normalize(this._decodeHtml(jname))
      });
    }
    return results;
  }

  // ── Search ────────────────────────────────────────────────────────────────

  search(arg) {
    arg = this._parseArg(arg);
    var q = String(arg.query || "").trim();
    if (!q) return [];

    var track = this._getTrack(arg);
    var media = arg.media || {};
    var start = media.startDate || {};
    var targetYear = parseInt(start.year, 10) || 0;
    var targetMonth = parseInt(start.month, 10) || 0;
    var targetFormat = String(media.format || "").toUpperCase();

    var targetNormJP = this._normalize(media.romajiTitle || q);
    var targetNorm = media.englishTitle ? this._normalize(media.englishTitle) : targetNormJP;

    var cacheKey = q + "|" + track + "|" + targetYear + "|" + targetMonth;
    var cached = this._cacheGet(this._cache.search, cacheKey);
    if (cached !== undefined) return cached;

    var ajaxHeaders = { "X-Requested-With": "XMLHttpRequest", "User-Agent": "Mozilla/5.0" };
    var isDub = track === "dub";
    var self = this;

    // Helper: tier matching
    var exactTitle = function(m) { return m.normTitle === targetNorm || m.normTitleJP === targetNormJP; };
    var looseTitle = function(m) {
      return self._prefixSim(m.normTitle, targetNorm) > 0.8 ||
             self._prefixSim(m.normTitleJP, targetNormJP) > 0.8 ||
             self._levenSim(m.normTitle, targetNorm) > 0.8 ||
             self._levenSim(m.normTitleJP, targetNormJP) > 0.8;
    };
    var looserTitle = function(m) {
      return m.normTitle.indexOf(targetNorm) !== -1 ||
             m.normTitleJP.indexOf(targetNormJP) !== -1 ||
             targetNorm.indexOf(m.normTitle) !== -1 ||
             targetNormJP.indexOf(m.normTitleJP) !== -1 ||
             self._prefixSim(m.normTitle, targetNorm) > 0.6 ||
             self._prefixSim(m.normTitleJP, targetNormJP) > 0.6;
    };
    var dateYM = function(m) { return m.startDate && m.startDate.year === targetYear && m.startDate.month === targetMonth; };
    var dateY  = function(m) { return m.startDate && m.startDate.year === targetYear; };
    var exactFmt = function(m) { return m.format === targetFormat; };

    var tiers = [
      function(m) { return exactTitle(m) && dateYM(m) && exactFmt(m); },
      function(m) { return exactTitle(m) && dateY(m) && exactFmt(m); },
      function(m) { return looseTitle(m) && dateYM(m) && exactFmt(m); },
      function(m) { return looseTitle(m) && dateY(m) && exactFmt(m); }
    ];

    var filtered = [];
    var baseUrl = this.baseUrl + "/ajax/search/suggest?keyword=" + encodeURIComponent(q);

    // Page through suggest results
    for (var page = 1; page <= 7; page++) {
      var pageUrl = page === 1 ? baseUrl : baseUrl + "&page=" + page;
      var res = this._fetchJson(pageUrl, ajaxHeaders);
      var html = String(res.html || "");
      if (!html) break;

      var pageMatches = this._parseSuggestHtml(html);
      if (!pageMatches.length) break;

      var hasLoose = false;
      for (var i = 0; i < pageMatches.length; i++) {
        if (looserTitle(pageMatches[i])) { hasLoose = true; break; }
      }
      if (!hasLoose) break;

      for (var t = 0; t < tiers.length; t++) {
        filtered = pageMatches.filter(tiers[t]);
        if (filtered.length) break;
      }
      if (filtered.length) break;
    }

    // Fallback: full search page if no startDate or nothing found
    if (!filtered.length || !targetYear) {
      var searchUrl = this.baseUrl + "/search?keyword=" + encodeURIComponent(q);
      var searchHtml = this._fetchText(searchUrl, { "User-Agent": "Mozilla/5.0" });
      var searchMatches = this._parseSearchHtml(searchHtml);

      var normQ = this._normalize(q);
      filtered = searchMatches.filter(function(m) {
        return m.normTitle === normQ ||
               m.normTitleJP === normQ ||
               self._prefixSim(m.normTitle, normQ) > 0.5 ||
               self._prefixSim(m.normTitleJP, normQ) > 0.5 ||
               self._levenSim(m.normTitle, normQ) > 0.5 ||
               self._levenSim(m.normTitleJP, normQ) > 0.5;
      });

      filtered.sort(function(a, b) {
        if (a.normTitle.length !== b.normTitle.length) return a.normTitle.length - b.normTitle.length;
        return a.normTitle < b.normTitle ? -1 : a.normTitle > b.normTitle ? 1 : 0;
      });
    }

    var baseUrl2 = this.baseUrl;
    var results = filtered.map(function(m) {
      return {
        id: m.id + "/" + track,
        title: m.title,
        url: baseUrl2 + "/" + m.pageUrl,
        subOrDub: track
      };
    });

    this._cacheSet(this._cache.search, cacheKey, results);
    return results;
  }

  // ── Episodes ──────────────────────────────────────────────────────────────

  findEpisodes(Id) {
    var parts = String(Id || "").split("/");
    var id = parts[0];
    var track = parts[1] === "dub" ? "dub" : "sub";
    if (!id) return [];

    var cacheKey = id + "|" + track;
    var cached = this._cacheGet(this._cache.episodes, cacheKey);
    if (cached !== undefined) return cached;

    var res = this._fetchJson(
      this.baseUrl + "/ajax/v2/episode/list/" + id,
      { "X-Requested-With": "XMLHttpRequest", "User-Agent": "Mozilla/5.0" }
    );

    var html = String(res.html || "");
    if (!html) return [];

    var episodes = [];
    var re = /<a[^>]*class="[^"]*\bep-item\b[^"]*"[^>]*data-number="(\d+)"[^>]*data-id="(\d+)"[^>]*href="([^"]+)"[\s\S]*?<div class="ep-name[^"]*"[^>]*title="([^"]+)"/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      episodes.push({
        id: m[2] + "/" + track,
        number: parseInt(m[1], 10),
        url: this.baseUrl + m[3],
        title: m[4]
      });
    }

    this._cacheSet(this._cache.episodes, cacheKey, episodes);
    return episodes;
  }

  // ── Episode server ────────────────────────────────────────────────────────

  findEpisodeServer(episodeObj, serverName) {
    var ep = episodeObj;
    if (typeof episodeObj === "string") {
      try { ep = JSON.parse(episodeObj); } catch (_) { ep = {}; }
    }

    var rawId = String((ep && ep.id) || "");
    var parts = rawId.split("/");
    var id = parts[0];
    var track = parts[1] === "dub" ? "dub" : "sub";
    if (!id) throw new Error("Missing episode id");

    var server = (serverName && serverName !== "default") ? serverName : "VidSrc";
    var allowedTypes = track === "sub" ? ["sub", "raw"] : ["dub"];
    var typePattern = allowedTypes.join("|");

    var cacheKey = "srv:" + id + ":" + track + ":" + server;
    var cached = this._cacheGet(this._cache.servers, cacheKey);
    if (cached !== undefined) return cached;

    var ajaxHeaders = { "X-Requested-With": "XMLHttpRequest", "User-Agent": "Mozilla/5.0" };

    // Fetch server list
    var serverRes = this._fetchJson(
      this.baseUrl + "/ajax/v2/episode/servers?episodeId=" + id,
      ajaxHeaders
    );
    var serverHtml = String(serverRes.html || "");
    if (!serverHtml) throw new Error("No server HTML returned");

    // Find matching server block
    var serverRe = new RegExp(
      '<div[^>]*class="item server-item"[^>]*data-type="(' + typePattern + ')"[^>]*data-id="(\\d+)"[^>]*>[\\s\\S]*?<a[^>]*>\\s*' + server.replace(/[-]/g, "[-]") + '\\s*<\\/a>',
      "i"
    );
    var serverMatch = serverRe.exec(serverHtml);
    if (!serverMatch) throw new Error('Server "' + server + '" not found for track ' + track);

    var serverId = serverMatch[2];

    // Fetch embed link
    var sourcesRes = this._fetchJson(
      this.baseUrl + "/ajax/v2/episode/sources?id=" + serverId,
      ajaxHeaders
    );
    var embedUrl = String(sourcesRes.link || "");
    if (!embedUrl) throw new Error("No embed link returned");

    // Try primary extractor (MegaCloud)
    var decryptData = this._extractMegaCloud(embedUrl);

    // Fallback to ShadeOfChaos API
    if (!decryptData || !decryptData.sources || !decryptData.sources.length) {
      var fallbackRes = this._fetchJson(
        "https://ac-api.ofchaos.com/api/anime/embed/convert/v2?embedUrl=" + encodeURIComponent(embedUrl),
        { "User-Agent": "Mozilla/5.0" }
      );
      if (fallbackRes && fallbackRes.sources) decryptData = fallbackRes;
    }

    if (!decryptData || !decryptData.sources || !decryptData.sources.length) {
      throw new Error("No sources from either extractor");
    }

    var stream = null;
    for (var i = 0; i < decryptData.sources.length; i++) {
      if (decryptData.sources[i].type === "hls" && decryptData.sources[i].file) { stream = decryptData.sources[i]; break; }
    }
    if (!stream) {
      for (var i = 0; i < decryptData.sources.length; i++) {
        if (decryptData.sources[i].file) { stream = decryptData.sources[i]; break; }
      }
    }
    if (!stream || !stream.file) throw new Error("No valid stream file found");

    var subtitles = [];
    var tracks = decryptData.tracks || [];
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      if (t.kind === "captions" && t.file) {
        subtitles.push({ id: "sub-" + i, language: t.label || "Unknown", url: t.file, isDefault: !!t.default });
      }
    }

    var resp = {
      server: server,
      headers: {
        "Referer": "https://megacloud.club/",
        "Origin": "https://megacloud.club",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36"
      },
      videoSources: [{
        url: stream.file,
        type: stream.type === "hls" ? "m3u8" : "mp4",
        quality: "auto",
        subtitles: subtitles
      }]
    };

    this._cacheSet(this._cache.servers, cacheKey, resp);
    return resp;
  }

  // ── MegaCloud extractor ───────────────────────────────────────────────────

  _extractMegaCloud(embedUrl) {
    try {
      var u = new URL(embedUrl);
      var base = u.protocol + "//" + u.host + "/";
      var embedHeaders = {
        "Accept": "*/*",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": base,
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36"
      };

      var html = this._fetchText(embedUrl, embedHeaders);
      if (!html) return null;

      // Extract file ID
      var fileIdM = html.match(/<title>\s*File\s+#([a-zA-Z0-9]+)\s*-/i);
      if (!fileIdM) return null;
      var fileId = fileIdM[1];

      // Extract nonce
      var nonce = null;
      var m48 = html.match(/\b[a-zA-Z0-9]{48}\b/);
      if (m48) {
        nonce = m48[0];
      } else {
        var parts = [];
        var re = /["']([A-Za-z0-9]{16})["']/g;
        var m;
        while ((m = re.exec(html)) !== null) parts.push(m[1]);
        if (parts.length >= 3) nonce = parts[0] + parts[1] + parts[2];
      }
      if (!nonce) return null;

      var data = this._fetchJson(
        base + "embed-2/v3/e-1/getSources?id=" + fileId + "&_k=" + nonce,
        embedHeaders
      );

      return {
        sources: data.sources || [],
        tracks: data.tracks || [],
        intro: data.intro || null,
        outro: data.outro || null
      };
    } catch (e) {
      return null;
    }
  }

  _looksPlayable(resp) {
    var vs = resp && resp.videoSources;
    if (!Array.isArray(vs) || !vs.length) return false;
    for (var i = 0; i < vs.length; i++) {
      if (vs[i] && typeof vs[i].url === "string" && vs[i].url.length > 10) return true;
    }
    return false;
  }
}

module.exports = AniWatchTV;
