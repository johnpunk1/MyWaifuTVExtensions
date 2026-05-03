// Miruro.tv extension for WaifuTV
// API: https://www.miruro.tv/api/secure/pipe?e=BASE64URL(json_payload)
// Response: base64url(gzip(json))  [x-obfuscated: 1]
// Providers: arc=AnimeKai(intro/outro), zoro=HiAnime(VTT subs), kiwi=AnimePahe(hardsub)

class Miruro {
  constructor() {
    this.type       = "anime-streaming";
    this.version    = "1.1.0";
    this.baseUrl    = "https://www.miruro.tv";
    this.aniskipUrl = "https://api.aniskip.com/v2";
    this.ua         = "Mozilla/5.0 (Linux; Android 10; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

    // Provider preference: arc=AnimeKai has intro/outro, zoro=HiAnime has VTT subs, kiwi=AnimePahe hardsub
    this._subProviders = ["arc", "zoro", "kiwi"];
    this._dubProviders = ["zoro", "kiwi", "arc"];

    this._episodeCache    = {};
    this._episodeCacheTime = {};
    this._serverCache     = {};
    this._serverCacheTime  = {};
    this._malIdCache      = {};
    this._cacheTtl        = 8 * 60 * 1000;

    console.log("[Miruro] init version=" + this.version);
  }

  getSettings() {
    return {
      episodeServers:   ["default"],
      supportsSub:      true,
      supportsDub:      true,
      supportsHls:      true,
      supportsPlayback: true
    };
  }

  stream() { return null; }

  // ─── Cache ────────────────────────────────────────────────────────────────

  _cacheGet(store, timeMap, key) {
    var val = store[key];
    if (val === undefined) return undefined;
    if (Date.now() - (timeMap[key] || 0) > this._cacheTtl) {
      delete store[key]; delete timeMap[key]; return undefined;
    }
    return val;
  }
  _cacheSet(store, timeMap, key, val) {
    store[key] = val; timeMap[key] = Date.now();
  }

  // ─── Base64 helpers ───────────────────────────────────────────────────────

  _base64Encode(str) {
    try {
      // Rhino / JVM path
      var bytes = new java.lang.String(str).getBytes("UTF-8");
      return String(java.util.Base64.getEncoder().encodeToString(bytes));
    } catch (_) {}
    try { return btoa(unescape(encodeURIComponent(str))); } catch (_) {}
    return "";
  }

