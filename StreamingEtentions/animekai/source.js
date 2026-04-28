class AnimeKai {
  constructor() {
    this.type = "anime-streaming";
    this.version = "1.1.0-softsub";
    this.baseUrl = "https://animekai.to";
    this.altBaseUrl = "https://anikai.to";
    this.ua = "Mozilla/5.0 (Linux; Android 10; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
    this._searchCache = {};
    this._searchCacheTime = {};
    this._episodeCache = {};
    this._episodeCacheTime = {};
    this._serverCache = {};
    this._serverCacheTime = {};
    this._cacheTtl = 8 * 60 * 1000;
    this._cacheMax = 200;
    this._cacheKeys = [];
    console.log("[AnimeKai] constructor called, version=" + this.version);
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

  _cacheGet(store, timeStore, key) {
    var val = store[key];
    if (val === undefined) return undefined;
    var t = timeStore[key] || 0;
    if (Date.now() - t > this._cacheTtl) {
      delete store[key];
      delete timeStore[key];
      return undefined;
    }
    return val;
  }

  _cacheSet(store, timeStore, key, value) {
    var keys = Object.keys(store);
    if (keys.length >= this._cacheMax) {
      var oldest = keys[0];
      var oldestTime = timeStore[keys[0]] || 0;
      for (var i = 1; i < keys.length; i++) {
        var t = timeStore[keys[i]] || 0;
        if (t < oldestTime) { oldest = keys[i]; oldestTime = t; }
      }
      delete store[oldest];
      delete timeStore[oldest];
    }
    store[key] = value;
    timeStore[key] = Date.now();
  }

  _nativeFetch(url, method, headers, body) {
    console.log("[AnimeKai] _nativeFetch url=" + url + " method=" + (method || "GET"));
    try {
      var raw = Native.fetch(String(url), method || "GET", JSON.stringify(headers || {}), body == null ? "" : String(body));
      var j = {};
      try { j = JSON.parse(raw || "{}"); } catch (_) {}
      var status = Number(j.status || 0);
      var bodyLen = String(j.body || "").length;
      console.log("[AnimeKai] _nativeFetch DONE url=" + url + " status=" + status + " ok=" + j.ok + " bodyLen=" + bodyLen + (j.error ? " error=" + j.error : "") + (j.message ? " msg=" + j.message : ""));
      return {
        ok: !!j.ok,
        status: status,
        headers: j.headers || {},
        body: String(j.body || ""),
        error: String(j.error || ""),
        message: String(j.message || "")
      };
    } catch (e) {
      console.error("[AnimeKai] _nativeFetch EXCEPTION url=" + url + " err=" + e.message);
      return { ok: false, status: 0, headers: {}, body: "", error: "", message: String(e && e.message || e || "") };
    }
  }

  _headers(extra) {
    var h = {
      "User-Agent": this.ua,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "X-Requested-With": "XMLHttpRequest"
    };
    extra = extra || {};
    for (var k in extra) h[k] = extra[k];
    return h;
  }

  _fetchText(url, headers) {
    var result = this._nativeFetch(url, "GET", headers || this._headers(), "");
    var body = String(result.body || "");
    console.log("[AnimeKai] _fetchText url=" + url + " bodyLen=" + body.length + " status=" + result.status + " preview=" + body.substring(0, 120).replace(/\s+/g, " "));
    return body;
  }

  _fetchJson(url, headers) {
    var txt = this._fetchText(url, headers || this._headers()).replace(/^\uFEFF/, "").trim();
    if (!txt) {
      console.warn("[AnimeKai] _fetchJson empty body url=" + url);
      return {};
    }
    try {
      var o = JSON.parse(txt);
      var result = (o && typeof o === "object") ? o : {};
      console.log("[AnimeKai] _fetchJson url=" + url + " keys=" + Object.keys(result).join(","));
      return result;
    } catch (e) {
      console.warn("[AnimeKai] _fetchJson parse error url=" + url + " err=" + e.message + " preview=" + txt.substring(0, 80));
      return {};
    }
  }

  _postJson(url, headers, body) {
    console.log("[AnimeKai] _postJson url=" + url);
    var txt = String(this._nativeFetch(url, "POST", headers || this._headers({ "Content-Type": "application/json" }), body || "").body || "").replace(/^\uFEFF/, "").trim();
    if (!txt) {
      console.warn("[AnimeKai] _postJson empty response url=" + url);
      return {};
    }
    try {
      var o = JSON.parse(txt);
      var result = (o && typeof o === "object") ? o : {};
      console.log("[AnimeKai] _postJson url=" + url + " keys=" + Object.keys(result).join(","));
      return result;
    } catch (e) {
      console.warn("[AnimeKai] _postJson parse error url=" + url + " err=" + e.message);
      return {};
    }
  }

  _apiJson(path) {
    var urls = [this.altBaseUrl + path, this.baseUrl + path];
    for (var i = 0; i < urls.length; i++) {
      var base = urls[i].split("/ajax/")[0] || urls[i].split("/watch/")[0] || this.altBaseUrl;
      console.log("[AnimeKai] _apiJson trying url=" + urls[i]);
      var j = this._fetchJson(urls[i], this._headers({
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Referer": base + "/"
      }));
      if (j && Object.keys(j).length) {
        console.log("[AnimeKai] _apiJson SUCCESS url=" + urls[i] + " keys=" + Object.keys(j).join(","));
        return { json: j, base: base };
      }
      console.warn("[AnimeKai] _apiJson EMPTY url=" + urls[i]);
    }
    console.error("[AnimeKai] _apiJson ALL FAILED path=" + path);
    return { json: {}, base: this.altBaseUrl };
  }

  _unwrapPageHtml(txt) {
    // anikai.to/animekai.to wraps watch pages in a JSON envelope:
    // {"status":"ok","result":"<!DOCTYPE html>..."}
    // We must unwrap it before searching for anime IDs or episode tokens,
    // because JSON-escaped quotes (\") break every attribute regex.
    if (!txt || txt[0] !== '{') return txt;
    try {
      var parsed = JSON.parse(txt);
      // result can be the full HTML string
      if (parsed.result && typeof parsed.result === 'string' && parsed.result.length > 100) {
        console.log("[AnimeKai] _unwrapPageHtml: unwrapped JSON envelope, innerLen=" + parsed.result.length);
        return parsed.result;
      }
      // result could also be an object with an html key
      if (parsed.result && typeof parsed.result === 'object' && parsed.result.html) {
        console.log("[AnimeKai] _unwrapPageHtml: unwrapped JSON envelope (result.html)");
        return String(parsed.result.html);
      }
      // data field fallback
      if (parsed.data && typeof parsed.data === 'string' && parsed.data.length > 100) {
        console.log("[AnimeKai] _unwrapPageHtml: unwrapped JSON envelope (data field)");
        return parsed.data;
      }
    } catch (e) {
      console.warn("[AnimeKai] _unwrapPageHtml: JSON parse failed: " + e.message);
    }
    return txt;
  }

  _pageText(path) {
    var urls = [this.altBaseUrl + path, this.baseUrl + path];
    for (var i = 0; i < urls.length; i++) {
      var base = urls[i].split("/watch/")[0] || this.altBaseUrl;
      console.log("[AnimeKai] _pageText trying url=" + urls[i]);
      var raw = this._fetchText(urls[i], this._headers({ "Referer": base + "/" }));
      var txt = this._unwrapPageHtml(raw);
      if (txt && txt.length > 100) {
        console.log("[AnimeKai] _pageText SUCCESS url=" + urls[i] + " rawLen=" + raw.length + " unwrappedLen=" + txt.length);
        return { text: txt, base: base };
      }
      console.warn("[AnimeKai] _pageText EMPTY/SHORT url=" + urls[i] + " rawLen=" + raw.length);
    }
    console.error("[AnimeKai] _pageText ALL FAILED path=" + path);
    return { text: "", base: this.altBaseUrl };
  }

  _parseArg(arg) {
    if (typeof arg === "string") {
      var s = arg.trim();
      try { return s[0] === "{" || s[0] === "[" ? JSON.parse(s) : { query: s }; } catch (_) { return { query: s }; }
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
      .replace(/&#(\d+);?/g, function(_, d) { return String.fromCharCode(parseInt(d, 10)); })
      .replace(/&#x([0-9a-f]+);?/gi, function(_, d) { return String.fromCharCode(parseInt(d, 16)); })
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  }

  _stripTags(s) {
    return this._decodeHtml(String(s || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ").trim();
  }

  _normalize(title) {
    return String(title || "")
      .toLowerCase()
      .replace(/(season|cour|part|the animation|the movie|movie|uncensored)/g, "")
      .replace(/\d+(st|nd|rd|th)/g, function(m) { return m.replace(/st|nd|rd|th/, ""); })
      .replace(/\biii\b/g, "3").replace(/\bii\b/g, "2").replace(/\biv\b/g, "4").replace(/\bv\b/g, "5")
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
    return s.replace(/-/g, " ").replace(/\b\w/g, function(c) { return c.toUpperCase(); }).trim();
  }

  _prefixSim(a, b) {
    a = String(a || ""); b = String(b || "");
    if (!a || !b) return 0;
    if (a === b) return 1;
    var shorter = a.length <= b.length ? a : b;
    var longer = a.length <= b.length ? b : a;
    var pfx = 0;
    while (pfx < shorter.length && shorter[pfx] === longer[pfx]) pfx++;
    return (pfx / shorter.length) * 0.7 + (shorter.length / longer.length) * 0.3;
  }

  _scoreTitle(candidate, targets) {
    var c = this._normalize(candidate);
    if (!c) return 0;
    var best = 0;
    for (var i = 0; i < targets.length; i++) {
      var t = this._normalize(targets[i]);
      if (!t) continue;
      if (c === t) { best = Math.max(best, 1000); }
      else if (c.indexOf(t) !== -1 || t.indexOf(c) !== -1) { best = Math.max(best, 850); }
      else { best = Math.max(best, Math.floor(this._prefixSim(c, t) * 700)); }
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

    var itemRe = /<div\b[^>]*class=["'][^"']*\baitem\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
    var m;
    while ((m = itemRe.exec(html)) !== null) {
      var block = m[1];
      var hrefM = /href=["']([^"']*\/watch\/[^"'?#]+)[^"']*["']/i.exec(block);
      if (!hrefM) continue;
      var id = hrefM[1].split("/watch/")[1].split("?")[0].split("#")[0].replace(/^\/+|\/+$/g, "");
      if (!id || seen[id]) continue;

      var titleAttrM = /class=["'][^"']*\btitle\b[^"']*["'][^>]*title=["']([^"']+)["']/i.exec(block)
        || /title=["']([^"']+)["'][^>]*class=["'][^"']*\btitle\b/i.exec(block);
      var dataTitleM = /data-title=["']([^"']+)["']/i.exec(block);
      var altM = /alt=["']([^"']+)["']/i.exec(block);
      var spanM = /class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\//i.exec(block);

      var title = (titleAttrM && titleAttrM[1])
        || (dataTitleM && dataTitleM[1])
        || (altM && altM[1])
        || (spanM && this._stripTags(spanM[1]))
        || this._slugTitle(id);

      var altTitle = (dataTitleM && dataTitleM[1]) || "";

      seen[id] = true;
      var scoreTargets = targets.slice();
      if (altTitle && altTitle !== title) scoreTargets.push(altTitle);

      out.push({
        id: id + "/" + track,
        title: this._decodeHtml(title),
        jname: this._decodeHtml(altTitle),
        url: this.altBaseUrl + "/watch/" + id,
        subOrDub: track,
        _score: this._scoreTitle(title, scoreTargets)
      });
    }

    if (!out.length) {
      var anchorRe = /<a\b([^>]*href=["']\/watch\/([^"'?#]+)[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
      while ((m = anchorRe.exec(html)) !== null) {
        var id2 = String(m[2] || "").split("?")[0].replace(/^\/+|\/+$/g, "");
        if (!id2 || seen[id2]) continue;
        var attrs2 = this._attrs(m[1]);
        var txt = this._stripTags(m[3]);
        var title2 = attrs2.title || attrs2["data-title"] || txt || this._slugTitle(id2);
        if (!title2 || title2.length > 120 || title2.toLowerCase() === "watch") title2 = this._slugTitle(id2);
        var score = this._scoreTitle(title2, targets);
        if (score < 250 && out.length > 0) continue;
        seen[id2] = true;
        out.push({
          id: id2 + "/" + track,
          title: title2,
          jname: "",
          url: this.altBaseUrl + "/watch/" + id2,
          subOrDub: track,
          _score: score
        });
      }
    }

    out.sort(function(a, b) { return b._score - a._score; });
    return out.map(function(x) { delete x._score; return x; });
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
    if (media.altTitles && media.altTitles.length) {
      for (var i = 0; i < media.altTitles.length; i++) targets.push(media.altTitles[i]);
    }
    targets.push(q);

    var cacheKey = q + "|" + track + "|" + targets.join("|");
    var cached = this._cacheGet(this._searchCache, this._searchCacheTime, cacheKey);
    if (cached !== undefined) {
      console.log("[AnimeKai] search CACHE HIT q=" + q + " count=" + cached.length);
      return cached;
    }

    var paths = [
      "/ajax/anime/search?keyword=" + encodeURIComponent(q),
      "/ajax/search?keyword=" + encodeURIComponent(q),
      "/browser?keyword=" + encodeURIComponent(q)
    ];
    var results = [];
    for (var p = 0; p < paths.length; p++) {
      console.log("[AnimeKai] search trying path=" + paths[p] + " q=" + q + " track=" + track);
      if (paths[p].indexOf("/ajax/") === 0) {
        var api = this._apiJson(paths[p]);
        var html = this._extractResultHtml(api.json);
        console.log("[AnimeKai] search ajax htmlLen=" + html.length);
        if (html) results = this._parseSearchResults(html, track, targets);
      } else {
        var page = this._pageText(paths[p]);
        console.log("[AnimeKai] search page textLen=" + page.text.length);
        if (page.text) results = this._parseSearchResults(page.text, track, targets);
      }
      if (results.length) {
        console.log("[AnimeKai] search SUCCESS path=" + paths[p] + " results=" + results.length);
        break;
      }
    }

    console.log("[AnimeKai] search DONE q=" + q + " track=" + track + " results=" + results.length);
    this._cacheSet(this._searchCache, this._searchCacheTime, cacheKey, results);
    return results;
  }

  _parseMediaId(mediaId) {
    var raw = String(mediaId || "").trim();
    var track = raw.toLowerCase().endsWith("/dub") ? "dub" : "sub";
    raw = raw.replace(/\/(sub|dub)$/i, "");
    return { id: raw, track: track };
  }

  _encdec(s, mode) {
    var endpoint = mode === "d" ? "dec-kai" : "enc-kai";
    var text = String(s || "");
    if (!text) {
      console.warn("[AnimeKai] _encdec called with empty string mode=" + mode);
      return "";
    }
    console.log("[AnimeKai] _encdec START mode=" + mode + " input=" + text.substring(0, 40));
    if (mode === "d") {
      var post = this._postJson("https://enc-dec.app/api/" + endpoint, {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "User-Agent": this.ua,
        "Referer": "https://enc-dec.app/"
      }, JSON.stringify({ text: text }));
      if (post && post.result !== undefined) {
        console.log("[AnimeKai] _encdec decode result type=" + typeof post.result + " len=" + String(post.result).length);
        return post.result;
      }
      console.warn("[AnimeKai] _encdec decode no result keys=" + Object.keys(post).join(","));
    }
    var url = "https://enc-dec.app/api/" + endpoint + "?text=" + encodeURIComponent(text);
    var json = this._fetchJson(url, this._headers({
      "Accept": "application/json, text/plain, */*",
      "Referer": "https://enc-dec.app/"
    }));
    var result = json && json.result !== undefined ? json.result : "";
    if (!result) {
      console.error("[AnimeKai] _encdec FAILED mode=" + mode + " input=" + text.substring(0, 40) + " responseKeys=" + Object.keys(json).join(","));
    } else {
      console.log("[AnimeKai] _encdec SUCCESS mode=" + mode + " output=" + String(result).substring(0, 40));
    }
    return result;
  }

  _extractAnimeId(html) {
    html = String(html || "");

    var syncRe = /<script\b[^>]*id=["']syncData["'][^>]*>([\s\S]*?)<\/script>/i;
    var sync = html.match(syncRe);
    if (sync && sync[1]) {
      var txt = this._decodeHtml(sync[1]).trim();
      try {
        var obj = JSON.parse(txt);
        var id = String(obj.anime_id || obj.ani_id || obj.animeId || obj.id || "");
        if (id && /^\d+$/.test(id)) {
          console.log("[AnimeKai] _extractAnimeId found via syncData id=" + id);
          return id;
        }
      } catch (e) {
        console.warn("[AnimeKai] _extractAnimeId syncData parse error: " + e.message);
      }
    }

    var inlinePatterns = [
      /window\.__DATA__\s*=\s*\{[^}]*["']?(?:anime_id|ani_id)["']?\s*:\s*["']?(\d+)["']?/i,
      /["']anime_id["']\s*:\s*["']?(\d+)["']?/i,
      /["']ani_id["']\s*:\s*["']?(\d+)["']?/i,
      /data-ani-id=["'](\d+)["']/i,
      /data-id=["'](\d+)["'][^>]*class=["'][^"']*rate-box/i,
      /class=["'][^"']*rate-box[^"']*["'][^>]*data-id=["'](\d+)["']/i,
      /\bani_id\s*=\s*(\d+)/,
      /\banime_id\s*=\s*(\d+)/,
      /\baniId\s*=\s*(\d+)/,
      /"id"\s*:\s*(\d+)/
    ];

    for (var i = 0; i < inlinePatterns.length; i++) {
      var m = html.match(inlinePatterns[i]);
      if (m && m[1] && /^\d+$/.test(m[1])) {
        console.log("[AnimeKai] _extractAnimeId found via pattern[" + i + "] id=" + m[1]);
        return m[1];
      }
    }

    console.error("[AnimeKai] _extractAnimeId FAILED - no anime ID found in HTML (htmlLen=" + html.length + ")");
    // Log a snippet of the HTML to check what we got
    var snippet = html.substring(0, 500).replace(/\s+/g, " ");
    console.log("[AnimeKai] _extractAnimeId HTML snippet: " + snippet);
    return "";
  }

  _parseEpisodesHtml(html, mediaId, track) {
    var out = [];
    var seen = {};
    var totalAnchors = 0;
    var tokenMissing = 0;
    var numMissing = 0;
    var langFiltered = 0;
    var re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    var m;
    while ((m = re.exec(html)) !== null) {
      totalAnchors++;
      var attrs = this._attrs(m[1]);
      var token = attrs.token || attrs["data-token"] || "";
      var num = attrs.num || attrs["data-num"] || attrs["data-number"] || "";
      var slug = attrs.slug || attrs["data-slug"] || "";

      if (!token) { tokenMissing++; continue; }
      if (!num) { numMissing++; continue; }
      if (seen[token]) continue;

      var langs = String(attrs.langs || attrs["data-langs"] || "");
      if (langs && /^\d+$/.test(langs)) {
        var bits = parseInt(langs, 10);
        var hasSub = !!(bits & 1);
        var hasDub = !!(bits & 2);
        if (track === "sub" && !hasSub) { langFiltered++; continue; }
        if (track === "dub" && !hasDub) { langFiltered++; continue; }
      }

      seen[token] = true;
      var n = parseFloat(num);
      if (!isFinite(n)) n = out.length + 1;

      var titleM = /<span\b[^>]*>([\s\S]*?)<\/span>/i.exec(m[2]);
      var title = titleM ? this._stripTags(titleM[1]) : this._stripTags(m[2]);

      out.push({
        id: mediaId + "|" + token + "/" + track,
        number: n,
        url: this.altBaseUrl + "/watch/" + mediaId + (slug ? "?ep=" + encodeURIComponent(slug) : "?ep=" + n),
        title: title || "Episode " + n
      });
    }

    console.log("[AnimeKai] _parseEpisodesHtml mediaId=" + mediaId + " track=" + track +
      " htmlLen=" + html.length +
      " totalAnchors=" + totalAnchors +
      " tokenMissing=" + tokenMissing +
      " numMissing=" + numMissing +
      " langFiltered=" + langFiltered +
      " parsed=" + out.length);

    if (out.length === 0 && html.length > 0) {
      // Log a snippet of what we got to understand the structure
      var snippet = html.substring(0, 600).replace(/\s+/g, " ");
      console.warn("[AnimeKai] _parseEpisodesHtml zero results snippet: " + snippet);
    }

    out.sort(function(a, b) { return a.number - b.number; });
    return out;
  }

  findEpisodes(Id) {
    console.log("[AnimeKai] findEpisodes START Id=" + Id);
    var parsed = this._parseMediaId(Id);
    var mediaId = parsed.id;
    var track = parsed.track;

    console.log("[AnimeKai] findEpisodes mediaId=" + mediaId + " track=" + track);

    if (!mediaId) {
      console.error("[AnimeKai] findEpisodes ABORT: empty mediaId");
      return [];
    }

    var cacheKey = mediaId + "|" + track;
    var cached = this._cacheGet(this._episodeCache, this._episodeCacheTime, cacheKey);
    if (cached !== undefined) {
      console.log("[AnimeKai] findEpisodes CACHE HIT count=" + cached.length);
      return cached;
    }

    console.log("[AnimeKai] findEpisodes fetching watch page /watch/" + mediaId);
    var page = this._pageText("/watch/" + mediaId);
    var html = page.text;

    if (!html) {
      console.error("[AnimeKai] findEpisodes FAILED: empty page for mediaId=" + mediaId);
      return [];
    }

    console.log("[AnimeKai] findEpisodes page htmlLen=" + html.length);

    var animeId = this._extractAnimeId(html);
    console.log("[AnimeKai] findEpisodes animeId=" + animeId);

    var episodes = [];

    if (animeId) {
      var encId = this._encdec(animeId, "e");
      console.log("[AnimeKai] findEpisodes encId=" + encId);

      if (encId) {
        var ajaxPaths = [
          "/ajax/episodes/list?ani_id=" + encodeURIComponent(animeId) + "&_=" + encodeURIComponent(encId),
          "/ajax/episode/list?ani_id=" + encodeURIComponent(animeId) + "&_=" + encodeURIComponent(encId),
          "/ajax/anime/episodes?ani_id=" + encodeURIComponent(animeId) + "&_=" + encodeURIComponent(encId)
        ];
        for (var a = 0; a < ajaxPaths.length; a++) {
          console.log("[AnimeKai] findEpisodes trying ajax path=" + ajaxPaths[a]);
          var api = this._apiJson(ajaxPaths[a]);
          var epHtml = this._extractResultHtml(api.json);
          console.log("[AnimeKai] findEpisodes ajax path=" + ajaxPaths[a] + " htmlLen=" + epHtml.length + " jsonKeys=" + Object.keys(api.json).join(","));
          if (epHtml) {
            episodes = this._parseEpisodesHtml(epHtml, mediaId, track);
            if (episodes.length) {
              console.log("[AnimeKai] findEpisodes SUCCESS via ajax[" + a + "] count=" + episodes.length);
              break;
            }
          }
        }
      } else {
        console.error("[AnimeKai] findEpisodes enc-dec returned empty for animeId=" + animeId);
      }
    } else {
      console.warn("[AnimeKai] findEpisodes no animeId extracted - skipping AJAX, trying fallback patterns");
    }

    if (!episodes.length) {
      console.log("[AnimeKai] findEpisodes trying fallback rate-box patterns");
      var fbPatterns = [
        /class=["'][^"']*rate-box[^"']*["'][^>]*data-id=["']([^"']+)["']/i,
        /data-id=["']([^"']+)["'][^>]*class=["'][^"']*rate-box/i,
        /data-ani-id=["']([^"']+)["']/i
      ];
      for (var pi = 0; pi < fbPatterns.length; pi++) {
        var fbM = html.match(fbPatterns[pi]);
        if (fbM && fbM[1] && fbM[1] !== animeId) {
          var fbId = fbM[1];
          console.log("[AnimeKai] findEpisodes fallback pattern[" + pi + "] fbId=" + fbId);
          var fbEnc = this._encdec(fbId, "e");
          console.log("[AnimeKai] findEpisodes fallback fbEnc=" + fbEnc);
          if (fbEnc) {
            var fbApi = this._apiJson("/ajax/episodes/list?ani_id=" + encodeURIComponent(fbId) + "&_=" + encodeURIComponent(fbEnc));
            var fbHtml = this._extractResultHtml(fbApi.json);
            console.log("[AnimeKai] findEpisodes fallback fbHtmlLen=" + fbHtml.length);
            if (fbHtml) {
              episodes = this._parseEpisodesHtml(fbHtml, mediaId, track);
              if (episodes.length) {
                console.log("[AnimeKai] findEpisodes SUCCESS via fallback pattern[" + pi + "] count=" + episodes.length);
                break;
              }
            }
          }
        }
      }
    }

    if (!episodes.length) {
      console.warn("[AnimeKai] findEpisodes trying inline HTML parse on watch page");
      episodes = this._parseEpisodesHtml(html, mediaId, track);
      console.log("[AnimeKai] findEpisodes inline parse count=" + episodes.length);
    }

    if (!episodes.length) {
      console.error("[AnimeKai] findEpisodes FINAL RESULT: 0 episodes for mediaId=" + mediaId + " track=" + track);
    } else {
      console.log("[AnimeKai] findEpisodes FINAL RESULT: count=" + episodes.length + " first=" + JSON.stringify(episodes[0]));
    }

    this._cacheSet(this._episodeCache, this._episodeCacheTime, cacheKey, episodes);
    return episodes;
  }

  _parseEpisodeObj(episodeObj) {
    var ep = episodeObj;
    if (typeof episodeObj === "string") {
      try { ep = JSON.parse(episodeObj); } catch (_) { ep = { id: episodeObj }; }
    }
    var raw = String((ep && ep.id) || "").trim();
    var track = raw.toLowerCase().endsWith("/dub") ? "dub" : "sub";
    raw = raw.replace(/\/(sub|dub)$/i, "");
    var parts = raw.split("|");
    return { mediaId: parts[0] || "", token: parts[1] || parts[0] || "", track: track, number: ep && ep.number };
  }

  _typeSuffix(type) {
    type = String(type || "").toLowerCase();
    if (type === "sub") return "Hard Sub";
    if (type === "softsub") return "Soft Sub";
    if (type === "dub") return "Dub & S-Sub";
    return type || "Unknown";
  }

  _parseServersHtml(html) {
    // Log full HTML for debugging (capped at 2000 chars)
    console.log("[AnimeKai] _parseServersHtml RAW HTML (len=" + html.length + "): " + html.substring(0, 2000).replace(/\s+/g, " "));

    var out = [];

    // Based on the TypeScript reference extension, the structure is:
    // <div class="server-items lang-group" data-id="sub">
    //   <span class="server" data-lid="xxx">Server 1</span>
    // </div>
    // Extract each lang group first, then find servers within each.
    var types = ["sub", "softsub", "dub"];

    for (var t = 0; t < types.length; t++) {
      var typeId = types[t];
      // Match the lang group div for this type
      var groupPattern = 'data-id=["\']' + typeId + '["\']';
      var groupIdx = html.search(new RegExp(groupPattern, 'i'));
      if (groupIdx === -1) {
        console.log("[AnimeKai] _parseServersHtml no group found for type=" + typeId);
        continue;
      }
      // Find the end of this section (next server-items div or end of html)
      var groupStart = groupIdx;
      var nextGroupIdx = html.indexOf('server-items', groupIdx + groupPattern.length);
      var groupHtml = nextGroupIdx === -1
        ? html.substring(groupStart)
        : html.substring(groupStart, nextGroupIdx);

      console.log("[AnimeKai] _parseServersHtml type=" + typeId + " groupHtml=" + groupHtml.substring(0, 300).replace(/\s+/g, " "));

      // Find all <span class="server" data-lid="..."> within this group
      // Also try <a class="server" ...> or any element with data-lid
      var lidPattern = /data-lid=["']([^"']+)["']/gi;
      var namePattern = />([^<]+)<\//;
      var m;
      // Find all data-lid occurrences in this group section
      var lidRe = /data-lid=["']([^"']+)["'][^>]*(?:data-sid=["']([^"']*)")?[^>]*>([^<]*)</gi;
      while ((m = lidRe.exec(groupHtml)) !== null) {
        var lid = m[1];
        if (!lid) continue;
        var name = (m[3] || "Server").trim() || "Server";
        out.push({
          lid: lid,
          sid: m[2] || "",
          eid: "",
          type: typeId,
          name: name,
          label: this._typeSuffix(typeId) + " - " + name
        });
        console.log("[AnimeKai] _parseServersHtml found server lid=" + lid + " name=" + name + " type=" + typeId);
      }

      if (out.filter(function(s) { return s.type === typeId; }).length === 0) {
        // Fallback: look for any element with data-lid in this group
        var fallbackRe = /data-lid=["']([^"']+)["']/gi;
        while ((m = fallbackRe.exec(groupHtml)) !== null) {
          var lid2 = m[1];
          if (!lid2 || out.some(function(s) { return s.lid === lid2; })) continue;
          out.push({
            lid: lid2, sid: "", eid: "", type: typeId,
            name: "Server", label: this._typeSuffix(typeId) + " - Server"
          });
          console.log("[AnimeKai] _parseServersHtml fallback server lid=" + lid2 + " type=" + typeId);
        }
      }
    }

    // If still nothing, try a global search for data-lid anywhere
    if (!out.length) {
      console.warn("[AnimeKai] _parseServersHtml no typed groups found, trying global data-lid search");
      var globalRe = /data-lid=["']([^"']+)["']/gi;
      var m2;
      while ((m2 = globalRe.exec(html)) !== null) {
        var lid3 = m2[1];
        if (out.some(function(s) { return s.lid === lid3; })) continue;
        out.push({ lid: lid3, sid: "", eid: "", type: "sub", name: "Server", label: "Hard Sub - Server" });
        console.log("[AnimeKai] _parseServersHtml global fallback lid=" + lid3);
      }
    }

    console.log("[AnimeKai] _parseServersHtml FINAL found=" + out.length + " servers=" + out.map(function(s) { return s.label + "(lid=" + s.lid + ")"; }).join(", "));
    return out;
  }

  _chooseServer(servers, serverName, track) {
    if (!servers || !servers.length) return null;
    var want = String(serverName || "").toLowerCase().replace(/\s+/g, "-");
    var preferredTypes = track === "dub" ? ["dub", "sub", "softsub"] : ["softsub", "sub", "dub"];

    console.log("[AnimeKai] _chooseServer want=" + want + " track=" + track + " available=[" + servers.map(function(s) { return s.type + ":" + s.label; }).join(", ") + "]");

    // Try exact label/name match first (skip "default")
    if (want && want !== "default") {
      for (var i = 0; i < servers.length; i++) {
        var full = String(servers[i].label || servers[i].name || "").toLowerCase().replace(/\s+/g, "-");
        if (full === want || full.indexOf(want) !== -1 || want.indexOf(full) !== -1) {
          console.log("[AnimeKai] _chooseServer matched by name: " + servers[i].label);
          return servers[i];
        }
      }
    }
    // Pick by preferred type
    for (var t = 0; t < preferredTypes.length; t++) {
      for (var j = 0; j < servers.length; j++) {
        if (servers[j].type === preferredTypes[t]) {
          console.log("[AnimeKai] _chooseServer picked by type: " + servers[j].label);
          return servers[j];
        }
      }
    }
    // Last resort: first server
    console.log("[AnimeKai] _chooseServer fallback to first: " + servers[0].label);
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
      if (decodeURIComponent(kv[0] || "") === key) return decodeURIComponent(kv.slice(1).join("=") || "");
    }
    return "";
  }

  _normalizeTracks(tracks) {
    var out = [];
    if (!tracks || !tracks.length) return out;
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i] || {};
      var file = t.file || t.url || "";
      if (!file) continue;
      var kind = String(t.kind || "captions").toLowerCase();
      if (kind === "thumbnails") continue;
      out.push({ id: "sub-" + i, language: t.label || t.lang || t.language || "Unknown", url: file, isDefault: !!t.default });
    }
    return out;
  }

  _extractMegaUp(embedUrl) {
    console.log("[AnimeKai] _extractMegaUp embedUrl=" + embedUrl);
    try {
      var origin = this._originFromUrl(embedUrl);
      var videoId = String(embedUrl || "").split("?")[0].replace(/\/+$/, "").split("/").pop();
      var mediaUrl = String(embedUrl).indexOf("/e/") !== -1
        ? String(embedUrl).replace("/e/" + videoId, "/media/" + videoId)
        : origin + "/media/" + videoId;
      console.log("[AnimeKai] _extractMegaUp mediaUrl=" + mediaUrl + " videoId=" + videoId);
      var media = this._fetchJson(mediaUrl, this._headers({ "Accept": "application/json, text/plain, */*", "Referer": origin + "/", "Origin": origin }));
      var token = media.result || media.data || media.token || "";
      console.log("[AnimeKai] _extractMegaUp token=" + (token ? "present len=" + String(token).length : "MISSING") + " mediaKeys=" + Object.keys(media).join(","));
      if (!token) return null;
      var dec = this._postJson("https://enc-dec.app/api/dec-mega", {
        "Content-Type": "application/json", "Accept": "application/json", "User-Agent": this.ua, "Referer": "https://enc-dec.app/"
      }, JSON.stringify({ text: token, agent: this.ua }));
      var result = dec.result || dec;
      if (typeof result === "string") { try { result = JSON.parse(result); } catch (_) {} }
      console.log("[AnimeKai] _extractMegaUp dec-mega result sources=" + (result && result.sources ? result.sources.length : "null"));
      if (!result || !result.sources || !result.sources.length) return null;
      var subList = this._searchParam(embedUrl, "sub.list");
      if (subList) {
        var subJson = this._fetchJson(subList, this._headers({ "Accept": "*/*", "Referer": origin + "/", "Origin": origin }));
        if (subJson && subJson.length) result.tracks = subJson;
      }
      return { sources: result.sources, tracks: result.tracks || [], referer: origin + "/" };
    } catch (e) {
      console.error("[AnimeKai] _extractMegaUp EXCEPTION: " + e.message);
      return null;
    }
  }

  _extractEmbed(embedUrl) {
    console.log("[AnimeKai] _extractEmbed embedUrl=" + embedUrl);
    var host = String(embedUrl || "").match(/^https?:\/\/([^\/?#]+)/i);
    host = host ? host[1].toLowerCase() : "";
    if (!host) {
      console.error("[AnimeKai] _extractEmbed no host in embedUrl");
      return null;
    }
    console.log("[AnimeKai] _extractEmbed host=" + host);
    if (/^(4spromax|megaup|rapidairmax|rapidshare)(\d+)?\.?/.test(host) || host.indexOf("megaup") !== -1 || host.indexOf("rapid") !== -1) {
      console.log("[AnimeKai] _extractEmbed using MegaUp extractor");
      return this._extractMegaUp(embedUrl);
    }
    console.log("[AnimeKai] _extractEmbed trying fallback ofchaos API");
    var fallback = this._fetchJson("https://ac-api.ofchaos.com/api/anime/embed/convert/v2?embedUrl=" + encodeURIComponent(embedUrl), this._headers({ "Accept": "application/json" }));
    if (fallback && fallback.sources && fallback.sources.length) {
      console.log("[AnimeKai] _extractEmbed ofchaos SUCCESS sources=" + fallback.sources.length);
      return fallback;
    }
    console.log("[AnimeKai] _extractEmbed ofchaos empty, trying MegaUp as fallback");
    return this._extractMegaUp(embedUrl);
  }

  findEpisodeServer(episodeObj, serverName) {
    console.log("[AnimeKai] findEpisodeServer START episodeObj=" + JSON.stringify(episodeObj) + " serverName=" + serverName);
    var ep = this._parseEpisodeObj(episodeObj);
    console.log("[AnimeKai] findEpisodeServer parsed ep=" + JSON.stringify(ep));
    if (!ep.token) throw new Error("Missing episode token");
    var cacheKey = "srv:" + ep.token + ":" + ep.track + ":" + String(serverName || "default");
    var cached = this._cacheGet(this._serverCache, this._serverCacheTime, cacheKey);
    if (cached !== undefined) {
      console.log("[AnimeKai] findEpisodeServer CACHE HIT");
      return cached;
    }

    var encToken = this._encdec(ep.token, "e");
    console.log("[AnimeKai] findEpisodeServer encToken=" + encToken);
    if (!encToken) throw new Error("Could not encode episode token");

    var listApi = this._apiJson("/ajax/links/list?token=" + encodeURIComponent(ep.token) + "&_=" + encodeURIComponent(encToken));
    console.log("[AnimeKai] findEpisodeServer listApi keys=" + Object.keys(listApi.json).join(","));
    var serversHtml = this._extractResultHtml(listApi.json);
    console.log("[AnimeKai] findEpisodeServer serversHtml len=" + serversHtml.length);
    var servers = this._parseServersHtml(serversHtml);
    if (!servers.length) {
      console.error("[AnimeKai] findEpisodeServer no servers parsed from HTML, returning null");
      return null;
    }

    var chosen = this._chooseServer(servers, serverName, ep.track);
    console.log("[AnimeKai] findEpisodeServer chosen=" + JSON.stringify(chosen));
    if (!chosen || !chosen.lid) throw new Error("No matching server");

    var encLid = this._encdec(chosen.lid, "e");
    console.log("[AnimeKai] findEpisodeServer encLid=" + encLid);
    if (!encLid) throw new Error("Could not encode server id");

    var viewApi = this._apiJson("/ajax/links/view?id=" + encodeURIComponent(chosen.lid) + "&_=" + encodeURIComponent(encLid));
    console.log("[AnimeKai] findEpisodeServer viewApi keys=" + Object.keys(viewApi.json).join(","));
    var encResult = viewApi.json && viewApi.json.result !== undefined ? viewApi.json.result : "";
    console.log("[AnimeKai] findEpisodeServer encResult len=" + String(encResult).length);
    if (!encResult) throw new Error("No server link result");

    var dec = this._encdec(encResult, "d");
    console.log("[AnimeKai] findEpisodeServer dec type=" + typeof dec);
    if (typeof dec === "string") { try { dec = JSON.parse(dec); } catch (_) {} }
    var embedUrl = typeof dec === "string" ? dec : dec && dec.url ? dec.url : "";
    console.log("[AnimeKai] findEpisodeServer embedUrl=" + embedUrl);
    if (!embedUrl) throw new Error("No embed url");

    var extracted = this._extractEmbed(embedUrl);
    console.log("[AnimeKai] findEpisodeServer extracted sources=" + (extracted && extracted.sources ? extracted.sources.length : "null"));
    if (!extracted || !extracted.sources || !extracted.sources.length) throw new Error("No extracted sources");

    var stream = null;
    for (var i = 0; i < extracted.sources.length; i++) {
      var s = extracted.sources[i] || {};
      var file = s.file || s.url || "";
      console.log("[AnimeKai] findEpisodeServer source[" + i + "] type=" + s.type + " file=" + file.substring(0, 80));
      if (file && (s.type === "hls" || String(file).indexOf(".m3u8") !== -1)) { stream = s; break; }
    }
    if (!stream) {
      for (var j = 0; j < extracted.sources.length; j++) {
        var s2 = extracted.sources[j] || {};
        if (s2.file || s2.url) { stream = s2; break; }
      }
    }
    if (!stream) throw new Error("No playable source");

    var url = stream.file || stream.url;
    var origin = this._originFromUrl(embedUrl);
    var subtitles = this._normalizeTracks(extracted.tracks || []);
    var type = String(url).indexOf(".mpd") !== -1 ? "mpd" : String(url).indexOf(".m3u8") !== -1 || stream.type === "hls" ? "m3u8" : "mp4";

    console.log("[AnimeKai] findEpisodeServer SUCCESS url=" + url.substring(0, 80) + " type=" + type + " subtitles=" + subtitles.length);

    var resp = {
      server: chosen.label || chosen.name || "default",
      headers: { "Referer": extracted.referer || origin + "/", "Origin": origin, "User-Agent": this.ua },
      videoSources: [{ url: url, file: url, type: type, quality: stream.quality || "auto", subtitles: subtitles }],
      sources: [{ url: url, file: url, type: type, quality: stream.quality || "auto" }],
      subtitles: subtitles
    };
    this._cacheSet(this._serverCache, this._serverCacheTime, cacheKey, resp);
    return resp;
  }
}

module.exports = AnimeKai;
