class AnimeKai {
  constructor() {
    this.type = "anime-streaming";
    this.version = "1.1.1-fixed";
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
        if (t < oldestTime) {
          oldest = keys[i];
          oldestTime = t;
        }
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
      try {
        j = JSON.parse(raw || "{}");
      } catch (_) {}
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

  _isBadJson(o) {
    if (!o || typeof o !== "object") return true;
    if (o.cloudflare_error || o.error_code || o.error_name || o.error_category) return true;
    var title = String(o.title || "").toLowerCase();
    var type = String(o.type || "").toLowerCase();
    var detail = String(o.detail || "").toLowerCase();
    var footer = String(o.footer || "").toLowerCase();
    if (title.indexOf("cloudflare") !== -1) return true;
    if (type.indexOf("cloudflare") !== -1) return true;
    if (detail.indexOf("cloudflare") !== -1) return true;
    if (footer.indexOf("cloudflare") !== -1) return true;
    if (Number(o.status || 0) >= 400 && (o.type || o.title || o.detail)) return true;
    return false;
  }

  _fetchText(url, headers) {
    var result = this._nativeFetch(url, "GET", headers || this._headers(), "");
    var body = String(result.body || "");
    console.log("[AnimeKai] _fetchText url=" + url + " bodyLen=" + body.length + " status=" + result.status + " ok=" + result.ok + " preview=" + body.substring(0, 120).replace(/\s+/g, " "));
    if (!result.ok || result.status < 200 || result.status >= 300) {
      console.warn("[AnimeKai] _fetchText bad status url=" + url + " status=" + result.status);
      return "";
    }
    return body;
  }

  _fetchJson(url, headers) {
    var result = this._nativeFetch(url, "GET", headers || this._headers(), "");
    var txt = String(result.body || "").replace(/^\uFEFF/, "").trim();
    console.log("[AnimeKai] _fetchJson url=" + url + " status=" + result.status + " ok=" + result.ok + " bodyLen=" + txt.length);

    if (!result.ok || result.status < 200 || result.status >= 300) {
      console.warn("[AnimeKai] _fetchJson bad status url=" + url + " status=" + result.status + " preview=" + txt.substring(0, 120));
      return {};
    }

    if (!txt) {
      console.warn("[AnimeKai] _fetchJson empty body url=" + url);
      return {};
    }

    try {
      var o = JSON.parse(txt);
      if (!o || typeof o !== "object") return {};
      if (this._isBadJson(o)) {
        console.warn("[AnimeKai] _fetchJson bad json url=" + url + " keys=" + Object.keys(o).join(","));
        return {};
      }
      console.log("[AnimeKai] _fetchJson url=" + url + " keys=" + Object.keys(o).join(","));
      return o;
    } catch (e) {
      console.warn("[AnimeKai] _fetchJson parse error url=" + url + " err=" + e.message + " preview=" + txt.substring(0, 80));
      return {};
    }
  }

  _postJson(url, headers, body) {
    console.log("[AnimeKai] _postJson url=" + url);
    var result = this._nativeFetch(url, "POST", headers || this._headers({ "Content-Type": "application/json" }), body || "");
    var txt = String(result.body || "").replace(/^\uFEFF/, "").trim();

    if (!result.ok || result.status < 200 || result.status >= 300) {
      console.warn("[AnimeKai] _postJson bad status url=" + url + " status=" + result.status + " preview=" + txt.substring(0, 120));
      return {};
    }

    if (!txt) {
      console.warn("[AnimeKai] _postJson empty response url=" + url);
      return {};
    }

    try {
      var o = JSON.parse(txt);
      if (!o || typeof o !== "object") return {};
      if (this._isBadJson(o)) {
        console.warn("[AnimeKai] _postJson bad json url=" + url + " keys=" + Object.keys(o).join(","));
        return {};
      }
      console.log("[AnimeKai] _postJson url=" + url + " keys=" + Object.keys(o).join(","));
      return o;
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
        "Referer": base + "/",
        "Origin": base
      }));

      if (j && j.status === "ok") {
        console.log("[AnimeKai] _apiJson SUCCESS url=" + urls[i] + " keys=" + Object.keys(j).join(","));
        return { json: j, base: base };
      }