  _base64UrlEncode(str) {
    return this._base64Encode(str)
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  // ─── Pipe API ─────────────────────────────────────────────────────────────

  _encodePayload(path, query) {
    var payload = JSON.stringify({
      path: path, method: "GET", query: query || {}, body: null, version: "0.2.0"
    });
    return this._base64UrlEncode(payload);
  }

  // Decode base64url(gzip(json)) response → parsed object
  _decodeBody(body) {
    if (!body || body.length < 4) return null;
    var b64 = body.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    try {
      var compressed = java.util.Base64.getDecoder().decode(b64);
      var gzis       = new java.util.zip.GZIPInputStream(
                         new java.io.ByteArrayInputStream(compressed));
      var reader     = new java.io.BufferedReader(
                         new java.io.InputStreamReader(gzis, "UTF-8"));
      var sb = new java.lang.StringBuilder();
      var line;
      while ((line = reader.readLine()) !== null) sb.append(line).append("\n");
      reader.close();
      return JSON.parse(String(sb.toString()).trim());
    } catch (e) {
      console.error("[Miruro] _decodeBody error: " + (e.message || e));
      return null;
    }
  }

  _pipe(path, query) {
    var e   = this._encodePayload(path, query);
    var url = this.baseUrl + "/api/secure/pipe?e=" + e;
    console.log("[Miruro] pipe path=" + path + " query=" + JSON.stringify(query));
    var res = this._fetch(url);
    if (!res || !res.body) { console.warn("[Miruro] pipe empty path=" + path); return null; }
    var data = this._decodeBody(res.body);
    if (!data) console.warn("[Miruro] pipe decode failed path=" + path);
    return data;
  }

  // ─── Network ──────────────────────────────────────────────────────────────

  _fetch(url) {
    console.log("[Miruro] fetch " + url.substring(0, 120));
    try {
      var raw = Native.fetch(String(url), "GET", JSON.stringify({
        "User-Agent":      this.ua,
        "Accept":          "text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer":         this.baseUrl + "/"
      }), "");
      var j = {};
      try { j = JSON.parse(raw || "{}"); } catch (_) {}
      var status = Number(j.status || 0);
      var bodyLen = String(j.body || "").length;
      console.log("[Miruro] fetch status=" + status + " bodyLen=" + bodyLen);
      if (!j.ok && status !== 304) return null;
      return { body: String(j.body || "") };
    } catch (e) {
      console.error("[Miruro] fetch error: " + e.message);
      return null;
    }
  }

  // ─── Arg / ID parsing ─────────────────────────────────────────────────────

  _parseArg(arg) {
    if (typeof arg === "string") {
      var s = arg.trim();
      try { return s[0] === "{" || s[0] === "[" ? JSON.parse(s) : { query: s }; }
      catch (_) { return { query: s }; }
    }
    return arg || {};
  }

  _getTrack(obj) {
    if (obj && obj.dub === true) return "dub";
    if (obj && obj.dub === false) return "sub";
    var t = String((obj && (obj.subOrDub || obj.track)) || "").toLowerCase();
    return t === "dub" ? "dub" : "sub";
  }

  _parseMediaId(mediaId) {
    var raw   = String(mediaId || "").trim();
    var track = raw.toLowerCase().endsWith("/dub") ? "dub" : "sub";
    raw = raw.replace(/\/(sub|dub)$/i, "");
    return { anilistId: raw, track: track };
  }

  // episodeId: "{anilistId}|{b64url_epId}|{epNum}|{provider}/{track}"
  _parseEpisodeObj(episodeObj) {
    var ep = episodeObj;
    if (typeof episodeObj === "string") {
      try { ep = JSON.parse(episodeObj); } catch (_) { ep = { id: episodeObj }; }
    }
    var raw   = String((ep && ep.id) || "").trim();
    var track = raw.toLowerCase().endsWith("/dub") ? "dub" : "sub";
    raw = raw.replace(/\/(sub|dub)$/i, "");
    var parts = raw.split("|");
    return {
      anilistId: parts[0] || "",
      b64EpId:   parts[1] || "",
      epNum:     parseInt(parts[2] || "0", 10) || (ep && ep.number) || 0,
      provider:  parts[3] || "",
      track:     track
    };
  }

  _normalize(s) {
    return String(s || "").toLowerCase()
      .replace(/(season|part|the animation|the movie|movie|uncensored|cour)/g, "")
      .replace(/\biii\b/g, "3").replace(/\bii\b/g, "2").replace(/\biv\b/g, "4")
      .replace(/[^a-z0-9]+/g, "");
  }
  _scoreTitle(candidate, targets) {
    var c = this._normalize(candidate);
    if (!c) return 0;
    var best = 0;
    for (var i = 0; i < targets.length; i++) {
      var t = this._normalize(targets[i]);
      if (!t) continue;
      if (c === t) { best = Math.max(best, 1000); continue; }
      if (c.indexOf(t) !== -1 || t.indexOf(c) !== -1) { best = Math.max(best, 850); continue; }
    }
    return best;
  }

  // ─── search() ─────────────────────────────────────────────────────────────

  search(arg) {
    arg = this._parseArg(arg);
    var q     = String(arg.query || arg.title || arg.name || "").trim();
    var track = this._getTrack(arg);
    var media = arg.media || {};

    // Fast path: AniList ID already known
    var directId = String(arg.anilistId || media.anilistId || media.id || "").trim();
    if (directId && /^\d+$/.test(directId)) {
      var title = media.englishTitle || media.romajiTitle || q || ("Anime " + directId);
      console.log("[Miruro] search fast-path anilistId=" + directId + " track=" + track);
      return [{
        id: directId + "/" + track, title: title,
        jname: media.romajiTitle || "",
        url: this.baseUrl + "/watch/" + directId, subOrDub: track
      }];
    }

    if (!q) return [];

    var targets = [q];
    if (media.englishTitle) targets.push(media.englishTitle);
    if (media.romajiTitle)  targets.push(media.romajiTitle);
    if (media.nativeTitle)  targets.push(media.nativeTitle);
    if (media.altTitles) for (var i = 0; i < media.altTitles.length; i++) targets.push(media.altTitles[i]);

    console.log("[Miruro] search q=" + q + " track=" + track);
    var data = this._pipe("search", { q: q, limit: 15, offset: 0, type: "ANIME", sort: "POPULARITY_DESC" });
    if (!data || !Array.isArray(data) || !data.length) {
      console.warn("[Miruro] search no results q=" + q); return [];
    }

    var out = [];
    for (var r = 0; r < data.length; r++) {
      var item = data[r];
      if (!item || !item.id) continue;
      var en  = (item.title && item.title.english) || "";
      var ro  = (item.title && item.title.romaji)  || "";
      var pri = en || ro || ("Anime " + item.id);
      out.push({
        id: String(item.id) + "/" + track, title: pri,
        jname: ro !== pri ? ro : "", url: this.baseUrl + "/watch/" + item.id,
        subOrDub: track,
        _score: Math.max(this._scoreTitle(en, targets), this._scoreTitle(ro, targets))
      });
    }
    out.sort(function(a, b) { return b._score - a._score; });
    console.log("[Miruro] search found=" + out.length + " top=" + (out[0] ? out[0].id : "none"));
    return out.map(function(x) { delete x._score; return x; });
  }

  // ─── findEpisodes() ───────────────────────────────────────────────────────

  findEpisodes(mediaId) {
    console.log("[Miruro] findEpisodes START mediaId=" + mediaId);
    var parsed    = this._parseMediaId(mediaId);
    var anilistId = parsed.anilistId;
    var track     = parsed.track;

    if (!anilistId) { console.error("[Miruro] findEpisodes ABORT empty anilistId"); return []; }

    var cacheKey = anilistId + "|" + track;
    var cached   = this._cacheGet(this._episodeCache, this._episodeCacheTime, cacheKey);
    if (cached !== undefined) {
      console.log("[Miruro] findEpisodes CACHE HIT count=" + cached.length);
      return cached;
    }

    var data = this._pipe("episodes", { anilistId: anilistId });
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      console.error("[Miruro] findEpisodes null/bad response anilistId=" + anilistId);
      return [];
    }

    // Cache malId if present (some episode responses include it)
    if (data._malId && !this._malIdCache[anilistId]) {
      this._malIdCache[anilistId] = String(data._malId);
    }

    // Select best provider for this track
    var providerOrder = track === "dub" ? this._dubProviders : this._subProviders;
    var chosenProvider = null;
    var chosenEps = [];

    for (var pi = 0; pi < providerOrder.length; pi++) {
      var pname = providerOrder[pi];
      var pdata = data[pname];
      if (!pdata || !pdata.episodes) continue;
      var eps = pdata.episodes[track === "dub" ? "dub" : "sub"] || [];
      if (eps.length > 0) {
        chosenProvider = pname;
        chosenEps = eps;
        console.log("[Miruro] findEpisodes provider=" + pname + " count=" + eps.length);
        break;
      }
    }

    // Last resort: any provider with most episodes
    if (!chosenEps.length) {
      var keys = Object.keys(data);
      for (var ki = 0; ki < keys.length; ki++) {
        var kdata = data[keys[ki]];
        if (!kdata || !kdata.episodes) continue;
        var keps = kdata.episodes[track === "dub" ? "dub" : "sub"] || [];
        if (keps.length > chosenEps.length) { chosenProvider = keys[ki]; chosenEps = keps; }
      }
    }

    if (!chosenEps.length) {
      console.error("[Miruro] findEpisodes no episodes anilistId=" + anilistId + " track=" + track);
      return [];
    }

    var episodes = [];
    for (var i = 0; i < chosenEps.length; i++) {
      var ep    = chosenEps[i];
      if (!ep || !ep.id) continue;
      var epNum = ep.number || (i + 1);
      episodes.push({
        id:     anilistId + "|" + ep.id + "|" + epNum + "|" + chosenProvider + "/" + track,
        number: epNum,
        title:  ep.title || ("Episode " + epNum),
        url:    this.baseUrl + "/watch/" + anilistId + "?ep=" + epNum,
        image:  ep.image || ""
      });
    }

    episodes.sort(function(a, b) { return a.number - b.number; });
    console.log("[Miruro] findEpisodes SUCCESS count=" + episodes.length + " provider=" + chosenProvider);

    this._cacheSet(this._episodeCache, this._episodeCacheTime, cacheKey, episodes);
    return episodes;
  }

