class Miruro {
  constructor() {
    this.type       = "anime-streaming";
    this.version    = "1.0.0";
    this.baseUrl    = "https://public-miruro-consumet-api.vercel.app";
    this.aniskipUrl = "https://api.aniskip.com/v2";
    this.ua         = "Mozilla/5.0 (Linux; Android 10; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

    this._episodeCache    = {};
    this._episodeTimeMap  = {};
    this._serverCache     = {};
    this._serverTimeMap   = {};
    this._malIdCache      = {};   // anilistId → malId (permanent, malId never changes)
    this._cacheTtl        = 8 * 60 * 1000; // 8 minutes

    console.log("[Miruro] constructor called version=" + this.version);
  }

  // ─────────────────────────────────────────────
  // Settings
  // ─────────────────────────────────────────────

  getSettings() {
    return {
      episodeServers: ["default"],
      supportsSub:    true,
      supportsDub:    true,
      supportsHls:    true,
      supportsPlayback: true
    };
  }

  stream() { return null; }

  // ─────────────────────────────────────────────
  // Cache helpers
  // ─────────────────────────────────────────────

  _cacheGet(store, timeMap, key) {
    var val = store[key];
    if (val === undefined) return undefined;
    if (Date.now() - (timeMap[key] || 0) > this._cacheTtl) {
      delete store[key]; delete timeMap[key]; return undefined;
    }
    return val;
  }

  _cacheSet(store, timeMap, key, value) {
    store[key] = value;
    timeMap[key] = Date.now();
  }

  // ─────────────────────────────────────────────
  // Network
  // ─────────────────────────────────────────────

  _nativeFetch(url, method, headers, body) {
    console.log("[Miruro] fetch url=" + url);
    try {
      var raw = Native.fetch(
        String(url), method || "GET",
        JSON.stringify(headers || {}),
        body == null ? "" : String(body)
      );
      var j = {};
      try { j = JSON.parse(raw || "{}"); } catch (_) {}
      console.log("[Miruro] fetch DONE status=" + (j.status || 0) + " bodyLen=" + String(j.body || "").length);
      return { ok: !!j.ok, status: Number(j.status || 0), body: String(j.body || "") };
    } catch (e) {
      console.error("[Miruro] fetch EXCEPTION url=" + url + " err=" + e.message);
      return { ok: false, status: 0, body: "" };
    }
  }

  _getJson(url) {
    var res = this._nativeFetch(url, "GET", {
      "User-Agent":      this.ua,
      "Accept":          "application/json",
      "Accept-Language": "en-US,en;q=0.9"
    }, "");
    if (!res.body) {
      console.warn("[Miruro] _getJson empty body url=" + url);
      return null;
    }
    try {
      return JSON.parse(res.body);
    } catch (e) {
      console.warn("[Miruro] _getJson parse error url=" + url + " preview=" + res.body.substring(0, 80));
      return null;
    }
  }

  // ─────────────────────────────────────────────
  // Arg / ID parsing
  // ─────────────────────────────────────────────

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

  // Parse "anilistId/track"
  _parseMediaId(mediaId) {
    var raw   = String(mediaId || "").trim();
    var track = raw.toLowerCase().endsWith("/dub") ? "dub" : "sub";
    raw = raw.replace(/\/(sub|dub)$/i, "");
    return { anilistId: raw, track: track };
  }

  // Parse "anilistId|consumetEpisodeId|epNumber/track"
  _parseEpisodeObj(episodeObj) {
    var ep = episodeObj;
    if (typeof episodeObj === "string") {
      try { ep = JSON.parse(episodeObj); } catch (_) { ep = { id: episodeObj }; }
    }
    var raw   = String((ep && ep.id) || "").trim();
    var track = raw.toLowerCase().endsWith("/dub") ? "dub" : "sub";
    raw = raw.replace(/\/(sub|dub)$/i, "");

    // format: anilistId|consumetEpisodeId|epNumber
    var parts      = raw.split("|");
    var anilistId  = parts[0] || "";
    var consumetId = parts[1] || "";
    var epNum      = parseInt(parts[2] || "0", 10) || (ep && ep.number) || 0;

    return { anilistId: anilistId, consumetId: consumetId, epNum: epNum, track: track };
  }

