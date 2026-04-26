class AnimeKai {
  constructor() {
    this.type = "anime-streaming";
    this.version = "1.0.0";
    this.baseUrl = "https://animekai.to";
    this.encApi = "https://enc-dec.app/api";
    this.batchSize = 50;
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
      episodeServers: ["Server 1", "Server 2"],
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

  _postJson(url, headers, body) {
    var res = this._nativeFetch(url, "POST", headers || {}, body == null ? "" : String(body));
    var txt = String(res.body || "").replace(/^\uFEFF/, "").trim();
    if (!txt) return {};
    try { var o = JSON.parse(txt); return (o && typeof o === "object") ? o : {}; } catch (_) { return {}; }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

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

  _normalizeQuery(q) {
    return String(q || "")
      .replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1")
      .replace(/\s+/g, " ")
      .replace(/(\d+)\s*Season/i, "$1")
      .replace(/Season\s*(\d+)/i, "$1")
      .trim();
  }

  _cleanHtml(s) {
    if (!s) return "";
    return s.replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, "\\")
            .replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r")
            .replace(/\\u([\dA-Fa-f]{4})/g, function(_, h) { return String.fromCharCode(parseInt(h, 16)); });
  }

  // ── enc-dec.app helpers ───────────────────────────────────────────────────

  _encKai(text) {
    var res = this._fetchJson(this.encApi + "/enc-kai?text=" + encodeURIComponent(text), { "User-Agent": "Mozilla/5.0" });
    return String(res.result || "");
  }

  _decKai(text) {
    var res = this._postJson(this.encApi + "/dec-kai", { "Content-Type": "application/json" }, JSON.stringify({ text: text }));
    return (res && res.result) ? res.result : null;
  }

  _decMega(text, ua) {
    return this._postJson(this.encApi + "/dec-mega", { "Content-Type": "application/json" }, JSON.stringify({ text: text, agent: ua || "Mozilla/5.0" }));
  }

  // ── HTML parsers ──────────────────────────────────────────────────────────

  _parseSearchResults(html) {
    var results = [];
    // Match each anime card block
    var blockRe = /class="aitem[\s"]/g;
    var hrefRe = /href="\/([^"?#]+)"/;
    var titleRe = /class="title"[^>]+title="([^"]+)"/;
    var subRe = /class="sub"/;
    var dubRe = /class="dub"/;

    // Split html around aitem divs
    var parts = html.split('class="aitem');
    for (var i = 1; i < parts.length; i++) {
      // Take only enough of the block to find what we need (avoid huge string ops)
      var block = parts[i].substring(0, 800);
      var hrefM = hrefRe.exec(block);
      var titleM = titleRe.exec(block);
      if (!hrefM || !titleM) continue;
      var hasSub = subRe.test(block);
      var hasDub = dubRe.test(block);
      var subOrDub = (hasSub && hasDub) ? "both" : hasSub ? "sub" : "dub";
      results.push({ href: hrefM[1], title: titleM[1], subOrDub: subOrDub });
    }
    return results;
  }

  _parseEpisodeItems(html) {
    var items = [];
    var re = /num="(\d+)"[^>]+token="([^"]+)"/g;
    var m;
    while ((m = re.exec(html)) !== null) {
      items.push({ number: parseInt(m[1], 10), data: m[2] });
    }
    return items;
  }

  _extractServerId(html, serverLabel) {
    var re = new RegExp('data-lid="([^"]+)"[^>]*>' + serverLabel + '<');
    var m = re.exec(html);
    return m ? m[1] : null;
  }

  _extractSection(html, dataId) {
    var re = new RegExp('data-id="' + dataId + '"[^>]*>([\\s\\S]*?)<\\/div>');
    var m = re.exec(html);
    return m ? m[1] : "";
  }

  // ── Public API ────────────────────────────────────────────────────────────

  search(arg) {
    arg = this._parseArg(arg);
    var q = String(arg.query || "").trim();
    if (!q) return [];

    var track = this._getTrack(arg);
    var nq = this._normalizeQuery(q);
    var cacheKey = nq + "|" + track;
    var cached = this._cacheGet(this._cache.search, cacheKey);
    if (cached !== undefined) return cached;

    var html = this._fetchText(
      this.baseUrl + "/browser?keyword=" + encodeURIComponent(nq),
      { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "DNT": "1", "Cookie": "__ddg1_=;__ddg2_=;" }
    );

    if (!html) { this._cacheSet(this._cache.search, cacheKey, []); return []; }

    var items = this._parseSearchResults(html);
    var isDub = track === "dub";
    var baseUrl = this.baseUrl;

    var results = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (isDub && item.subOrDub !== "dub" && item.subOrDub !== "both") continue;
      results.push({
        id: item.href + "?dub=" + isDub,
        title: item.title,
        url: baseUrl + "/" + item.href,
        subOrDub: item.subOrDub
      });
    }

    this._cacheSet(this._cache.search, cacheKey, results);
    return results;
  }

  findEpisodes(Id) {
    var parts = String(Id || "").split("?dub=");
    var path = parts[0];
    var dubFlag = (parts[1] === "true") ? "true" : "false";
    if (!path) return [];

    var cacheKey = path + "|" + dubFlag;
    var cached = this._cacheGet(this._cache.episodes, cacheKey);
    if (cached !== undefined) return cached;

    var reqHeaders = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", "DNT": "1", "Cookie": "__ddg1_=;__ddg2_=;" };
    var html = this._fetchText(this.baseUrl + "/" + path, reqHeaders);
    if (!html) return [];

    var idM = html.match(/class="rate-box"[^>]*data-id="([^"]+)"/);
    if (!idM) return [];
    var aniId = idM[1];

    var token = this._encKai(aniId);
    if (!token) return [];

    var ajaxRes = this._fetchJson(
      this.baseUrl + "/ajax/episodes/list?ani_id=" + aniId + "&_=" + token,
      { "User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest", "Referer": this.baseUrl + "/" }
    );

    var epHtml = String(ajaxRes.result || "");
    if (!epHtml) return [];

    var epItems = this._parseEpisodeItems(epHtml);
    if (!epItems.length) return [];

    var episodes = [];
    var self = this;
    for (var i = 0; i < epItems.length; i++) {
      var item = epItems[i];
      try {
        var epToken = self._encKai(item.data);
        if (!epToken) continue;
        episodes.push({
          id: item.data,
          number: item.number,
          title: "Episode " + item.number,
          url: self.baseUrl + "/ajax/links/list?token=" + item.data + "&_=" + epToken + "?dub=" + dubFlag
        });
      } catch (_) {}
    }

    episodes.sort(function(a, b) { return a.number - b.number; });
    this._cacheSet(this._cache.episodes, cacheKey, episodes);
    return episodes;
  }

  findEpisodeServer(episodeObj, serverName) {
    var ep = episodeObj;
    if (typeof episodeObj === "string") {
      try { ep = JSON.parse(episodeObj); } catch (_) { ep = {}; }
    }

    var server = (serverName && serverName !== "default") ? serverName : "Server 1";
    var epUrl = String((ep && ep.url) || "");
    if (!epUrl) throw new Error("Missing episode URL");

    var cacheKey = "srv:" + epUrl + ":" + server;
    var cached = this._cacheGet(this._cache.servers, cacheKey);
    if (cached !== undefined) return cached;

    // Split ?dub= suffix
    var urlParts = epUrl.split("?dub=");
    var episodeUrl = urlParts[0].replace(/\\u0026/g, "&");
    var dubRequested = urlParts[1] === "true";

    var ajaxHeaders = { "User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest", "Referer": this.baseUrl + "/" };
    var linkRes = this._fetchJson(episodeUrl, ajaxHeaders);

    if ((linkRes.status !== "ok" && linkRes.status !== 200) || !linkRes.result) {
      throw new Error("Link list fetch failed: " + linkRes.status);
    }

    var cleanedHtml = this._cleanHtml(String(linkRes.result));
    var subHtml = this._extractSection(cleanedHtml, "sub");
    var softsubHtml = this._extractSection(cleanedHtml, "softsub");
    var dubHtml = this._extractSection(cleanedHtml, "dub");

    var serverLabel = (server === "Server 2") ? "Server 2" : "Server 1";

    var serverIdDub = this._extractServerId(dubHtml, serverLabel);
    var serverIdSoftsub = this._extractServerId(softsubHtml, serverLabel);
    var serverIdSub = this._extractServerId(subHtml, serverLabel);

    var tokenData = [];
    if (serverIdDub) tokenData.push({ name: "Dub", data: serverIdDub });
    if (serverIdSoftsub) tokenData.push({ name: "Softsub", data: serverIdSoftsub });
    if (serverIdSub) tokenData.push({ name: "Sub", data: serverIdSub });

    if (!tokenData.length) throw new Error("No server IDs found");

    // Encrypt each ID and fetch the stream redirect URL
    var streamUrls = {};
    for (var i = 0; i < tokenData.length; i++) {
      var item = tokenData[i];
      var encToken = this._encKai(item.data);
      if (!encToken) continue;
      var viewRes = this._fetchJson(
        this.baseUrl + "/ajax/links/view?id=" + item.data + "&_=" + encToken,
        { "User-Agent": "Mozilla/5.0" }
      );
      if (!viewRes.result) continue;
      var decResult = this._decKai(viewRes.result);
      if (decResult && decResult.url) streamUrls[item.name] = decResult.url;
    }

    var ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
    var streamUrl = dubRequested
      ? (streamUrls["Dub"] || "")
      : (streamUrls["Sub"] || streamUrls["Softsub"] || "");

    if (!streamUrl) throw new Error("No valid stream URL found");

    var mediaHeaders = { "Referer": "https://animekai.to/", "User-Agent": ua };
    var mediaRes = this._fetchJson(streamUrl.replace("/e/", "/media/"), mediaHeaders);
    if (!mediaRes || !mediaRes.result) throw new Error("Media fetch failed");

    var finalJson = this._decMega(mediaRes.result, ua);
    if (!finalJson || finalJson.status !== 200) throw new Error("Stream decrypt failed");
    if (!finalJson.result || !finalJson.result.sources || !finalJson.result.sources.length) {
      throw new Error("No sources in decrypted response");
    }

    var m3u8 = String(finalJson.result.sources[0].file || "");
    if (!m3u8) throw new Error("Empty m3u8 URL");

    // Parse quality variants from the playlist
    var playlistText = this._fetchText(m3u8, mediaHeaders);
    var videoSources = [];
    var resRe = /#EXT-X-STREAM-INF:[^\n]*RESOLUTION=(\d+x\d+)[^\n]*\n([^\n]+)/g;
    var rm;
    while ((rm = resRe.exec(playlistText)) !== null) {
      var resolution = rm[1];
      var relUrl = rm[2].trim();
      var finalUrl = relUrl.indexOf("list") !== -1
        ? m3u8.split(",")[0] + "/" + relUrl
        : m3u8.split("/list")[0] + "/" + relUrl;
      videoSources.push({ quality: resolution.split("x")[1] + "p", url: finalUrl, type: "m3u8", subtitles: [] });
    }

    if (!videoSources.length) {
      videoSources.push({ quality: "auto", url: m3u8, type: "m3u8", subtitles: [] });
    }

    var resp = {
      server: server,
      headers: { "Access-Control-Allow-Origin": "*", "User-Agent": ua },
      videoSources: videoSources
    };

    this._cacheSet(this._cache.servers, cacheKey, resp);
    return resp;
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

module.exports = AnimeKai;