  // ─── AniSkip (fallback intro/outro) ──────────────────────────────────────

  _getMalId(anilistId) {
    if (this._malIdCache[anilistId]) return this._malIdCache[anilistId];
    var info = this._pipe("info/" + anilistId, {});
    if (info && info.malId) {
      this._malIdCache[anilistId] = String(info.malId);
      return this._malIdCache[anilistId];
    }
    return null;
  }

  _getAniSkip(malId, epNum) {
    if (!malId || !epNum) return null;
    try {
      var url = this.aniskipUrl + "/skip-times/" + malId + "/" + epNum + "?types=op&types=ed&episodeLength=0";
      var res = this._fetch(url);
      if (!res || !res.body) return null;
      var data = JSON.parse(res.body);
      if (!data || !data.results || !data.results.length) return null;
      var intro = null, outro = null;
      for (var i = 0; i < data.results.length; i++) {
        var item     = data.results[i];
        var interval = item.interval || {};
        var start    = Number(interval.startTime || 0);
        var end      = Number(interval.endTime   || 0);
        if (end <= start) continue;
        var type = String(item.skipType || "").toLowerCase();
        if (type === "op" || type === "mixed-op")      intro = { start: start, end: end };
        else if (type === "ed" || type === "mixed-ed") outro = { start: start, end: end };
      }
      if (intro) console.log("[Miruro] AniSkip intro=" + JSON.stringify(intro));
      if (outro) console.log("[Miruro] AniSkip outro=" + JSON.stringify(outro));
      return { intro: intro, outro: outro };
    } catch (e) {
      console.warn("[Miruro] _getAniSkip error: " + e.message);
      return null;
    }
  }