      console.warn("[AnimeKai] _apiJson EMPTY/BAD url=" + urls[i]);
    }

    console.error("[AnimeKai] _apiJson ALL FAILED path=" + path);
    return { json: {}, base: this.altBaseUrl };
  }

  _unwrapPageHtml(txt) {
    if (!txt || txt[0] !== "{") return txt;
    try {
      var parsed = JSON.parse(txt);
      if (this._isBadJson(parsed)) return "";
      if (parsed.result && typeof parsed.result === "string" && parsed.result.length > 100) {
        console.log("[AnimeKai] _unwrapPageHtml unwrapped result string len=" + parsed.result.length);
        return parsed.result;
      }
      if (parsed.result && typeof parsed.result === "object" && parsed.result.html) {
        console.log("[AnimeKai] _unwrapPageHtml unwrapped result.html");
        return String(parsed.result.html);
      }
      if (parsed.data && typeof parsed.data === "string" && parsed.data.length > 100) {
        console.log("[AnimeKai] _unwrapPageHtml unwrapped data string");
        return parsed.data;
      }
    } catch (e) {
      console.warn("[AnimeKai] _unwrapPageHtml parse failed " + e.message);
    }
    return txt;
  }

  _pageText(path) {
    var urls = [this.altBaseUrl + path, this.baseUrl + path];
    for (var i = 0; i < urls.length; i++) {
      var base = urls[i].split("/watch/")[0] || urls[i].split("/browser")[0] || this.altBaseUrl;
      console.log("[AnimeKai] _pageText trying url=" + urls[i]);
      var raw = this._fetchText(urls[i], this._headers({ "Referer": base + "/", "Origin": base }));
      var txt = this._unwrapPageHtml(raw);
      if (txt && txt.length > 100 && txt.toLowerCase().indexOf("cloudflare") === -1) {
        console.log("[AnimeKai] _pageText SUCCESS url=" + urls[i] + " rawLen=" + raw.length + " unwrappedLen=" + txt.length);
        return { text: txt, base: base };
      }
      console.warn("[AnimeKai] _pageText EMPTY/SHORT/BAD url=" + urls[i] + " rawLen=" + raw.length);
    }
    console.error("[AnimeKai] _pageText ALL FAILED path=" + path);
    return { text: "", base: this.altBaseUrl };
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
      .replace(/&#(\d+);?/g, function(_, d) { return String.fromCharCode(parseInt(d, 10)); })
      .replace(/&#x([0-9a-f]+);?/gi, function(_, d) { return String.fromCharCode(parseInt(d, 16)); })
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
      .replace(/\d+(st|nd|rd|th)/g, function(m) { return m.replace(/st|nd|rd|th/, ""); })
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
    return s.replace(/-/g, " ").replace(/\b\w/g, function(c) { return c.toUpperCase(); }).trim();
  }

  _prefixSim(a, b) {
    a = String(a || "");
    b = String(b || "");
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
      if (c === t) best = Math.max(best, 1000);
      else if (c.indexOf(t) !== -1 || t.indexOf(c) !== -1) best = Math.max(best, 850);
      else best = Math.max(best, Math.floor(this._prefixSim(c, t) * 700));
    }
    return best;
  }

  _extractResultHtml(obj) {
    if (!obj) return "";
    if (typeof obj === "string") return obj;
    if (this._isBadJson(obj)) return "";
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

      var titleAttrM = /class=["'][^"']*\btitle\b[^"']*["'][^>]*title=["']([^"']+)["']/i.exec(block) || /title=["']([^"']+)["'][^>]*class=["'][^"']*\btitle\b/i.exec(block);
      var dataTitleM = /data-title=["']([^"']+)["']/i.exec(block);
      var altM = /alt=["']([^"']+)["']/i.exec(block);
      var spanM = /class=["'][^"']*\btitle\b[^"']*["'][^>]*>([\s\S]*?)<\//i.exec(block);

      var title = (titleAttrM && titleAttrM[1]) || (dataTitleM && dataTitleM[1]) || (altM && altM[1]) || (spanM && this._stripTags(spanM[1])) || this._slugTitle(id);
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

    var url = "https://enc-dec.app/api/" + endpoint + "?text=" + encodeURIComponent(text);
    var json = this._fetchJson(url, this._headers({
      "Accept": "application/json, text/plain, */*",
      "Referer": "https://enc-dec.app/",
      "Origin": "https://enc-dec.app"
    }));

    if (json && json.result !== undefined) {
      console.log("[AnimeKai] _encdec GET SUCCESS mode=" + mode + " output=" + String(json.result).substring(0, 40));
      return json.result;
    }

    if (mode === "d") {
      var post = this._postJson("https://enc-dec.app/api/" + endpoint, {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "User-Agent": this.ua,
        "Referer": "https://enc-dec.app/",
        "Origin": "https://enc-dec.app"
      }, JSON.stringify({ text: text }));

      if (post && post.result !== undefined) {
        console.log("[AnimeKai] _encdec POST SUCCESS mode=" + mode + " output=" + String(post.result).substring(0, 40));
        return post.result;
      }
    }

    console.error("[AnimeKai] _encdec FAILED mode=" + mode + " input=" + text.substring(0, 40));
    return "";
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
        if (id && /^[a-z0-9_-]+$/i.test(id)) {
          console.log("[AnimeKai] _extractAnimeId found via syncData id=" + id);
          return id;
        }
      } catch (e) {
        console.warn("[AnimeKai] _extractAnimeId syncData parse error " + e.message);
      }
    }

    var patterns = [
      /window\.__DATA__\s*=\s*\{[\s\S]*?["']?(?:anime_id|ani_id)["']?\s*:\s*["']?([a-z0-9_-]+)["']?/i,
      /["']anime_id["']\s*:\s*["']?([a-z0-9_-]+)["']?/i,
      /["']ani_id["']\s*:\s*["']?([a-z0-9_-]+)["']?/i,
      /data-ani-id=["']([a-z0-9_-]+)["']/i,
      /data-id=["']([a-z0-9_-]+)["'][^>]*class=["'][^"']*rate-box/i,
      /class=["'][^"']*rate-box[^"']*["'][^>]*data-id=["']([a-z0-9_-]+)["']/i,
      /\bani_id\s*=\s*["']?([a-z0-9_-]+)["']?/i,
      /\banime_id\s*=\s*["']?([a-z0-9_-]+)["']?/i,
      /\baniId\s*=\s*["']?([a-z0-9_-]+)["']?/i,
      /"id"\s*:\s*"?([a-z0-9_-]+)"?/i
    ];

    for (var i = 0; i < patterns.length; i++) {
      var m = html.match(patterns[i]);
      if (m && m[1] && /^[a-z0-9_-]+$/i.test(m[1])) {
        console.log("[AnimeKai] _extractAnimeId found via pattern[" + i + "] id=" + m[1]);
        return m[1];
      }
    }

    console.error("[AnimeKai] _extractAnimeId FAILED htmlLen=" + html.length);
    console.log("[AnimeKai] _extractAnimeId snippet=" + html.substring(0, 500).replace(/\s+/g, " "));
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

      if (!token) {
        tokenMissing++;
        continue;
      }

      if (!num) {
        numMissing++;
        continue;
      }

      if (seen[token]) continue;

      var langs = String(attrs.langs || attrs["data-langs"] || "");

      if (langs && /^\d+$/.test(langs)) {
        var bits = parseInt(langs, 10);
        var hasSub = !!(bits & 1);
        var hasDub = !!(bits & 2);

        if (track === "sub" && !hasSub) {
          langFiltered++;
          continue;
        }

        if (track === "dub" && !hasDub) {
          langFiltered++;
          continue;
        }
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

    console.log("[AnimeKai] _parseEpisodesHtml mediaId=" + mediaId + " track=" + track + " htmlLen=" + html.length + " totalAnchors=" + totalAnchors + " tokenMissing=" + tokenMissing + " numMissing=" + numMissing + " langFiltered=" + langFiltered + " parsed=" + out.length);

    if (out.length === 0 && html.length > 0) {
      console.warn("[AnimeKai] _parseEpisodesHtml zero results snippet=" + html.substring(0, 600).replace(/\s+/g, " "));
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
      console.error("[AnimeKai] findEpisodes ABORT empty mediaId");
      return [];
    }

    var cacheKey = mediaId + "|" + track;
    var cached = this._cacheGet(this._episodeCache, this._episodeCacheTime, cacheKey);

    if (cached !== undefined) {
      console.log("[AnimeKai] findEpisodes CACHE HIT count=" + cached.length);
      return cached;
    }

    var page = this._pageText("/watch/" + mediaId);
    var html = page.text;

    if (!html) {
      console.error("[AnimeKai] findEpisodes FAILED empty page mediaId=" + mediaId);
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
      }
    }

    if (!episodes.length) {
      console.log("[AnimeKai] findEpisodes trying fallback patterns");

      var fbPatterns = [
        /class=["'][^"']*rate-box[^"']*["'][^>]*data-id=["']([^"']+)["']/i,
        /data-id=["']([^"']+)["'][^>]*class=["'][^"']*rate-box/i,
        /data-ani-id=["']([^"']+)["']/i
      ];

      for (var pi = 0; pi < fbPatterns.length; pi++) {
        var fbM = html.match(fbPatterns[pi]);

        if (fbM && fbM[1]) {
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
      console.warn("[AnimeKai] findEpisodes trying inline parse");
      episodes = this._parseEpisodesHtml(html, mediaId, track);
      console.log("[AnimeKai] findEpisodes inline parse count=" + episodes.length);
    }

    if (!episodes.length) {
      console.error("[AnimeKai] findEpisodes FINAL 0 episodes mediaId=" + mediaId + " track=" + track);
    } else {
      console.log("[AnimeKai] findEpisodes FINAL count=" + episodes.length + " first=" + JSON.stringify(episodes[0]));
    }

    this._cacheSet(this._episodeCache, this._episodeCacheTime, cacheKey, episodes);
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
    html = String(html || "");
    console.log("[AnimeKai] _parseServersHtml RAW len=" + html.length + " preview=" + html.substring(0, 300).replace(/\s+/g, " "));

    var out = [];
    var seen = {};
    var types = ["sub", "softsub", "dub"];

    for (var t = 0; t < types.length; t++) {
      var typeId = types[t];
      var searchFrom = 0;
      var sectionStart = -1;

      while (true) {
        var siIdx = html.indexOf("server-items", searchFrom);
        if (siIdx === -1) break;

        var tagStart = html.lastIndexOf("<", siIdx);
        var tagEnd = html.indexOf(">", siIdx);
        if (tagEnd === -1) break;

        var tagContent = html.substring(tagStart === -1 ? siIdx : tagStart, tagEnd + 1);

        if (tagContent.indexOf('data-id="' + typeId + '"') !== -1 || tagContent.indexOf("data-id='" + typeId + "'") !== -1) {
          sectionStart = tagEnd + 1;
          break;
        }

        searchFrom = siIdx + 1;
      }

      if (sectionStart === -1) {
        console.log("[AnimeKai] _parseServersHtml no section type=" + typeId);
        continue;
      }

      var sectionEnd = html.indexOf("</div>", sectionStart);
      var sectionHtml = sectionEnd === -1 ? html.substring(sectionStart) : html.substring(sectionStart, sectionEnd);

      console.log("[AnimeKai] _parseServersHtml type=" + typeId + " sectionLen=" + sectionHtml.length + " preview=" + sectionHtml.substring(0, 150).replace(/\s+/g, " "));

      var serverRe = /<span\b([^>]*class=["'][^"']*\bserver\b[^"']*["'][^>]*)>([\s\S]*?)<\/span>/gi;
      var m;

      while ((m = serverRe.exec(sectionHtml)) !== null) {
        var attrs = this._attrs(m[1]);
        var lid = attrs["data-lid"] || attrs.lid || "";
        var sid = attrs["data-sid"] || "";
        var eid = attrs["data-eid"] || "";

        if (!lid) continue;

        var key = typeId + "|" + lid;
        if (seen[key]) continue;

        seen[key] = true;

        var serverNum = out.filter(function(x) { return x.type === typeId; }).length + 1;
        var nameText = this._stripTags(m[2]) || "Server " + serverNum;

        out.push({
          lid: lid,
          sid: sid,
          eid: eid,
          type: typeId,
          name: nameText,
          label: this._typeSuffix(typeId) + " - " + nameText
        });

        console.log("[AnimeKai] _parseServersHtml found type=" + typeId + " lid=" + lid + " label=" + this._typeSuffix(typeId) + " - " + nameText);
      }
    }

    if (!out.length) {
      console.warn("[AnimeKai] _parseServersHtml global fallback");

      var globalRe = /data-lid=["']([^"']+)["']/gi;
      var gm;

      while ((gm = globalRe.exec(html)) !== null) {
        if (!out.some(function(s) { return s.lid === gm[1]; })) {
          out.push({
            lid: gm[1],
            sid: "",
            eid: "",
            type: "sub",
            name: "Server",
            label: "Hard Sub - Server"
          });
          console.log("[AnimeKai] _parseServersHtml global fallback lid=" + gm[1]);
        }
      }
    }

    console.log("[AnimeKai] _parseServersHtml FINAL found=" + out.length + " servers=" + out.map(function(s) { return s.type + ":" + s.label + "(" + s.lid + ")"; }).join(", "));
    return out;
  }

  _chooseServer(servers, serverName, track) {
    if (!servers || !servers.length) return null;

    var want = String(serverName || "").toLowerCase().replace(/\s+/g, "-");
    var preferredTypes = track === "dub" ? ["dub", "softsub", "sub"] : ["softsub", "sub", "dub"];

    console.log("[AnimeKai] _chooseServer want=" + want + " track=" + track + " available=[" + servers.map(function(s) { return s.type + ":" + s.label; }).join(", ") + "]");

    if (want && want !== "default") {
      for (var i = 0; i < servers.length; i++) {
        var full = String(servers[i].label || servers[i].name || "").toLowerCase().replace(/\s+/g, "-");
        var type = String(servers[i].type || "").toLowerCase();

        if (full === want || full.indexOf(want) !== -1 || want.indexOf(full) !== -1) {
          console.log("[AnimeKai] _chooseServer matched by name " + servers[i].label);
          return servers[i];
        }

        if (want.indexOf("soft") !== -1 && type === "softsub") return servers[i];
        if (want.indexOf("hard") !== -1 && type === "sub") return servers[i];
        if (want.indexOf("dub") !== -1 && type === "dub") return servers[i];
      }
    }

    for (var t = 0; t < preferredTypes.length; t++) {
      for (var j = 0; j < servers.length; j++) {
        if (servers[j].type === preferredTypes[t]) {
          console.log("[AnimeKai] _chooseServer picked by type " + servers[j].label);
          return servers[j];
        }
      }
    }

    console.log("[AnimeKai] _chooseServer fallback first " + servers[0].label);
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

    if (!tracks || !tracks.length) return out;

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

  _skipRange(val) {
    if (!val || typeof val !== "object") return null;

    if (val.startMs !== undefined && val.endMs !== undefined) {
      return { start: Number(val.startMs) / 1000, end: Number(val.endMs) / 1000 };
    }

    if (val.start !== undefined && val.end !== undefined) {
      return { start: Number(val.start), end: Number(val.end) };
    }

    if (val.from !== undefined && val.to !== undefined) {
      return { start: Number(val.from), end: Number(val.to) };
    }

    if (val.interval) return this._skipRange(val.interval);

    return null;
  }

  _extractMegaUp(embedUrl) {
    console.log("[AnimeKai] _extractMegaUp embedUrl=" + embedUrl);

    try {
      var origin = this._originFromUrl(embedUrl);
      var videoId = String(embedUrl || "").split("?")[0].replace(/\/+$/, "").split("/").pop();

      if (!origin || !videoId) return null;

      var mediaUrl = String(embedUrl).indexOf("/e/") !== -1
        ? String(embedUrl).replace("/e/" + videoId, "/media/" + videoId)
        : origin + "/media/" + videoId;

      console.log("[AnimeKai] _extractMegaUp mediaUrl=" + mediaUrl + " videoId=" + videoId);

      var media = this._fetchJson(mediaUrl, this._headers({
        "Accept": "application/json, text/plain, */*",
        "Referer": origin + "/",
        "Origin": origin
      }));

      if (media && media.sources && media.sources.length) {
        return {
          sources: media.sources,
          tracks: media.tracks || media.subtitles || [],
          referer: origin + "/",
          intro: this._skipRange(media.intro || media.opening || media.op || null),
          outro: this._skipRange(media.outro || media.ending || media.ed || null)
        };
      }

      if (media && media.result && typeof media.result === "object" && media.result.sources && media.result.sources.length) {
        return {
          sources: media.result.sources,
          tracks: media.result.tracks || media.result.subtitles || [],
          referer: origin + "/",
          intro: this._skipRange(media.result.intro || media.result.opening || media.result.op || null),
          outro: this._skipRange(media.result.outro || media.result.ending || media.result.ed || null)
        };
      }

      var token = media.result || media.data || media.token || "";

      console.log("[AnimeKai] _extractMegaUp token=" + (token ? "present len=" + String(token).length : "MISSING") + " mediaKeys=" + Object.keys(media).join(","));

      if (!token) return null;

      if (typeof token === "object" && token.sources && token.sources.length) {
        return {
          sources: token.sources,
          tracks: token.tracks || token.subtitles || [],
          referer: origin + "/",
          intro: this._skipRange(token.intro || token.opening || token.op || null),
          outro: this._skipRange(token.outro || token.ending || token.ed || null)
        };
      }

      var dec = this._postJson("https://enc-dec.app/api/dec-mega", {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": this.ua,
        "Referer": "https://enc-dec.app/",
        "Origin": "https://enc-dec.app"
      }, JSON.stringify({ text: String(token), agent: this.ua }));

      var result = dec.result || dec;

      if (typeof result === "string") {
        try {
          result = JSON.parse(result);
        } catch (_) {}
      }

      console.log("[AnimeKai] _extractMegaUp dec-mega sources=" + (result && result.sources ? result.sources.length : "null"));

      if (!result || !result.sources || !result.sources.length) return null;

      var subList = this._searchParam(embedUrl, "sub.list");

      if (subList) {
        var subJson = this._fetchJson(subList, this._headers({
          "Accept": "*/*",
          "Referer": origin + "/",
          "Origin": origin
        }));

        if (subJson && subJson.length) result.tracks = subJson;
      }

      return {
        sources: result.sources,
        tracks: result.tracks || [],
        referer: origin + "/",
        intro: this._skipRange(result.intro || result.opening || result.op || null),
        outro: this._skipRange(result.outro || result.ending || result.ed || null)
      };
    } catch (e) {
      console.error("[AnimeKai] _extractMegaUp EXCEPTION " + e.message);
      return null;
    }
  }

  _extractEmbed(embedUrl) {
    console.log("[AnimeKai] _extractEmbed embedUrl=" + embedUrl);

    var host = String(embedUrl || "").match(/^https?:\/\/([^\/?#]+)/i);
    host = host ? host[1].toLowerCase() : "";

    if (!host) {
      console.error("[AnimeKai] _extractEmbed no host");
      return null;
    }

    console.log("[AnimeKai] _extractEmbed host=" + host);

    if (/^(4spromax|megaup|rapidairmax|rapidshare)(\d+)?\.?/.test(host) || host.indexOf("megaup") !== -1 || host.indexOf("rapid") !== -1) {
      console.log("[AnimeKai] _extractEmbed using MegaUp extractor");
      return this._extractMegaUp(embedUrl);
    }

    var fallback = this._fetchJson("https://ac-api.ofchaos.com/api/anime/embed/convert/v2?embedUrl=" + encodeURIComponent(embedUrl), this._headers({
      "Accept": "application/json"
    }));

    if (fallback && fallback.sources && fallback.sources.length) {
      console.log("[AnimeKai] _extractEmbed ofchaos SUCCESS sources=" + fallback.sources.length);
      return fallback;
    }

    if (fallback && fallback.result && fallback.result.sources && fallback.result.sources.length) {
      console.log("[AnimeKai] _extractEmbed ofchaos SUCCESS result.sources=" + fallback.result.sources.length);
      return fallback.result;
    }

    console.log("[AnimeKai] _extractEmbed trying MegaUp fallback");
    return this._extractMegaUp(embedUrl);
  }

  _serverPriority(server, wanted, track) {
    var label = String(server.label || server.name || "").toLowerCase();
    var type = String(server.type || "").toLowerCase();
    var want = String(wanted || "").toLowerCase().replace(/\s+/g, "-");
    var score = 0;

    if (want && want !== "default") {
      var normalizedLabel = label.replace(/\s+/g, "-");
      if (normalizedLabel === want) score += 1000;
      else if (normalizedLabel.indexOf(want) !== -1 || want.indexOf(normalizedLabel) !== -1) score += 800;
      if (want.indexOf("soft") !== -1 && type === "softsub") score += 700;
      if (want.indexOf("hard") !== -1 && type === "sub") score += 700;
      if (want.indexOf("dub") !== -1 && type === "dub") score += 700;
    }

    if (track === "dub") {
      if (type === "dub") score += 300;
      if (type === "softsub") score += 120;
      if (type === "sub") score += 80;
    } else {
      if (type === "softsub") score += 300;
      if (type === "sub") score += 220;
      if (type === "dub") score += 40;
    }

    return score;
  }

  _orderServers(servers, serverName, track) {
    var arr = (servers || []).slice();

    arr.sort(function(a, b) {
      var self = this;
      return self._serverPriority(b, serverName, track) - self._serverPriority(a, serverName, track);
    }.bind(this));

    var first = this._chooseServer(servers, serverName, track);

    if (first && first.lid) {
      var out = [first];

      for (var i = 0; i < arr.length; i++) {
        var exists = false;

        for (var j = 0; j < out.length; j++) {
          if (out[j].lid === arr[i].lid) exists = true;
        }

        if (!exists) out.push(arr[i]);
      }

      return out;
    }

    return arr;
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
      console.error("[AnimeKai] findEpisodeServer no servers parsed");
      return null;
    }

    var orderedServers = this._orderServers(servers, serverName, ep.track);

    console.log("[AnimeKai] findEpisodeServer ordered servers=" + orderedServers.map(function(s) { return s.label + "(" + s.lid + ")"; }).join(", "));

    var chosen = null;
    var extracted = null;
    var embedUrl = "";

    for (var si = 0; si < orderedServers.length; si++) {
      var testServer = orderedServers[si];

      console.log("[AnimeKai] findEpisodeServer trying server " + (si + 1) + "/" + orderedServers.length + " " + JSON.stringify(testServer));

      if (!testServer || !testServer.lid) continue;

      var encLid = this._encdec(testServer.lid, "e");

      console.log("[AnimeKai] findEpisodeServer encLid=" + encLid);

      if (!encLid) continue;

      var viewApi = this._apiJson("/ajax/links/view?id=" + encodeURIComponent(testServer.lid) + "&_=" + encodeURIComponent(encLid));

      console.log("[AnimeKai] findEpisodeServer viewApi keys=" + Object.keys(viewApi.json).join(","));

      var encResult = viewApi.json && viewApi.json.result !== undefined ? viewApi.json.result : "";

      console.log("[AnimeKai] findEpisodeServer encResult len=" + String(encResult).length);

      if (!encResult) continue;

      var dec = this._encdec(encResult, "d");

      console.log("[AnimeKai] findEpisodeServer dec type=" + typeof dec);

      if (typeof dec === "string") {
        try {
          dec = JSON.parse(dec);
        } catch (_) {}
      }

      embedUrl = typeof dec === "string" ? dec : dec && dec.url ? dec.url : "";

      console.log("[AnimeKai] findEpisodeServer embedUrl=" + embedUrl);

      if (!embedUrl) continue;

      extracted = this._extractEmbed(embedUrl);

      console.log("[AnimeKai] findEpisodeServer extracted sources=" + (extracted && extracted.sources ? extracted.sources.length : "null"));

      if (extracted && extracted.sources && extracted.sources.length) {
        chosen = testServer;
        break;
      }
    }

    if (!chosen || !extracted || !extracted.sources || !extracted.sources.length) {
      throw new Error("No extracted sources");
    }

    var stream = null;

    for (var i = 0; i < extracted.sources.length; i++) {
      var s = extracted.sources[i] || {};
      var file = s.file || s.url || "";
      console.log("[AnimeKai] findEpisodeServer source[" + i + "] type=" + s.type + " file=" + file.substring(0, 80));

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
    var subtitles = this._normalizeTracks(extracted.tracks || extracted.subtitles || []);
    var type = String(url).indexOf(".mpd") !== -1 ? "mpd" : String(url).indexOf(".m3u8") !== -1 || stream.type === "hls" ? "m3u8" : "mp4";
    var intro = extracted.intro || stream.intro || null;
    var outro = extracted.outro || stream.outro || null;

    console.log("[AnimeKai] findEpisodeServer SUCCESS url=" + url.substring(0, 80) + " type=" + type + " subtitles=" + subtitles.length + " intro=" + !!intro + " outro=" + !!outro);

    var resp = {
      server: chosen.label || chosen.name || "default",
      headers: {
        "Referer": extracted.referer || origin + "/",
        "Origin": origin,
        "User-Agent": this.ua
      },
      videoSources: [{
        url: url,
        file: url,
        type: type,
        quality: stream.quality || "auto",
        subtitles: subtitles
      }],
      sources: [{
        url: url,
        file: url,
        type: type,
        quality: stream.quality || "auto"
      }],
      subtitles: subtitles,
      intro: intro,
      outro: outro
    };

    this._cacheSet(this._serverCache, this._serverCacheTime, cacheKey, resp);
    return resp;
  }
}

module.exports = AnimeKai;