  // ─────────────────────────────────────────────
  // Title scoring
  // ─────────────────────────────────────────────

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
      if (c === t)                             { best = Math.max(best, 1000); continue; }
      if (c.indexOf(t) !== -1 || t.indexOf(c) !== -1) { best = Math.max(best, 850); continue; }
      // prefix similarity
      var shorter = c.length <= t.length ? c : t;
      var longer  = c.length <= t.length ? t : c;
      var pfx = 0;
      while (pfx < shorter.length && shorter[pfx] === longer[pfx]) pfx++;
      best = Math.max(best, Math.floor((pfx / shorter.length) * 0.7 * 700));
    }
    return best;
  }

  // ─────────────────────────────────────────────
  // search()
  // ─────────────────────────────────────────────

  search(arg) {
    arg = this._parseArg(arg);
    var q     = String(arg.query || arg.title || arg.name || "").trim();
    var track = this._getTrack(arg);
    var media = arg.media || {};

    // ── Fast path: AniList ID is already available ──
    // WaifuTV may pass it as arg.anilistId or arg.media.anilistId or arg.media.id
    var directId = String(arg.anilistId || (media && media.anilistId) || (media && media.id) || "").trim();
    if (directId && /^\d+$/.test(directId)) {
      var displayTitle = (media.englishTitle || media.romajiTitle || q || ("Anime " + directId));
      console.log("[Miruro] search using direct anilistId=" + directId + " track=" + track);
      return [{
        id:        directId + "/" + track,
        title:     displayTitle,
        jname:     media.romajiTitle || "",
        url:       "https://miruro.tv/watch/" + directId,
        subOrDub:  track
      }];
    }

    if (!q) return [];

    // Build scoring targets from every title variant we know
    var targets = [q];
    if (media.englishTitle) targets.push(media.englishTitle);
    if (media.romajiTitle)  targets.push(media.romajiTitle);
    if (media.nativeTitle)  targets.push(media.nativeTitle);
    if (media.altTitles && media.altTitles.length) {
      for (var i = 0; i < media.altTitles.length; i++) targets.push(media.altTitles[i]);
    }

    console.log("[Miruro] search q=" + q + " track=" + track);

    var data = this._getJson(this.baseUrl + "/meta/anilist/" + encodeURIComponent(q) + "?page=1&perPage=15");
    if (!data || !data.results || !data.results.length) {
      console.warn("[Miruro] search no results q=" + q);
      return [];
    }

    var out = [];
    for (var r = 0; r < data.results.length; r++) {
      var item = data.results[r];
      if (!item || !item.id) continue;

      var en  = (item.title && item.title.english)        || "";
      var ro  = (item.title && item.title.romaji)         || "";
      var na  = (item.title && item.title.native)         || "";
      var pri = en || ro || ("Anime " + item.id);

      var score = Math.max(
        this._scoreTitle(en, targets),
        this._scoreTitle(ro, targets),
        this._scoreTitle(na, targets)
      );

      out.push({
        id:       String(item.id) + "/" + track,
        title:    pri,
        jname:    ro !== pri ? ro : na,
        url:      "https://miruro.tv/watch/" + item.id,
        subOrDub: track,
        _score:   score
      });
    }

    out.sort(function(a, b) { return b._score - a._score; });
    console.log("[Miruro] search found=" + out.length + " topId=" + (out[0] ? out[0].id : "none") + " topScore=" + (out[0] ? out[0]._score : 0));
    return out.map(function(x) { delete x._score; return x; });
  }

  // ─────────────────────────────────────────────
  // findEpisodes()
  // ─────────────────────────────────────────────

  findEpisodes(mediaId) {
    console.log("[Miruro] findEpisodes START mediaId=" + mediaId);
    var parsed    = this._parseMediaId(mediaId);
    var anilistId = parsed.anilistId;
    var track     = parsed.track;

    if (!anilistId) { console.error("[Miruro] findEpisodes ABORT empty anilistId"); return []; }

    var cacheKey = anilistId + "|" + track;
    var cached   = this._cacheGet(this._episodeCache, this._episodeTimeMap, cacheKey);
    if (cached !== undefined) {
      console.log("[Miruro] findEpisodes CACHE HIT count=" + cached.length);
      return cached;
    }

    // Use /meta/anilist/info/{id} — the Miruro Consumet deployment does not expose
    // the separate /meta/anilist/episodes/{id} route (returns 404).
    // The info endpoint returns the full object including an `episodes` array.
    var url = this.baseUrl + "/meta/anilist/info/" + encodeURIComponent(anilistId) + "?provider=zoro";
    console.log("[Miruro] findEpisodes url=" + url);
    var data = this._getJson(url);

    if (!data) {
      console.error("[Miruro] findEpisodes null response anilistId=" + anilistId);
      return [];
    }

    // Episodes live under data.episodes
    var epArray = data.episodes;
    if (!epArray || !Array.isArray(epArray) || !epArray.length) {
      console.error("[Miruro] findEpisodes no episodes array anilistId=" + anilistId + " keys=" + Object.keys(data).join(","));
      return [];
    }

    // Cache malId now — saves an extra /info call later when AniSkip runs
    if (data.malId && !this._malIdCache[anilistId]) {
      this._malIdCache[anilistId] = String(data.malId);
      console.log("[Miruro] findEpisodes cached malId=" + data.malId + " for anilistId=" + anilistId);
    }

    var episodes = [];
    for (var i = 0; i < epArray.length; i++) {
      var ep    = epArray[i];
      if (!ep || !ep.id) continue;
      var epNum = ep.number || (i + 1);

      // Encode anilistId + consumetId + epNumber into the id so findEpisodeServer
      // has everything it needs without an extra lookup.
      episodes.push({
        id:     anilistId + "|" + ep.id + "|" + epNum + "/" + track,
        number: epNum,
        title:  ep.title || ("Episode " + epNum),
        url:    "https://miruro.tv/watch/" + anilistId + "?ep=" + epNum,
        image:  ep.image || ""
      });
    }

    episodes.sort(function(a, b) { return a.number - b.number; });
    console.log("[Miruro] findEpisodes SUCCESS count=" + episodes.length);

    this._cacheSet(this._episodeCache, this._episodeTimeMap, cacheKey, episodes);
    return episodes;
  }

  // ─────────────────────────────────────────────
  // AniSkip helper (intro / outro timestamps)
  // ─────────────────────────────────────────────

  _getMalId(anilistId) {
    if (this._malIdCache[anilistId]) return this._malIdCache[anilistId];
    try {
      var data  = this._getJson(this.baseUrl + "/meta/anilist/info/" + encodeURIComponent(anilistId));
      var malId = data && data.malId ? String(data.malId) : null;
      if (malId) {
        this._malIdCache[anilistId] = malId;
        console.log("[Miruro] _getMalId anilistId=" + anilistId + " → malId=" + malId);
      }
      return malId;
    } catch (e) {
      console.warn("[Miruro] _getMalId error=" + e.message);
      return null;
    }
  }

  _getAniSkip(malId, epNum) {
    if (!malId || !epNum) return null;
    try {
      var url  = this.aniskipUrl + "/skip-times/" + malId + "/" + epNum + "?types=op&types=ed&episodeLength=0";
      var data = this._getJson(url);
      if (!data || !data.results || !data.results.length) return null;

      var intro = null, outro = null;
      for (var i = 0; i < data.results.length; i++) {
        var item     = data.results[i];
        var interval = item.interval || {};
        var start    = Number(interval.startTime || 0);
        var end      = Number(interval.endTime   || 0);
        if (end <= start) continue;

        var type = String(item.skipType || "").toLowerCase();
        if (type === "op" || type === "mixed-op") {
          intro = { start: start, end: end };
        } else if (type === "ed" || type === "mixed-ed" || type === "recap") {
          outro = { start: start, end: end };
        }
      }

      if (intro) console.log("[Miruro] AniSkip intro=" + JSON.stringify(intro));
      if (outro) console.log("[Miruro] AniSkip outro=" + JSON.stringify(outro));
      return { intro: intro, outro: outro };
    } catch (e) {
      console.warn("[Miruro] _getAniSkip error=" + e.message);
      return null;
    }
  }

  // ─────────────────────────────────────────────
  // findEpisodeServer()
  // ─────────────────────────────────────────────

  findEpisodeServer(episodeObj, serverName) {
    console.log("[Miruro] findEpisodeServer START episodeObj=" + JSON.stringify(episodeObj) + " server=" + serverName);
    var ep = this._parseEpisodeObj(episodeObj);
    console.log("[Miruro] findEpisodeServer parsed anilistId=" + ep.anilistId + " consumetId=" + ep.consumetId + " epNum=" + ep.epNum + " track=" + ep.track);

    if (!ep.consumetId) throw new Error("Missing consumet episode ID");

    var cacheKey = "srv:" + ep.consumetId + ":" + ep.track;
    var cached   = this._cacheGet(this._serverCache, this._serverTimeMap, cacheKey);
    if (cached !== undefined) {
      console.log("[Miruro] findEpisodeServer CACHE HIT");
      return cached;
    }

    var subOrDub = ep.track === "dub" ? "dub" : "sub";
    var url = this.baseUrl + "/meta/anilist/watch/"
      + encodeURIComponent(ep.consumetId)
      + "?provider=zoro&subOrDub=" + subOrDub;

    console.log("[Miruro] findEpisodeServer watch url=" + url);
    var data = this._getJson(url);
    if (!data) throw new Error("No response from Consumet watch endpoint");

    // ── Sources ──────────────────────────────────
    var sources = data.sources || [];
    if (!sources.length) throw new Error("No video sources returned");

    // Prefer m3u8, then best quality within m3u8
    var stream = null;
    for (var i = 0; i < sources.length; i++) {
      var s = sources[i];
      var u = s.url || s.file || "";
      if (!u) continue;
      if (s.isM3U8 === true || u.indexOf(".m3u8") !== -1) {
        if (!stream) { stream = s; continue; }
        // Prefer 1080p > 720p > auto
        var q = String(s.quality || "").toLowerCase();
        var cur = String(stream.quality || "").toLowerCase();
        if (q.indexOf("1080") !== -1 && cur.indexOf("1080") === -1) stream = s;
        else if (q.indexOf("720") !== -1 && cur.indexOf("1080") === -1 && cur.indexOf("720") === -1) stream = s;
      }
    }
    // Fallback: first source regardless of type
    if (!stream) {
      for (var k = 0; k < sources.length; k++) {
        if (sources[k].url || sources[k].file) { stream = sources[k]; break; }
      }
    }
    if (!stream) throw new Error("No playable source found");

    var streamUrl  = stream.url  || stream.file || "";
    var streamType = (stream.isM3U8 === true || streamUrl.indexOf(".m3u8") !== -1) ? "m3u8"
                   : streamUrl.indexOf(".mpd") !== -1 ? "mpd"
                   : "mp4";

    // ── Subtitles ─────────────────────────────────
    // Consumet/zoro returns VTT subtitle tracks — these get passed to ExoPlayer
    var subtitles = [];
    var tracks = data.subtitles || data.tracks || [];
    for (var j = 0; j < tracks.length; j++) {
      var t    = tracks[j];
      var tUrl = t.url || t.file || "";
      if (!tUrl) continue;
      var lang = t.lang || t.label || t.language || "Unknown";
      // Filter out thumbnails track
      if (lang.toLowerCase() === "thumbnails" || t.kind === "thumbnails") continue;
      subtitles.push({
        id:        "sub-" + j,
        language:  lang,
        url:       tUrl,
        isDefault: !!(t.default || lang.toLowerCase() === "english")
      });
    }

    // ── Intro / Outro ────────────────────────────
    var intro = null, outro = null;

    // Consumet sometimes includes these directly in the response
    if (data.intro && data.intro.start !== undefined && data.intro.end !== undefined) {
      var is = Number(data.intro.start), ie = Number(data.intro.end);
      if (ie > is) intro = { start: is, end: ie };
    }
    if (data.outro && data.outro.start !== undefined && data.outro.end !== undefined) {
      var os = Number(data.outro.start), oe = Number(data.outro.end);
      if (oe > os) outro = { start: os, end: oe };
    }

    // Fallback: AniSkip (same source Miruro itself uses)
    if (!intro && !outro && ep.anilistId && ep.epNum) {
      var malId = this._getMalId(ep.anilistId);
      if (malId) {
        var skip = this._getAniSkip(malId, ep.epNum);
        if (skip) { intro = skip.intro; outro = skip.outro; }
      }
    }

    // ── Response ─────────────────────────────────
    var referer = (data.headers && (data.headers.Referer || data.headers.referer)) || "https://hianime.to/";
    var origin  = referer.replace(/\/+$/, "").split("/").slice(0, 3).join("/");

    console.log("[Miruro] findEpisodeServer SUCCESS"
      + " url="   + streamUrl.substring(0, 80)
      + " type="  + streamType
      + " subs="  + subtitles.length
      + " intro=" + !!intro
      + " outro=" + !!outro);

    var resp = {
      server:       serverName || "zoro",
      headers:      { "Referer": referer, "Origin": origin, "User-Agent": this.ua },
      videoSources: [{ url: streamUrl, file: streamUrl, type: streamType, quality: stream.quality || "auto", subtitles: subtitles }],
      sources:      [{ url: streamUrl, file: streamUrl, type: streamType, quality: stream.quality || "auto" }],
      subtitles:    subtitles,
      intro:        intro,
      outro:        outro
    };

    this._cacheSet(this._serverCache, this._serverTimeMap, cacheKey, resp);
    return resp;
  }
}

module.exports = Miruro;
