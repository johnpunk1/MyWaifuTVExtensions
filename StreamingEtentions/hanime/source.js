class Hanime {
  constructor() {
    this.type = "anime-streaming";
    this.version = "1.0.0";
    this.baseUrl = "https://hanime.tv";
    this.searchUrl = "https://search.htv-services.com";
    this.episodeUrl = "https://h.freeanimehentai.net/api/v8/video?id=";
    this.refererApi = "https://player.hanime.tv";
    this._cache = {
      search:   new Map(),
      episodes: new Map(),
      servers:  new Map(),
      _maxSize: 300,
      _ttl: 8 * 60 * 1000
    };
  }

  getSettings() {
    return {
      episodeServers: ["Shiva"],
      supportsSub: false,
      supportsDub: false,
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

  _fetchJsonPost(url, headers, body) {
    const txt = String(this._nativeFetch(url, "POST", headers || {}, body || "").body || "").replace(/^\uFEFF/, "").trim();
    if (!txt) return {};
    try {
      const obj = JSON.parse(txt);
      return (obj && typeof obj === "object") ? obj : {};
    } catch {
      return {};
    }
  }

  _parseArg(arg) {
    if (typeof arg === "string") {
      const s = arg.trim();
      try { return (s.startsWith("{") || s.startsWith("[")) ? JSON.parse(s) : { query: s }; } catch { return { query: s }; }
    }
    return arg || {};
  }

  _replaceAndWithAmpersand(text) {
    return String(text || "").replace(/\b(And|and)\b/g, "&");
  }

  _parseHits(hitsStr) {
    try {
      const arr = JSON.parse(hitsStr);
      if (!Array.isArray(arr)) return [];
      return arr.map(raw => ({
        id: String(raw.id || ""),
        title: String(raw.name || ""),
        url: String(raw.slug || ""),
        subOrDub: raw.dub ? "dub" : "sub"
      }));
    } catch {
      return [];
    }
  }

  _fetchSearch(searchText, page) {
    const body = JSON.stringify({
      blacklist: [],
      brands: [],
      order_by: "created_at_unix",
      page: page - 1,
      tags: [],
      search_text: searchText,
      tags_mode: "AND"
    });
    return this._fetchJsonPost(this.searchUrl, {
      "Content-Type": "application/json",
      "Cookie": "__ddg1_=;__ddg2_=;"
    }, body);
  }

  search(arg) {
    arg = this._parseArg(arg);
    let q = this._replaceAndWithAmpersand(String(arg.query || "").trim());
    if (!q) return [];

    const cacheKey = q;
    const cached = this._cacheGet(this._cache.search, cacheKey);
    if (cached !== undefined) return cached;

    let page = 1;
    let data = this._fetchSearch(q, page);
    let results = this._parseHits(String(data.hits || "[]"));

    while ((!results.length || data.nbHits === 0) && q.split(" ").length > 3) {
      q = this._replaceAndWithAmpersand(q.split(" ").slice(0, -1).join(" "));
      data = this._fetchSearch(q, page);
      results = this._parseHits(String(data.hits || "[]"));
    }

    const nbPages = parseInt(data.nbPages, 10) || 1;
    while (nbPages > page) {
      page++;
      const more = this._fetchSearch(q, page);
      results.push(...this._parseHits(String(more.hits || "[]")));
    }

    results = results.map(r => ({
      id: r.url,
      title: r.title.replace(/\s*\d+$/, ""),
      url: `${this.baseUrl}/videos/hentai/${r.url}`.replace(/-\d+$/, ""),
      subOrDub: r.subOrDub
    }));

    this._cacheSet(this._cache.search, cacheKey, results);
    return results;
  }

  findEpisodes(id) {
    const cleanId = String(id || "").split("/")[0];
    if (!cleanId) return [];

    const cached = this._cacheGet(this._cache.episodes, cleanId);
    if (cached !== undefined) return cached;

    const url = `${this.baseUrl}/videos/hentai/${cleanId}`;
    const html = this._fetchText(url, {
      "User-Agent": "Mozilla/5.0",
      "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
      "Referer": this.baseUrl + "/"
    });

    if (!html) return [];

    const nuxtRaw = html.split("window.__NUXT__=")[1];
    if (!nuxtRaw) return [];
    const nuxtStr = nuxtRaw.split(";</script>")[0];
    if (!nuxtStr) return [];

    let json;
    try { json = eval("(" + nuxtStr + ")"); } catch { return []; }

    const videoData = json && json.state && json.state.data && json.state.data.video;
    if (!videoData) return [];

    const franchise = videoData.hentai_franchise || {};
    const videos = Array.isArray(videoData.hentai_franchise_hentai_videos)
      ? videoData.hentai_franchise_hentai_videos
      : [];

    const episodes = videos.map((video, idx) => ({
      id: String(video.id || ""),
      number: idx + 1,
      title: String(franchise.name || video.name || `Episode ${idx + 1}`),
      url: `${this.episodeUrl}${video.slug}`
    }));

    this._cacheSet(this._cache.episodes, cleanId, episodes);
    return episodes;
  }

  findEpisodeServer(episodeObj, serverName) {
    let ep = episodeObj;
    if (typeof episodeObj === "string") { try { ep = JSON.parse(episodeObj); } catch { ep = {}; } }

    const epUrl = String((ep && ep.url) || "");
    if (!epUrl) throw new Error("Missing episode url");

    const preferred = String(serverName || "Shiva").trim();
    const cacheKey = `${epUrl}:${preferred}`;
    const cached = this._cacheGet(this._cache.servers, cacheKey);
    if (cached !== undefined) return cached;

    const data = this._fetchJson(epUrl, {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json",
      "Referer": this.baseUrl + "/"
    });

    if (!data || !data.videos_manifest) throw new Error(`No videos manifest for episode`);

    const videos = [];
    const servers = Array.isArray(data.videos_manifest.servers) ? data.videos_manifest.servers : [];

    for (const srv of servers) {
      if (String(srv.name || "") !== preferred) continue;
      const streams = Array.isArray(srv.streams) ? srv.streams : [];
      for (const stream of streams) {
        if (!stream.is_guest_allowed) continue;
        if (!stream.url) continue;
        videos.push({
          url: stream.url,
          type: "m3u8",
          quality: stream.height ? `${stream.height}p` : "auto",
          subtitles: []
        });
      }
    }

    if (!videos.length) throw new Error(`Server '${preferred}' returned no playable streams`);

    const resp = {
      server: preferred,
      headers: { "Referer": this.refererApi },
      videoSources: videos
    };

    this._cacheSet(this._cache.servers, cacheKey, resp);
    return resp;
  }
}

module.exports = Hanime;
