class AnimeKai {
  constructor() {
    this.type = "anime-streaming";
    this.version = "1.0.2";
    this.baseUrl = "https://animekai.to";
    this.altBaseUrl = "https://anikai.to";
    this.ua = "Mozilla/5.0 (Linux; Android 10; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
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
      episodeServers: ["default", "Hard Sub", "Soft Sub", "Dub & S-Sub"],
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
      var raw = Native.fetch(String(url), method || "GET", JSON.stringify(headers || {}), body == null ? "" : String(body));
      var j = {};
      try {
        j = JSON.parse(raw || "{}");
      } catch (_) {}
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
        error: "",
        message: String(e && e.message || e || "")
      };
    }
  }

  _headers(extra) {
    var h = {
      "User-Agent": this.ua,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
      "X-Requested-With": "XMLHttpRequest"
    };
    extra = extra || {};
    for (var k in extra) h[k] = extra[k];
    return h;
  }

  _fetchText(url, headers) {
    return String(this._nativeFetch(url, "GET", headers || this._headers(), "").body || "");
  }

  _fetchJson(url, headers) {
    var txt = this._fetchText(url, headers || this._headers()).replace(/^\uFEFF/, "").trim();
    if (!txt) return {};
    try {
      var o = JSON.parse(txt);
      return o && typeof o === "object" ? o : {};
    } catch (_) {
      return {};
    }
  }

  _postJson(url, headers, body) {
    var txt = String(this._nativeFetch(url, "POST", headers || this._headers({ "Content-Type": "application/json" }), body || "").body || "").replace(/^\uFEFF/, "").trim();
    if (!txt) return {};
    try {
      var o = JSON.parse(txt);
      return o && typeof o === "object" ? o : {};
    } catch (_) {
      return {};
    }
  }

  _apiJson(path) {
    var urls = [this.baseUrl + path, this.altBaseUrl + path];
    for (var i = 0; i < urls.length; i++) {
      var j = this._fetchJson(urls[i], this._headers({
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Referer": urls[i].replace(path, "/")
      }));
      if (j && Object.keys(j).length) return { json: j, base: urls[i].replace(path, "") };
    }
    return { json: {}, base: this.baseUrl };
  }

  _pageText(path) {
    var urls = [this.baseUrl + path, this.altBaseUrl + path];
    for (var i = 0; i < urls.length; i++) {
      var txt = this._fetchText(urls[i], this._headers({
        "Referer": urls[i].replace(path, "/")
      }));
      if (txt && txt.length > 100) return { text: txt, base: urls[i].replace(path, "") };
    }
    return { text: "", base: this.baseUrl };
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
      .replace(/&#x([0-9a-f]+);?/gi, function(_, d) {
        return String.fromCharCode(parseInt(d, 16));
      })
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  _stripTags(s) {
    return this._decodeHtml(String(s || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
  }

  _normalize(title) {
    return String(title || "")
      .toLowerCase()
      .replace(/(season|cour|part|the animation|the movie|movie|uncensored)/g, "")
      .replace(/\d+(st|nd|rd|th)/g, function(m) {
        return m.replace(/st|nd|rd|th/, "");
      })
      .replace(/\biii\b/g, "3")
      .replace(/\bii\b/g, "2")
      .replace(/\biv\b/g, "4")
      .replace(/\bv\b/g, "5")
      .replace(/[^a-z0-9]+/g, "");
  }

  _attrs(str) {
    var out = {};
    str = String(str || "");
    var re = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    var m;
    while ((m = re.exec(str)) !== null) {
      out[String(m[1]).toLowerCase()] = this._decodeHtml(m[2] || m[3] || m[4] || "");
    }
    return out;
  }

  _slugTitle(id) {
    var s = String(id || "").split("?")[0].split("#")[0];
    s = s.replace(/-[a-z0-9]{3,8}$/i, "");
    return s.replace(/-/g, " ").replace(/\b\w/g, function(c) {
      return c.toUpperCase();
    }).trim();
  }

  _prefixSim(a, b) {
    a = String(a || "");
    b = String(b || "");
    if (!a || !b) return 0;
    if (a === b) return 1;

    var shorter = a.length <= b.length ? a : b;
    var longer = a.length <= b.length ? b : a;
    var pfx = 0;

    while (pfx < shorter.length && shorter[pfx] === longer[pfx]) {
      pfx++;
    }

    return (pfx / shorter.length) * 0.7 + (shorter.length / longer.length) * 0.3;
  }

  _scoreTitle(candidate, targets) {
    var c = this._normalize(candidate);
    if (!c) return 0;

    var best = 0;

    for (var i = 0; i < targets.length; i++) {
      var t = this._normalize(targets[i]);
      if (!t) continue;

      if (c === t) {
        best = Math.max(best, 1000);
      } else if (c.indexOf(t) !== -1 || t.indexOf(c) !== -1) {
        best = Math.max(best, 850);
      } else {
        best = Math.max(best, Math.floor(this._prefixSim(c, t) * 700));
      }
    }

    return best;
  }

  _extractResultHtml(obj) {
    if (!obj) return "";
    if (typeof obj === "string") return obj;
    if (obj.html) return String(obj.html || "");

    if (obj.result) {
      if (typeof obj.result === "string") return String(obj.result || "");
      if (obj.result.html) return String(obj.result.html || "");
      if (obj.result.result) return this._extractResultHtml(obj.result);
    }

    if (obj.data) return this._extractResultHtml(obj.data);

    return "";
  }

  _parseSearchResults(html, track, targets) {
    var out = [];
    var seen = {};
    var itemRe = /<a\b([^>]*class=["'][^"']*\baitem\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
    var m;

    while ((m = itemRe.exec(html)) !== null) {
      var attrs = this._attrs(m[1]);
      var href = attrs.href || "";

      if (href.indexOf("/watch/") === -1) continue;

      var id = href.split("/watch/")[1].split("?")[0].replace(/^\/+|\/+$/g, "");

      if (!id || seen[id]) continue;

      var titleM = /class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\//i.exec(m[2]);
      var imgM = /<img\b[^>]*(?:alt|title)=["']([^"']+)["']/i.exec(m[2]);
      var title = titleM ? this._stripTags(titleM[1]) : imgM ? this._decodeHtml(imgM[1]) : attrs.title || this._slugTitle(id);

      if (!title || title.length > 120) title = this._slugTitle(id);

      seen[id] = true;

      out.push({
        id: id + "/" + track,
        title: title,
        jname: "",
        url: this.baseUrl + "/watch/" + id,
        subOrDub: track,
        _score: this._scoreTitle(title, targets)
      });
    }

    var anchorRe = /<a\b([^>]*href=["']\/watch\/([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi;

    while ((m = anchorRe.exec(html)) !== null) {
      var id2 = String(m[2] || "").split("?")[0].replace(/^\/+|\/+$/g, "");

      if (!id2 || seen[id2]) continue;

      var attrs2 = this._attrs(m[1]);
      var txt = this._stripTags(m[3]);
      var title2 = attrs2.title || attrs2["data-title"] || txt || this._slugTitle(id2);

      if (!title2 || title2.length > 120 || title2.toLowerCase() === "watch") {
        title2 = this._slugTitle(id2);
      }

      var score = this._scoreTitle(title2, targets);

      if (score < 250 && out.length > 0) continue;

      seen[id2] = true;

      out.push({
        id: id2 + "/" + track,
        title: title2,
        jname: "",
        url: this.baseUrl + "/watch/" + id2,
        subOrDub: track,
        _score: score
      });
    }

    out.sort(function(a, b) {
      return b._score - a._score;
    });

    return out.map(function(x) {
      delete x._score;
      return x;
    });
  }

  search(arg) {
    arg = this._parseArg(arg);

    var q = String(arg.query || arg.title || arg.name || "").trim();
    if (!q) return [];

    var track = this._getTrack(arg);
    var media = arg.media || {};
    var targets = [];

    if (media.englishTitle) targets.push(media.englishTitle);
    if (media.romajiTitle) targets.push(media.romajiTitle);
    if (media.nativeTitle) targets.push(media.nativeTitle);

    if (Array.isArray(media.altTitles)) {
      for (var i = 0; i < media.altTitles.length; i++) {
        targets.push(media.altTitles[i]);
      }
    }

    targets.push(q);

    var cacheKey = q + "|" + track + "|" + targets.join("|");
    var cached = this._cacheGet(this._cache.search, cacheKey);

    if (cached !== undefined) return cached;

    var paths = [
      "/ajax/anime/search?keyword=" + encodeURIComponent(q),
      "/ajax/search?keyword=" + encodeURIComponent(q),
      "/browser?keyword=" + encodeURIComponent(q)
    ];

    var results = [];

    for (var p = 0; p < paths.length; p++) {
      if (paths[p].indexOf("/ajax/") === 0) {
        var api = this._apiJson(paths[p]);
        var html = this._extractResultHtml(api.json);

        if (html) results = this._parseSearchResults(html, track, targets);
      } else {
        var page = this._pageText(paths[p]);

        if (page.text) results = this._parseSearchResults(page.text, track, targets);
      }

      if (results.length) break;
    }

    this._cacheSet(this._cache.search, cacheKey, results);
    return results;
  }

  _parseMediaId(mediaId) {
    var raw = String(mediaId || "").trim();
    var track = raw.toLowerCase().endsWith("/dub") ? "dub" : "sub";

    raw = raw.replace(/\/(sub|dub)$/i, "");

    return {
      id: raw,
      track: track
    };
  }

  _encdec(s, mode) {
    var endpoint = mode === "d" ? "dec-kai" : "enc-kai";
    var url = "https://enc-dec.app/api/" + endpoint + "?text=" + encodeURIComponent(String(s || ""));
    var json = this._fetchJson(url, this._headers({
      "Accept": "application/json, text/plain, */*",
      "Referer": "https://enc-dec.app/"
    }));

    return json && json.result !== undefined ? json.result : "";
  }

  _extractBookmarkId(html) {
    var m = /class=["'][^"']*\buser-bookmark\b[^"']*["'][^>]*data-id=["']([^"']+)["']/i.exec(html) ||
      /data-id=["']([^"']+)["'][^>]*class=["'][^"']*\buser-bookmark\b/i.exec(html);

    return m ? m[1] : "";
  }

  _parseEpisodesHtml(html, mediaId, track) {
    var out = [];
    var seen = {};
    var re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    var m;

    while ((m = re.exec(html)) !== null) {
      var attrs = this._attrs(m[1]);
      var token = attrs.token || attrs["data-token"] || "";
      var num = attrs.num || attrs["data-num"] || attrs["data-number"] || "";

      if (!token || !num) continue;
      if (seen[token]) continue;

      seen[token] = true;

      var n = parseFloat(num);

      if (!isFinite(n)) n = out.length + 1;

      var titleM = /<span\b[^>]*>([\s\S]*?)<\/span>/i.exec(m[2]);
      var title = titleM ? this._stripTags(titleM[1]) : this._stripTags(m[2]);

      out.push({
        id: mediaId + "|" + token + "/" + track,
        number: n,
        url: this.baseUrl + "/watch/" + mediaId + "?ep=" + n,
        title: title || "Episode " + n
      });
    }

    out.sort(function(a, b) {
      return a.number - b.number;
    });

    return out;
  }

  findEpisodes(Id) {
    var parsed = this._parseMediaId(Id);
    var mediaId = parsed.id;
    var track = parsed.track;

    if (!mediaId) return [];

    var cacheKey = mediaId + "|" + track;
    var cached = this._cacheGet(this._cache.episodes, cacheKey);

    if (cached !== undefined) return cached;

    var page = this._pageText("/watch/" + mediaId);
    var html = page.text;

    if (!html) return [];

    var bookmarkId = this._extractBookmarkId(html);
    var episodes = this._parseEpisodesHtml(html, mediaId, track);

    if (!episodes.length && bookmarkId) {
      var encId = this._encdec(bookmarkId, "e");

      if (encId) {
        var api = this._apiJson("/ajax/episodes/list?ani_id=" + encodeURIComponent(bookmarkId) + "&_=" + encodeURIComponent(encId));
        var epHtml = this._extractResultHtml(api.json);
        episodes = this._parseEpisodesHtml(epHtml, mediaId, track);
      }
    }

    this._cacheSet(this._cache.episodes, cacheKey, episodes);
    return episodes;
  }

  _parseEpisodeObj(episodeObj) {
    var ep = episodeObj;

    if (typeof episodeObj === "string") {
      try {
        ep = JSON.parse(episodeObj);
      } catch (_) {
        ep = { id: episodeObj };
      }
    }

    var raw = String((ep && ep.id) || "").trim();
    var track = raw.toLowerCase().endsWith("/dub") ? "dub" : "sub";

    raw = raw.replace(/\/(sub|dub)$/i, "");

    var parts = raw.split("|");

    return {
      mediaId: parts[0] || "",
      token: parts[1] || parts[0] || "",
      track: track,
      number: ep && ep.number
    };
  }

  _typeSuffix(type) {
    type = String(type || "").toLowerCase();

    if (type === "sub") return "Hard Sub";
    if (type === "softsub") return "Soft Sub";
    if (type === "dub") return "Dub & S-Sub";

    return type || "Unknown";
  }

  _parseServersHtml(html) {
    var out = [];
    var re = /<([a-z0-9]+)\b([^>]*class=["'][^"']*\bserver\b[^"']*["'][^>]*)>([\s\S]*?)<\/\1>/gi;
    var m;

    while ((m = re.exec(html)) !== null) {
      var attrs = this._attrs(m[2]);
      var lid = attrs["data-lid"] || attrs.lid || attrs.id || "";

      if (!lid) continue;

      var before = html.substring(Math.max(0, m.index - 1500), m.index);
      var type = "";
      var tRe = /data-id=["'](sub|softsub|dub)["']/gi;
      var tm;

      while ((tm = tRe.exec(before)) !== null) {
        type = tm[1];
      }

      var text = this._stripTags(m[3]);

      out.push({
        lid: lid,
        type: type,
        name: text || "Server",
        label: this._typeSuffix(type) + " - " + (text || "Server")
      });
    }

    return out;
  }

  _chooseServer(servers, serverName, track) {
    if (!servers || !servers.length) return null;

    var want = String(serverName || "").toLowerCase();
    var preferredTypes = track === "dub" ? ["dub"] : ["sub", "softsub"];

    if (want && want !== "default") {
      for (var i = 0; i < servers.length; i++) {
        var full = String(servers[i].label || servers[i].name || "").toLowerCase();

        if (full === want || full.indexOf(want) !== -1) return servers[i];
      }
    }

    for (var t = 0; t < preferredTypes.length; t++) {
      for (var j = 0; j < servers.length; j++) {
        if (servers[j].type === preferredTypes[t]) return servers[j];
      }
    }

    return servers[0];
  }

  _originFromUrl(url) {
    var m = String(url || "").match(/^(https?:\/\/[^\/?#]+)/i);
    return m ? m[1] : "";
  }

  _searchParam(url, key) {
    var q = String(url || "").split("?")[1] || "";
    q = q.split("#")[0];

    var parts = q.split("&");

    for (var i = 0; i < parts.length; i++) {
      var kv = parts[i].split("=");

      if (decodeURIComponent(kv[0] || "") === key) {
        return decodeURIComponent(kv.slice(1).join("=") || "");
      }
    }

    return "";
  }

  _normalizeTracks(tracks) {
    var out = [];

    if (!Array.isArray(tracks)) return out;

    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i] || {};
      var file = t.file || t.url || "";

      if (!file) continue;

      var kind = String(t.kind || "captions").toLowerCase();

      if (kind === "thumbnails") continue;

      out.push({
        id: "sub-" + i,
        language: t.label || t.lang || t.language || "Unknown",
        url: file,
        isDefault: !!t.default
      });
    }

    return out;
  }

  _extractMegaCloud(embedUrl) {
    try {
      var origin = this._originFromUrl(embedUrl);

      if (!origin) return null;

      var headers = this._headers({
        "Accept": "*/*",
        "Referer": origin + "/",
        "Origin": origin
      });

      var html = this._fetchText(embedUrl, headers);

      if (!html) return null;

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

      var idM = embedUrl.match(/\/e-\d+\/([^\/?#]+)/i) ||
        html.match(/<title>\s*File\s*#?([a-zA-Z0-9]+)\s*-/i) ||
        html.match(/data-id=["']([a-zA-Z0-9]+)["']/i);

      if (!nonce || !idM) return null;

      var sid = idM[1];
      var data = this._fetchJson(origin + "/embed-2/v3/e-1/getSources?id=" + encodeURIComponent(sid) + "&_k=" + encodeURIComponent(nonce), headers);

      if (data && data.sources && data.sources.length && data.sources[0].file && (!data.encrypted || String(data.sources[0].file).indexOf(".m3u8") !== -1)) {
        return {
          sources: data.sources,
          tracks: data.tracks || [],
          referer: origin + "/"
        };
      }

      var fallback = this._fetchJson("https://ac-api.ofchaos.com/api/anime/embed/convert/v2?embedUrl=" + encodeURIComponent(embedUrl), this._headers({
        "Accept": "application/json"
      }));

      if (fallback && fallback.sources && fallback.sources.length) return fallback;

      return null;
    } catch (e) {
      return null;
    }
  }

  _extractMegaUp(embedUrl) {
    try {
      var origin = this._originFromUrl(embedUrl);
      var mediaUrl = String(embedUrl).replace("/e/", "/media/");
      var media = this._fetchJson(mediaUrl, this._headers({
        "Accept": "application/json, text/plain, */*",
        "Referer": origin + "/",
        "Origin": origin
      }));

      var token = media.result || media.data || media.token || "";

      if (!token) return null;

      var decType = embedUrl.indexOf("://rapid") !== -1 ? "rapid" : "mega";
      var dec = this._postJson("https://enc-dec.app/api/dec-" + decType, {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": this.ua,
        "Referer": "https://enc-dec.app/"
      }, JSON.stringify({
        text: token,
        agent: this.ua
      }));

      var result = dec.result || dec;

      if (typeof result === "string") {
        try {
          result = JSON.parse(result);
        } catch (_) {}
      }

      if (!result || !result.sources || !result.sources.length) return null;

      var subList = this._searchParam(embedUrl, "sub.list");

      if (subList) {
        var subJson = this._fetchJson(subList, this._headers({
          "Accept": "*/*",
          "Referer": origin + "/",
          "Origin": origin
        }));

        if (Array.isArray(subJson)) result.tracks = subJson;
      }

      return {
        sources: result.sources,
        tracks: result.tracks || [],
        referer: origin + "/"
      };
    } catch (e) {
      return null;
    }
  }

  _extractEmbed(embedUrl) {
    var host = String(embedUrl || "").match(/^https?:\/\/([^\/?#]+)/i);
    host = host ? host[1].toLowerCase() : "";

    if (!host) return null;

    if (host.indexOf("megacloud") !== -1 || String(embedUrl).indexOf("/embed-2/") !== -1) {
      return this._extractMegaCloud(embedUrl);
    }

    if (/^(4spromax|megaup|rapidairmax|rapidshare)(\d+)?\.?/.test(host) || host.indexOf("megaup") !== -1 || host.indexOf("rapid") !== -1) {
      return this._extractMegaUp(embedUrl);
    }

    var fallback = this._fetchJson("https://ac-api.ofchaos.com/api/anime/embed/convert/v2?embedUrl=" + encodeURIComponent(embedUrl), this._headers({
      "Accept": "application/json"
    }));

    if (fallback && fallback.sources && fallback.sources.length) return fallback;

    return null;
  }

  findEpisodeServer(episodeObj, serverName) {
    var ep = this._parseEpisodeObj(episodeObj);

    if (!ep.token) throw new Error("Missing episode token");

    var cacheKey = "srv:" + ep.token + ":" + ep.track + ":" + String(serverName || "default");
    var cached = this._cacheGet(this._cache.servers, cacheKey);

    if (cached !== undefined) return cached;

    var encToken = this._encdec(ep.token, "e");

    if (!encToken) throw new Error("Could not encode episode token");

    var listApi = this._apiJson("/ajax/links/list?token=" + encodeURIComponent(ep.token) + "&_=" + encodeURIComponent(encToken));
    var serversHtml = this._extractResultHtml(listApi.json);
    var servers = this._parseServersHtml(serversHtml);

    if (!servers.length) throw new Error("No servers returned");

    var chosen = this._chooseServer(servers, serverName, ep.track);

    if (!chosen || !chosen.lid) throw new Error("No matching server");

    var encLid = this._encdec(chosen.lid, "e");

    if (!encLid) throw new Error("Could not encode server id");

    var viewApi = this._apiJson("/ajax/links/view?id=" + encodeURIComponent(chosen.lid) + "&_=" + encodeURIComponent(encLid));
    var encResult = viewApi.json && viewApi.json.result !== undefined ? viewApi.json.result : "";

    if (!encResult) throw new Error("No server link result");

    var dec = this._encdec(encResult, "d");

    if (typeof dec === "string") {
      try {
        dec = JSON.parse(dec);
      } catch (_) {}
    }

    var embedUrl = typeof dec === "string" ? dec : dec && dec.url ? dec.url : "";

    if (!embedUrl) throw new Error("No embed url");

    var extracted = this._extractEmbed(embedUrl);

    if (!extracted || !extracted.sources || !extracted.sources.length) {
      throw new Error("No extracted sources");
    }

    var stream = null;

    for (var i = 0; i < extracted.sources.length; i++) {
      var s = extracted.sources[i] || {};
      var file = s.file || s.url || "";

      if (file && (s.type === "hls" || String(file).indexOf(".m3u8") !== -1)) {
        stream = s;
        break;
      }
    }

    if (!stream) {
      for (var j = 0; j < extracted.sources.length; j++) {
        var s2 = extracted.sources[j] || {};

        if (s2.file || s2.url) {
          stream = s2;
          break;
        }
      }
    }

    if (!stream) throw new Error("No playable source");

    var url = stream.file || stream.url;
    var origin = this._originFromUrl(embedUrl);
    var subtitles = this._normalizeTracks(extracted.tracks || []);
    var type = String(url).indexOf(".mpd") !== -1 ? "mpd" : String(url).indexOf(".m3u8") !== -1 || stream.type === "hls" ? "m3u8" : "mp4";

    var resp = {
      server: chosen.label || chosen.name || "default",
      headers: {
        "Referer": extracted.referer || origin + "/",
        "Origin": origin,
        "User-Agent": this.ua
      },
      videoSources: [
        {
          url: url,
          file: url,
          type: type,
          quality: stream.quality || "auto",
          subtitles: subtitles
        }
      ],
      sources: [
        {
          url: url,
          file: url,
          type: type,
          quality: stream.quality || "auto"
        }
      ],
      subtitles: subtitles
    };

    this._cacheSet(this._cache.servers, cacheKey, resp);
    return resp;
  }

  _looksPlayable(resp) {
    var vs = resp && (resp.videoSources || resp.sources);

    if (!Array.isArray(vs) || !vs.length) return false;

    for (var i = 0; i < vs.length; i++) {
      if (vs[i] && typeof (vs[i].url || vs[i].file) === "string" && String(vs[i].url || vs[i].file).length > 10) {
        return true;
      }
    }

    return false;
  }
}

module.exports = AnimeKai;
