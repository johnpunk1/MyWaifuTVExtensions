class Senshi {
  constructor() {
    this.type = "anime-streaming";
    this.version = "1.0.0";
    this.baseUrl = "https://senshi.live";
    this._cache = {
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
      episodeServers: ["default"],
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

  _fetchJsonPost(url, headers, body) {
    const res = this._nativeFetch(url, "POST", headers || {}, body == null ? "" : String(body));
    const txt = String(res.body || "").replace(/^\uFEFF/, "").trim();
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

  _headers() {
    return {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json",
      "Accept-Language": "en-US,en;q=0.9",
      "Referer": this.baseUrl + "/",
      "Origin": this.baseUrl
    };
  }

  search(arg) {
    arg = this._parseArg(arg);
    const q = String(arg.query || "").trim();
    if (!q) return [];

    const track = this._getTrack(arg);
    const cacheKey = q + "|" + track;
    const cached = this._cacheGet(this._cache.search, cacheKey);
    if (cached !== undefined) return cached;

    const data = this._fetchJsonPost(
      this.baseUrl + "/anime/filter",
      { "Content-Type": "application/json" },
      JSON.stringify({ searchTerm: q, page: 1, limit: 5 })
    );

    const list = (data && data.data) ? data.data : data;
    if (!Array.isArray(list) || !list.length) {
      this._cacheSet(this._cache.search, cacheKey, []);
      return [];
    }

    const results = list
      .filter(function (item) {
        if (track === "dub") return !!item.has_dub;
        return true;
      })
      .map(function (item) {
        return {
          id: String(item.id || "") + "/" + track,
          title: String(item.title_english || item.title || ""),
          url: "https://senshi.live/anime/" + (item.public_id || ""),
          subOrDub: track
        };
      });

    this._cacheSet(this._cache.search, cacheKey, results);
    return results;
  }

  findEpisodes(Id) {
    const parts = String(Id || "").split("/");
    const id = parts[0];
    const track = parts[1] === "dub" ? "dub" : "sub";

    if (!id) return [];

    const cacheKey = id + "|" + track;
    const cached = this._cacheGet(this._cache.episodes, cacheKey);
    if (cached !== undefined) return cached;

    const data = this._fetchJson(
      this.baseUrl + "/episodes/" + id,
      this._headers()
    );

    if (!Array.isArray(data)) {
      this._cacheSet(this._cache.episodes, cacheKey, []);
      return [];
    }

    const episodes = data.map(function (ep) {
      const num = ep.ep_id;
      return {
        id: String(ep.mal_id || id) + "/" + track,
        number: num,
        title: String(ep.ep_title || ("Episode " + num)),
        url: "https://senshi.live/episode-embeds/" + (ep.mal_id || id) + "/" + num
      };
    });

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
    const epUrl = String((ep && ep.url) || "");
    if (!epUrl) throw new Error("Missing episode url in episodeObj");

    const episodeNumber = parseFloat(ep.number);
    if (!isFinite(episodeNumber)) throw new Error("Missing episode number");

    const cacheKey = "src:" + id + ":" + episodeNumber + ":" + track;
    const cached = this._cacheGet(this._cache.servers, cacheKey);
    if (cached !== undefined) return cached;

    const data = this._fetchJson(epUrl, this._headers());

    if (!Array.isArray(data)) {
      throw new Error("No sources returned from episode URL");
    }

    const filtered = track === "dub"
      ? data.filter(function (s) { return s.status === "Dub"; })
      : data.filter(function (s) { return s.status === "HardSub"; });

    if (!filtered.length) {
      throw new Error("No matching sources for track: " + track);
    }

    const videoSources = filtered
      .filter(function (s) { return !!s.url; })
      .map(function (s) {
        const type = String(s.url).indexOf(".m3u8") !== -1 ? "m3u8" : "mp4";
        return {
          url: s.url,
          type: type,
          quality: "auto",
          subtitles: []
        };
      });

    if (!this._looksPlayable({ videoSources: videoSources })) {
      throw new Error("No playable video sources found");
    }

    const resp = {
      server: serverName || "default",
      headers: {
        "Referer": this.baseUrl
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

module.exports = Senshi;