  // ─── findEpisodeServer() ──────────────────────────────────────────────────

  findEpisodeServer(episodeObj, serverName) {
    console.log("[Miruro] findEpisodeServer START obj=" + JSON.stringify(episodeObj));
    var ep = this._parseEpisodeObj(episodeObj);
    console.log("[Miruro] findEpisodeServer anilistId=" + ep.anilistId
      + " provider=" + ep.provider + " epNum=" + ep.epNum + " track=" + ep.track);

    if (!ep.b64EpId)  throw new Error("Missing episode ID");
    if (!ep.provider) throw new Error("Missing provider");

    var cacheKey = ep.b64EpId + ":" + ep.provider + ":" + ep.track;
    var cached   = this._cacheGet(this._serverCache, this._serverCacheTime, cacheKey);
    if (cached !== undefined) { console.log("[Miruro] findEpisodeServer CACHE HIT"); return cached; }

    var query = {
      episodeId: ep.b64EpId,
      provider:  ep.provider,
      category:  ep.track === "dub" ? "dub" : "sub"
    };
    if (ep.anilistId) query.anilistId = parseInt(ep.anilistId, 10) || ep.anilistId;

    var data = this._pipe("sources", query);
    if (!data) throw new Error("No response from sources");

    var streams = data.streams || [];
    if (!streams.length) throw new Error("No streams returned");

    // Pick best active HLS stream, highest quality
    var best = null;
    for (var i = 0; i < streams.length; i++) {
      var s = streams[i];
      if (s.type !== "hls" || !s.url) continue;
      if (!best) { best = s; continue; }
      var sActive = s.isActive !== false;
      var bActive = best.isActive !== false;
      var sq = parseInt(String(s.quality || "0"), 10) || 0;
      var bq = parseInt(String(best.quality || "0"), 10) || 0;
      if (sActive && !bActive) { best = s; continue; }
      if (sq > bq && (sActive || !bActive)) best = s;
    }
    if (!best) {
      for (var j = 0; j < streams.length; j++) {
        if (streams[j].type !== "embed" && streams[j].url) { best = streams[j]; break; }
      }
    }
    if (!best || !best.url) throw new Error("No playable stream");

    var streamUrl = best.url;
    var referer   = best.referer || "https://miruro.tv/";
    var origin    = referer.replace(/\/+$/, "").split("/").slice(0, 3).join("/");

    // Subtitles (zoro provider returns VTT tracks)
    var subtitles = [];
    var tracks = data.subtitles || data.tracks || [];
    for (var k = 0; k < tracks.length; k++) {
      var t = tracks[k];
      var tUrl = t.url || t.file || "";
      if (!tUrl) continue;
      var lang = t.lang || t.label || t.language || "Unknown";
      if (lang.toLowerCase() === "thumbnails" || t.kind === "thumbnails") continue;
      subtitles.push({
        id: "sub-" + k, language: lang, url: tUrl,
        isDefault: !!(t.default || lang.toLowerCase() === "english")
      });
    }

    // Intro/outro — arc (AnimeKai via Miruro) returns these directly
    var intro = null, outro = null;
    if (data.intro && data.intro.start !== undefined && data.intro.end !== undefined) {
      var is = Number(data.intro.start), ie = Number(data.intro.end);
      if (ie > is) intro = { start: is, end: ie };
    }
    if (data.outro && data.outro.start !== undefined && data.outro.end !== undefined) {
      var os = Number(data.outro.start), oe = Number(data.outro.end);
      if (oe > os) outro = { start: os, end: oe };
    }

    // AniSkip fallback for providers that don't return timestamps
    if (!intro && !outro && ep.anilistId && ep.epNum) {
      var malId = this._getMalId(ep.anilistId);
      if (malId) {
        var skip = this._getAniSkip(malId, ep.epNum);
        if (skip) { intro = skip.intro; outro = skip.outro; }
      }
    }

    console.log("[Miruro] findEpisodeServer SUCCESS url=" + streamUrl.substring(0, 80)
      + " subs=" + subtitles.length + " intro=" + !!intro + " outro=" + !!outro);

    var resp = {
      server:       ep.provider,
      headers:      { "Referer": referer, "Origin": origin, "User-Agent": this.ua },
      videoSources: [{ url: streamUrl, file: streamUrl, type: "m3u8",
                       quality: best.quality || "auto", subtitles: subtitles }],
      sources:      [{ url: streamUrl, file: streamUrl, type: "m3u8", quality: best.quality || "auto" }],
      subtitles:    subtitles,
      intro:        intro,
      outro:        outro
    };

    this._cacheSet(this._serverCache, this._serverCacheTime, cacheKey, resp);
    return resp;
  }
}

module.exports = Miruro;
