class AniWatchTV {
  constructor() {
    this.type = "anime-streaming";
    this.version = "1.0.1";
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

  stream() {
    return null;
  }

  _cacheGet(map, key) {
    var e = map.get(key);
    if (!e) return undefined;
    if (Date.now() - e.t > this._cache._ttl) {
      map.delete(key);
      return undefined;
    }
    return e.v;
  }

  _cacheSet(map, key, value) {
    if (map.size >= this._cache._maxSize) {
      var entries = Array.from(map.entries()).sort(function(a, b) {
        return a[1].t - b[1].t;
      });
      for (var i = 0; i < Math.ceil(entries.length * 0.3); i++) {
        map.delete(entries[i][0]);
      }
    }
    map.set(key, { v: value, t: Date.now() });
  }

  _nativeFetch(url, method, headers, body) {
    try {
      var raw = Native.fetch(
        String(url),
        method || "GET",
        JSON.stringify(headers || {}),
        body == null ? "" : String(body)
      );
      var j = {};
      try {
        j = JSON.parse(raw || "{}");
      } catch (_) {}
      return {
        ok: !!j.ok,
        status: Number(j.status || 0),
        body: String(j.body || "")
      };
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
    try {
      var o = JSON.parse(txt);
      return o && typeof o === "object" ? o : {};
    } catch (_) {
      return {};
    }
  }

  _parseArg(arg) {
    if (typeof arg === "string") {
      var s = arg.trim();
      try {
        return s[0] === "{" || s[0] === "[" ? JSON.parse(s) : { query: s };
      } catch (_) {
        return { query: s };
      }
    }
    return arg || {};
  }

  _getTrack(obj) {
    if (obj && obj.dub === true) return "dub";
    if (obj && obj.dub === false) return "sub";
    var t = String((obj && (obj.subOrDub || obj.track)) || "").toLowerCase();
    return t === "dub" || t === "sub" ? t : "sub";
  }

  _decodeHtml(str) {
    return String(str || "")
      .replace(/\\u0026/g, "&")
      .replace(/&#(\d+);?/g, function(_, d) {
        return String.fromCharCode(parseInt(d, 10));
      })
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  _normalize(title) {
    return String(title || "")
      .toLowerCase()
      .replace(/(season|cour|part|the animation|the movie|movie)/g, "")
      .replace(/\d+(st|nd|rd|th)/g, function(m) {
        return m.replace(/st|nd|rd|th/, "");
      })
      .replace(/\bii\b/g, "2")
      .replace(/\biii\b/g, "3")
      .replace(/\biv\b/g, "4")
      .replace(/\bv\b/g, "5")
      .replace(/[^a-z0-9]+/g, "");
  }

  _prefixSim(a, b) {
    a = String(a || "");
    b = String(b || "");
    if (!a || !b) return 0;
    if (a === b) return 1;

    var shorter = a.length <= b.length ? a : b;
    var longer = a.length <= b.length ? b : a;
    if (!shorter || !longer) return 0;

    var pfx = 0;
    while (pfx < shorter.length && shorter[pfx] === longer[pfx]) {
      pfx++;
    }

    return (pfx / shorter.length) * 0.7 + (shorter.length / longer.length) * 0.3;
  }

  _levenSim(a, b) {
    a = String(a || "");
    b = String(b || "");
    if (!a || !b) return 0;
    if (a === b) return 1;

    var la = a.length;
    var lb = b.length;
    var dp = [];

    for (var i = 0; i <= la; i++) {
      dp[i] = [];
      for (var j = 0; j <= lb; j++) {
        dp[i][j] = 0;
      }
    }

    for (var x = 0; x <= la; x++) dp[x][0] = x;
    for (var y = 0; y <= lb; y++) dp[0][y] = y;

    for (var r = 1; r <= la; r++) {
      for (var c = 1; c <= lb; c++) {
        if (a[r - 1] === b[c - 1]) {
          dp[r][c] = dp[r - 1][c - 1];
        } else {
          dp[r][c] = 1 + Math.min(dp[r - 1][c], dp[r][c - 1], dp[r - 1][c - 1]);
        }
      }
    }

    return 1 - dp[la][lb] / Math.max(la, lb);
  }

  _escapeRegex(str) {
    return String(str || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  _absoluteUrl(url) {
    url = String(url || "");
    if (!url) return "";
    if (url.indexOf("http://") === 0 || url.indexOf("https://") === 0) return url;
    if (url[0] === "/") return this.baseUrl + url;
    return this.baseUrl + "/" + url;
  }

  _originFromUrl(url) {
    var m = String(url || "").match(/^(https?:\/\/[^\/?#]+)/i);
    return m ? m[1] : "";
  }

  _parseSuggestHtml(html) {
    var results = [];
    var monthMap = {
      Jan: 1,
      Feb: 2,
      Mar: 3,
      Apr: 4,
      May: 5,
      Jun: 6,
      Jul: 7,
      Aug: 8,
      Sep: 9,
      Oct: 10,
      Nov: 11,
      Dec: 12
    };

    var re = /<a\b[^>]*class="[^"]*\bnav-item\b[^"]*"[^>]*href="\/([^"]+)"[^>]*>([\s\S]*?)<\/a>|<a\b[^>]*href="\/([^"]+)"[^>]*class="[^"]*\bnav-item\b[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
    var m;

    while ((m = re.exec(html)) !== null) {
      var pageUrl = m[1] || m[3] || "";
      var block = m[2] || m[4] || "";
      if (!pageUrl || pageUrl.indexOf("search?") === 0) continue;

      var jnameM = /data-jname="([^"]+)"/i.exec(block);
      var titleM = /<h3\b[^>]*class="[^"]*\bfilm-name\b[^"]*"[^>]*>([\s\S]*?)<\/h3>/i.exec(block);
      var dateM = /<span\b[^>]*>([^<]+)<\/span>/i.exec(block);
      var fmtM = block.match(/<\/i>\s*([^<\s][^<]*?)\s*<i/i);

      if (!titleM) continue;

      var jname = jnameM ? jnameM[1].trim() : "";
      var title = titleM[1].replace(/<[^>]+>/g, "").trim();
      var dateStr = dateM ? dateM[1].trim() : "";
      var format = fmtM ? fmtM[1].trim().toUpperCase() : "";

      var startDate = { year: 0, month: 0, day: 0 };
      var dm = dateStr.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);

      if (dm) {
        startDate = {
          year: parseInt(dm[3], 10),
          month: monthMap[dm[1]] || 0,
          day: parseInt(dm[2], 10)
        };
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
    var re = /<a\b[^>]*href="\/([^"]+)"[^>]*title="([^"]+)"[^>]*data-id="(\d+)"[^>]*>/g;
    var m;

    while ((m = re.exec(html)) !== null) {
      var pageUrl = m[1];
      var title = this._decodeHtml(m[2]);
      var id = m[3];

      var aroundStart = Math.max(0, m.index - 500);
      var aroundEnd = Math.min(html.length, m.index + 500);
      var around = html.substring(aroundStart, aroundEnd);
      var jnameM = /data-jname="([^"]+)"/i.exec(around);
      var jname = jnameM ? this._decodeHtml(jnameM[1]) : "";

      results.push({
        id: id,
        pageUrl: pageUrl,
        title: title,
        normTitle: this._normalize(title),
        normTitleJP: this._normalize(jname)
      });
    }

    return results;
  }

  search(arg) {
    arg = this._parseArg(arg);

    var q = String(arg.query || arg.title || arg.name || "").trim();
    if (!q) return [];

    var track = this._getTrack(arg);
    var media = arg.media || {};
    var start = media.startDate || {};

    var targetYear = parseInt(start.year, 10) || 0;
    var targetMonth = parseInt(start.month, 10) || 0;
    var targetFormat = String(media.format || "").toUpperCase();

    var targetNormJP = this._normalize(media.romajiTitle || media.nativeTitle || q);
    var targetNorm = media.englishTitle ? this._normalize(media.englishTitle) : targetNormJP;

    var cacheKey = [
      q,
      track,
      targetYear,
      targetMonth,
      targetFormat,
      targetNorm,
      targetNormJP
    ].join("|");

    var cached = this._cacheGet(this._cache.search, cacheKey);
    if (cached !== undefined) return cached;

    var ajaxHeaders = {
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": "Mozilla/5.0"
    };

    var self = this;

    var exactTitle = function(m) {
      return m.normTitle === targetNorm || m.normTitleJP === targetNormJP;
    };

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

    var dateYM = function(m) {
      return targetYear > 0 && targetMonth > 0 && m.startDate && m.startDate.year === targetYear && m.startDate.month === targetMonth;
    };

    var dateY = function(m) {
      return targetYear > 0 && m.startDate && m.startDate.year === targetYear;
    };

    var exactFmt = function(m) {
      if (!targetFormat) return true;
      if (!m.format) return true;
      return m.format === targetFormat;
    };

    var tiers = [
      function(m) { return exactTitle(m) && dateYM(m) && exactFmt(m); },
      function(m) { return exactTitle(m) && dateY(m) && exactFmt(m); },
      function(m) { return looseTitle(m) && dateYM(m) && exactFmt(m); },
      function(m) { return looseTitle(m) && dateY(m) && exactFmt(m); },
      function(m) { return exactTitle(m) && exactFmt(m); },
      function(m) { return looseTitle(m) && exactFmt(m); },
      function(m) { return looserTitle(m); }
    ];

    var filtered = [];
    var allMatches = [];
    var baseUrl = this.baseUrl + "/ajax/search/suggest?keyword=" + encodeURIComponent(q);

    for (var page = 1; page <= 7; page++) {
      var pageUrl = page === 1 ? baseUrl : baseUrl + "&page=" + page;
      var res = this._fetchJson(pageUrl, ajaxHeaders);
      var html = String(res.html || "");
      if (!html) break;

      var pageMatches = this._parseSuggestHtml(html);
      if (!pageMatches.length) break;

      for (var p = 0; p < pageMatches.length; p++) {
        allMatches.push(pageMatches[p]);
      }

      var hasLoose = false;
      for (var i = 0; i < pageMatches.length; i++) {
        if (looserTitle(pageMatches[i])) {
          hasLoose = true;
          break;
        }
      }

      if (!hasLoose && page > 1) break;
    }

    for (var t = 0; t < tiers.length; t++) {
      filtered = allMatches.filter(tiers[t]);
      if (filtered.length) break;
    }

    if (!filtered.length || !targetYear) {
      var searchUrl = this.baseUrl + "/search?keyword=" + encodeURIComponent(q);
      var searchHtml = this._fetchText(searchUrl, {
        "User-Agent": "Mozilla/5.0"
      });

      var searchMatches = this._parseSearchHtml(searchHtml);
      var normQ = this._normalize(q);

      filtered = searchMatches.filter(function(m) {
        return m.normTitle === normQ ||
          m.normTitleJP === normQ ||
          m.normTitle.indexOf(normQ) !== -1 ||
          m.normTitleJP.indexOf(normQ) !== -1 ||
          normQ.indexOf(m.normTitle) !== -1 ||
          normQ.indexOf(m.normTitleJP) !== -1 ||
          self._prefixSim(m.normTitle, normQ) > 0.5 ||
          self._prefixSim(m.normTitleJP, normQ) > 0.5 ||
          self._levenSim(m.normTitle, normQ) > 0.5 ||
          self._levenSim(m.normTitleJP, normQ) > 0.5;
      });

      filtered.sort(function(a, b) {
        if (a.normTitle.length !== b.normTitle.length) {
          return a.normTitle.length - b.normTitle.length;
        }
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

  findEpisodes(Id) {
    var parts = String(Id || "").split("/");
    var id = parts[0];
    var track = parts[1] === "dub" ? "dub" : "sub";

    if (!id) return [];

    var cacheKey = id + "|" + track;
    var cached = this._cacheGet(this._cache.episodes, cacheKey);
    if (cached !== undefined) return cached;

    var res = this._fetchJson(this.baseUrl + "/ajax/v2/episode/list/" + id, {
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": "Mozilla/5.0"
    });

    var html = String(res.html || "");
    if (!html) return [];

    var episodes = [];
    var re = /<a\b[^>]*class="[^"]*\bep-item\b[^"]*"[^>]*data-number="([^"]+)"[^>]*data-id="([^"]+)"[^>]*href="([^"]+)"[\s\S]*?<div\b[^>]*class="[^"]*\bep-name\b[^"]*"[^>]*title="([^"]+)"/g;
    var m;

    while ((m = re.exec(html)) !== null) {
      episodes.push({
        id: String(m[2]) + "/" + track,
        number: parseFloat(m[1]) || episodes.length + 1,
        url: this._absoluteUrl(m[3]),
        title: this._decodeHtml(m[4])
      });
    }

    if (!episodes.length) {
      var re2 = /<a\b[^>]*data-id="([^"]+)"[^>]*data-number="([^"]+)"[^>]*href="([^"]+)"[^>]*class="[^"]*\bep-item\b[^"]*"[\s\S]*?title="([^"]+)"/g;
      while ((m = re2.exec(html)) !== null) {
        episodes.push({
          id: String(m[1]) + "/" + track,
          number: parseFloat(m[2]) || episodes.length + 1,
          url: this._absoluteUrl(m[3]),
          title: this._decodeHtml(m[4])
        });
      }
    }

    episodes.sort(function(a, b) {
      return a.number - b.number;
    });

    this._cacheSet(this._cache.episodes, cacheKey, episodes);
    return episodes;
  }

  findEpisodeServer(episodeObj, serverName) {
    var ep = episodeObj;

    if (typeof episodeObj === "string") {
      try {
        ep = JSON.parse(episodeObj);
      } catch (_) {
        ep = { id: episodeObj };
      }
    }

    var rawId = String((ep && ep.id) || "");
    var parts = rawId.split("/");
    var id = parts[0];
    var track = parts[1] === "dub" ? "dub" : "sub";

    if (!id) throw new Error("Missing episode id");

    var server = serverName && serverName !== "default" ? String(serverName) : "VidSrc";
    var allowedTypes = track === "sub" ? ["sub", "raw"] : ["dub"];
    var cacheKey = "srv:" + id + ":" + track + ":" + server;

    var cached = this._cacheGet(this._cache.servers, cacheKey);
    if (cached !== undefined) return cached;

    var ajaxHeaders = {
      "Accept": "application/json, text/javascript, */*; q=0.01",
      "X-Requested-With": "XMLHttpRequest",
      "User-Agent": "Mozilla/5.0"
    };

    var serverRes = this._fetchJson(this.baseUrl + "/ajax/v2/episode/servers?episodeId=" + encodeURIComponent(id), ajaxHeaders);
    var serverHtml = String(serverRes.html || "");

    if (!serverHtml) throw new Error("No server HTML returned");

    var serverId = "";
    var serverLower = server.toLowerCase();
    var itemRe = /<div\b[^>]*class="[^"]*\bserver-item\b[^"]*"[^>]*>[\s\S]*?<\/div>/gi;
    var item;

    while ((item = itemRe.exec(serverHtml)) !== null) {
      var block = item[0];
      var typeM = /data-type="([^"]+)"/i.exec(block);
      var idM = /data-id="([^"]+)"/i.exec(block);
      var nameM = /<a\b[^>]*>\s*([\s\S]*?)\s*<\/a>/i.exec(block);

      if (!typeM || !idM || !nameM) continue;

      var type = String(typeM[1] || "").toLowerCase();
      var name = this._decodeHtml(nameM[1].replace(/<[^>]+>/g, "").trim()).toLowerCase();

      var typeOk = false;
      for (var i = 0; i < allowedTypes.length; i++) {
        if (type === allowedTypes[i]) {
          typeOk = true;
          break;
        }
      }

      if (typeOk && name === serverLower) {
        serverId = idM[1];
        break;
      }
    }

    if (!serverId) {
      var looseRe = new RegExp(
        '<div\\b[^>]*class="[^"]*\\bserver-item\\b[^"]*"[^>]*data-type="(' +
          allowedTypes.join("|") +
          ')"[^>]*data-id="([^"]+)"[^>]*>[\\s\\S]*?<a\\b[^>]*>\\s*' +
          this._escapeRegex(server) +
          '\\s*<\\/a>',
        "i"
      );

      var serverMatch = looseRe.exec(serverHtml);
      if (serverMatch) serverId = serverMatch[2];
    }

    if (!serverId) {
      throw new Error('Server "' + server + '" not found for track ' + track);
    }

    var sourcesRes = this._fetchJson(this.baseUrl + "/ajax/v2/episode/sources?id=" + encodeURIComponent(serverId), ajaxHeaders);
    var embedUrl = String(sourcesRes.link || "");

    if (!embedUrl) throw new Error("No embed link returned");

    var decryptData = this._extractMegaCloud(embedUrl);

    if (!decryptData || !decryptData.sources || !decryptData.sources.length) {
      var fallbackRes = this._fetchJson(
        "https://ac-api.ofchaos.com/api/anime/embed/convert/v2?embedUrl=" + encodeURIComponent(embedUrl),
        { "User-Agent": "Mozilla/5.0" }
      );

      if (fallbackRes && fallbackRes.sources) {
        decryptData = fallbackRes;
      }
    }

    if (!decryptData || !decryptData.sources || !decryptData.sources.length) {
      throw new Error("No sources from extractor");
    }

    var stream = null;

    for (var s = 0; s < decryptData.sources.length; s++) {
      if (decryptData.sources[s] && decryptData.sources[s].type === "hls" && decryptData.sources[s].file) {
        stream = decryptData.sources[s];
        break;
      }
    }

    if (!stream) {
      for (var s2 = 0; s2 < decryptData.sources.length; s2++) {
        if (decryptData.sources[s2] && decryptData.sources[s2].file) {
          stream = decryptData.sources[s2];
          break;
        }
      }
    }

    if (!stream || !stream.file) {
      throw new Error("No valid stream file found");
    }

    var subtitles = [];
    var tracks = decryptData.tracks || [];

    for (var tr = 0; tr < tracks.length; tr++) {
      var t = tracks[tr];
      if (t && t.kind === "captions" && t.file) {
        subtitles.push({
          id: "sub-" + tr,
          language: t.label || "Unknown",
          url: t.file,
          isDefault: !!t.default
        });
      }
    }

    var origin = this._originFromUrl(embedUrl) || "https://megacloud.club";
    var type = stream.type === "hls" || String(stream.file).indexOf(".m3u8") !== -1 ? "m3u8" : "mp4";

    var resp = {
      server: server,
      headers: {
        "Referer": origin + "/",
        "Origin": origin,
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36"
      },
      videoSources: [
        {
          url: stream.file,
          file: stream.file,
          type: type,
          quality: "auto",
          subtitles: subtitles
        }
      ],
      sources: [
        {
          url: stream.file,
          file: stream.file,
          type: type,
          quality: "auto"
        }
      ],
      subtitles: subtitles
    };

    this._cacheSet(this._cache.servers, cacheKey, resp);
    return resp;
  }

  _extractMegaCloud(embedUrl) {
    try {
      var origin = this._originFromUrl(embedUrl);
      if (!origin) return null;

      var base = origin + "/";
      var embedHeaders = {
        "Accept": "*/*",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": base,
        "Origin": origin,
        "User-Agent": "Mozilla/5.0 (Linux; Android 10; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36"
      };

      var html = this._fetchText(embedUrl, embedHeaders);
      if (!html) return null;

      var fileIdM = html.match(/<title>\s*File\s+#([a-zA-Z0-9]+)\s*-/i) ||
        html.match(/\/embed-2\/v\d+\/e-\d+\/([a-zA-Z0-9]+)/i) ||
        html.match(/data-id="([a-zA-Z0-9]+)"/i);

      if (!fileIdM) return null;

      var fileId = fileIdM[1];
      var nonce = null;
      var m48 = html.match(/\b[a-zA-Z0-9]{48}\b/);

      if (m48) {
        nonce = m48[0];
      } else {
        var parts = [];
        var re = /["']([A-Za-z0-9]{16})["']/g;
        var m;

        while ((m = re.exec(html)) !== null) {
          parts.push(m[1]);
        }

        if (parts.length >= 3) {
          nonce = parts[0] + parts[1] + parts[2];
        }
      }

      if (!nonce) return null;

      var data = this._fetchJson(
        base + "embed-2/v3/e-1/getSources?id=" + encodeURIComponent(fileId) + "&_k=" + encodeURIComponent(nonce),
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
      if (vs[i] && typeof vs[i].url === "string" && vs[i].url.length > 10) {
        return true;
      }
    }

    return false;
  }
}

module.exports = AniWatchTV;
