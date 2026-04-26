class AnimeKai {
  constructor() {
    this.type = "anime-streaming";
    this.version = "1.0.0";
    this.baseUrl = "https://animekai.to";
    this.encApi = "https://enc-dec.app/api";
    this.batchSize = 50;
    this.batchDelay = 500;
    this._cache = {
      search: new Map(),
      episodes: new Map(),
      servers: new Map(),
      _maxSize: 300,
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
      const entries = Array.from(map.entries()).sort(function (a, b) { return a[1].t - b[1].t; });
      const evict = Math.ceil(entries.length * 0.3);
      for (let i = 0; i < evict; i++) map.delete(entries[i][0]);
    }
    map.set(key, { v: value, t: Date.now() });
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
      return obj && typeof obj === "object" ? obj : {};
    } catch (_) { return {}; }
  }

  _fetchJsonPost(url, headers, body) {
    const res = this._nativeFetch(url, "POST", headers || {}, body == null ? "" : String(body));
    const txt = String(res.body || "").replace(/^\uFEFF/, "").trim();
    if (!txt) return {};
    try {
      const obj = JSON.parse(txt);
      return obj && typeof obj === "object" ? obj : {};
    } catch (_) { return {}; }
  }

  _parseArg(arg) {
    if (typeof arg === "string") {
      const s = arg.trim();
      try {
        return (s.startsWith("{") || s.startsWith("[")) ? JSON.parse(s) : { query: s };
      } catch (_) { return { query: s }; }
    }
    return arg || {};
  }

  _getTrack(obj) {
    if (obj && obj.dub === true) return "dub";
    if (obj && obj.dub === false) return "sub";
    const t = String((obj && (obj.subOrDub || obj.track)) || "").toLowerCase();
    return (t === "dub" || t === "sub") ? t : "sub";
  }

  _normalizeQuery(query) {
    return String(query || "")
      .replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1")
      .replace(/\s+/g, " ")
      .replace(/(\d+)\s*Season/i, "$1")
      .replace(/Season\s*(\d+)/i, "$1")
      .trim();
  }


  _cleanJsonHtml(jsonHtml) {
    if (!jsonHtml) return "";
    return jsonHtml
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, "\\")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\r/g, "\r")
      .replace(/\\u([\dA-Fa-f]{4})/g, function (_, hex) { return String.fromCharCode(parseInt(hex, 16)); });
  }

  _parseAnimeItems(html) {
    const results = [];
    const itemRegex = /<div class="aitem-wrapper">[\s\S]*?<div class="aitem">([\s\S]*?)<\/div>\s*<\/div>/g;
    const hrefRegex = /class="poster"[^>]+href="([^"]+)"/;
    const titleRegex = /class="title"[^>]+title="([^"]+)"/;
    const subRegex = /<span class="sub"[^>]*>([^<]*)<\/span>/;
    const dubRegex = /<span class="dub"[^>]*>([^<]*)<\/span>/;

    let match;
    while ((match = itemRegex.exec(html)) !== null) {
      const block = match[0];
      const href = (hrefRegex.exec(block) || [])[1] || "";
      const title = (titleRegex.exec(block) || [])[1] || "";
      const hasSub = subRegex.test(block);
      const hasDub = dubRegex.test(block);
      const subOrDub = (hasSub && hasDub) ? "both" : hasSub ? "sub" : "dub";
      if (href) results.push({ href: href.replace(/^\//, ""), title, subOrDub });
    }
    return results;
  }

  _extractEpisodeItems(html) {
    // Parse <ul class="range"><li><a num="..." token="..."><span>title</span></a></li>...
    const items = [];
    const aRegex = /<a[^>]+num="(\d+)"[^>]+token="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    const spanRegex = /<span[^>]*>([\s\S]*?)<\/span>/;
    let m;
    while ((m = aRegex.exec(html)) !== null) {
      const num = parseInt(m[1], 10);
      const token = m[2];
      const inner = m[3];
      const spanMatch = spanRegex.exec(inner);
      const title = spanMatch ? spanMatch[1].replace(/\s+/g, " ").trim() : "";
      items.push({ number: num, data: token, title });
    }
    return items;
  }

  _encKai(text) {
    const url = this.encApi + "/enc-kai?text=" + encodeURIComponent(text);
    const res = this._fetchJson(url, { "User-Agent": "Mozilla/5.0" });
    return String(res.result || "");
  }

  _decKai(text) {
    const res = this._fetchJsonPost(
      this.encApi + "/dec-kai",
      { "Content-Type": "application/json" },
      JSON.stringify({ text: text })
    );
    return res && res.result ? res.result : null;
  }

  _decMega(text, userAgent) {
    const res = this._fetchJsonPost(
      this.encApi + "/dec-mega",
      { "Content-Type": "application/json" },
      JSON.stringify({
        text: text,
        agent: userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      })
    );
    return res;
  }

  search(arg) {
    arg = this._parseArg(arg);
    const q = String(arg.query || "").trim();
    if (!q) return [];

    const track = this._getTrack(arg);
    const normalizedQ = this._normalizeQuery(q);
    const cacheKey = normalizedQ + "|" + track;
    const cached = this._cacheGet(this._cache.search, cacheKey);
    if (cached !== undefined) return cached;

    const url = this.baseUrl + "/browser?keyword=" + encodeURIComponent(normalizedQ);
    const html = this._fetchText(url, {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "DNT": "1",
      "Cookie": "__ddg1_=;__ddg2_=;"
    });

    if (!html) {
      this._cacheSet(this._cache.search, cacheKey, []);
      return [];
    }

    const items = this._parseAnimeItems(html);
    const isDub = track === "dub";

    const results = items
      .filter(function (item) {
        if (isDub) return item.subOrDub === "dub" || item.subOrDub === "both";
        return true;
      })
      .map(function (item) {
        return {
          id: item.href + "?dub=" + isDub,
          title: item.title,
          url: "https://animekai.to/" + item.href,
          subOrDub: item.subOrDub
        };
      });

    this._cacheSet(this._cache.search, cacheKey, results);
    return results;
  }

  findEpisodes(Id) {
    const parts = String(Id || "").split("?dub=");
    const path = parts[0];
    const dubFlag = parts[1] === "true" ? "true" : "false";

    if (!path) return [];

    const cacheKey = path + "|" + dubFlag;
    const cached = this._cacheGet(this._cache.episodes, cacheKey);
    if (cached !== undefined) return cached;

    const pageUrl = this.baseUrl + "/" + path;
    const html = this._fetchText(pageUrl, {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "DNT": "1",
      "Cookie": "__ddg1_=;__ddg2_=;"
    });

    if (!html) return [];

    const idMatch = html.match(/<div class="rate-box"[^>]*data-id="([^"]+)"/);
    if (!idMatch) return [];
    const aniId = idMatch[1];

    const token = this._encKai(aniId);
    if (!token) return [];

    const ajaxUrl = this.baseUrl + "/ajax/episodes/list?ani_id=" + aniId + "&_=" + token;
    const ajaxResult = this._fetchJson(ajaxUrl, {
      "User-Agent": "Mozilla/5.0",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": this.baseUrl + "/"
    });

    const episodeHtml = String(ajaxResult.result || "");
    if (!episodeHtml) return [];

    const episodeItems = this._extractEpisodeItems(episodeHtml);
    if (!episodeItems.length) return [];

    const episodes = [];
    for (let i = 0; i < episodeItems.length; i += this.batchSize) {
      const batch = episodeItems.slice(i, i + this.batchSize);
      for (let j = 0; j < batch.length; j++) {
        const item = batch[j];
        try {
          const epToken = this._encKai(item.data);
          if (!epToken) continue;
          episodes.push({
            id: item.data,
            number: item.number,
            title: item.title || ("Episode " + item.number),
            url: this.baseUrl + "/ajax/links/list?token=" + item.data + "&_=" + epToken + "?dub=" + dubFlag
          });
        } catch (_) {
        }
      }
    }

    episodes.sort(function (a, b) { return a.number - b.number; });
    this._cacheSet(this._cache.episodes, cacheKey, episodes);
    return episodes;
  }

  findEpisodeServer(episodeObj, serverName) {
    let ep = episodeObj;
    if (typeof episodeObj === "string") {
      try { ep = JSON.parse(episodeObj); } catch (_) { ep = {}; }
    }

    const server = (serverName && serverName !== "default") ? serverName : "Server 1";
    const epUrl = String((ep && ep.url) || "");
    if (!epUrl) throw new Error("Missing episode URL");

    const cacheKey = "srv:" + epUrl + ":" + server;
    const cached = this._cacheGet(this._cache.servers, cacheKey);
    if (cached !== undefined) return cached;

    const urlParts = epUrl.split("?dub=");
    const episodeUrl = urlParts[0].replace(/\\u0026/g, "&");
    const dubRequested = urlParts[1] === "true";

    const linkListRes = this._fetchJson(episodeUrl, {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": this.baseUrl + "/"
    });

    if ((linkListRes.status !== "ok" && linkListRes.status !== 200) || !linkListRes.result) {
      throw new Error("Failed to fetch episode link list: " + linkListRes.status);
    }

    const cleanedHtml = this._cleanJsonHtml(String(linkListRes.result));

    const subMatch = /<div class="server-items lang-group" data-id="sub"[^>]*>([\s\S]*?)<\/div>/.exec(cleanedHtml);
    const softsubMatch = /<div class="server-items lang-group" data-id="softsub"[^>]*>([\s\S]*?)<\/div>/.exec(cleanedHtml);
    const dubMatch = /<div class="server-items lang-group" data-id="dub"[^>]*>([\s\S]*?)<\/div>/.exec(cleanedHtml);

    const subHtml = subMatch ? subMatch[1].trim() : "";
    const softsubHtml = softsubMatch ? softsubMatch[1].trim() : "";
    const dubHtml = dubMatch ? dubMatch[1].trim() : "";

    const serverLabel = server === "Server 2" ? "Server 2" : "Server 1";
    const serverSpanRegex = new RegExp('<span class="server"[^>]*data-lid="([^"]+)"[^>]*>' + serverLabel + "<\\/span>");

    const serverIdDub = (serverSpanRegex.exec(dubHtml) || [])[1];
    const serverIdSoftsub = (serverSpanRegex.exec(softsubHtml) || [])[1];
    const serverIdSub = (serverSpanRegex.exec(subHtml) || [])[1];

    const tokenRequestData = [
      { name: "Dub", data: serverIdDub },
      { name: "Softsub", data: serverIdSoftsub },
      { name: "Sub", data: serverIdSub }
    ].filter(function (item) { return !!item.data; });

    if (!tokenRequestData.length) throw new Error("No server IDs found in episode page");

    const streamUrls = {};
    for (let i = 0; i < tokenRequestData.length; i++) {
      const item = tokenRequestData[i];
      const encToken = this._encKai(item.data);
      if (!encToken) continue;
      const viewUrl = this.baseUrl + "/ajax/links/view?id=" + item.data + "&_=" + encToken;
      const viewRes = this._fetchJson(viewUrl, { "User-Agent": "Mozilla/5.0" });
      if (!viewRes.result) continue;

      const decResult = this._decKai(viewRes.result);
      if (decResult && decResult.url) {
        streamUrls[item.name] = decResult.url;
      }
    }

    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";
    const streamUrl = dubRequested
      ? (streamUrls["Dub"] || "")
      : (streamUrls["Sub"] || streamUrls["Softsub"] || "");

    if (!streamUrl) throw new Error("Unable to find a valid source");

    const headers = {
      "Referer": "https://animekai.to/",
      "User-Agent": ua
    };

    const mediaUrl = streamUrl.replace("/e/", "/media/");
    const mediaRes = this._fetchJson(mediaUrl, headers);
    if (!mediaRes || !mediaRes.result) throw new Error("Failed to fetch media JSON");

    const finalJson = this._decMega(mediaRes.result, ua);
    if (!finalJson || finalJson.status !== 200) throw new Error("Failed to decrypt final stream");
    if (!finalJson.result || !finalJson.result.sources || !finalJson.result.sources.length) {
      throw new Error("No video sources in decrypted response");
    }

    const m3u8Link = String(finalJson.result.sources[0].file || "");
    if (!m3u8Link) throw new Error("Empty m3u8 link");

    const playlistText = this._fetchText(m3u8Link, headers);
    const videoSources = [];
    const resRegex = /#EXT-X-STREAM-INF:BANDWIDTH=\d+,RESOLUTION=(\d+x\d+)\s*(.*)/g;
    let resMatch;
    while ((resMatch = resRegex.exec(playlistText)) !== null) {
      const resolution = resMatch[1];
      const relUrl = resMatch[2].trim();
      let finalUrl;
      if (relUrl.includes("list")) {
        finalUrl = m3u8Link.split(",")[0] + "/" + relUrl;
      } else {
        finalUrl = m3u8Link.split("/list")[0] + "/" + relUrl;
      }
      videoSources.push({
        quality: resolution.split("x")[1] + "p",
        url: finalUrl,
        type: "m3u8",
        subtitles: []
      });
    }

    if (!videoSources.length) {
      videoSources.push({
        quality: "auto",
        url: m3u8Link,
        type: "m3u8",
        subtitles: []
      });
    }

    const resp = {
      server: server,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "User-Agent": ua
      },
      videoSources: videoSources
    };

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
}

module.exports = AnimeKai;
