// Miruro.tv extension for WaifuTV — pure JS, no Java/JVM needed (QuickJS runtime)
// API: GET /api/secure/pipe?e=BASE64URL({"path":"...","method":"GET","query":{...},"body":null})
// Response: text/plain body = base64url(gzip(json))   x-obfuscated: 1

// ─── Pure JS gzip/inflate ────────────────────────────────────────────────────
// Handles all three DEFLATE block types (stored, fixed Huffman, dynamic Huffman)

var _MiruroCodec = (function () {

  // Length code extras and base values (index = litCode - 257)
  var LEXT  = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
  var LBASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
  // Distance code extras and base values
  var DEXT  = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];
  var DBASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
  // Code-length alphabet order
  var CLORD = [16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];

  function arr(n, v) { var a = []; for (var i = 0; i < n; i++) a.push(v); return a; }

  // Build canonical Huffman lookup: tbl[bitLen][codeValue] = symbol
  function buildTree(lens) {
    var maxLen = 0;
    for (var i = 0; i < lens.length; i++) if (lens[i] > maxLen) maxLen = lens[i];
    var cnt = arr(maxLen + 1, 0);
    for (var i = 0; i < lens.length; i++) if (lens[i]) cnt[lens[i]]++;
    var nc = arr(maxLen + 2, 0), code = 0;
    cnt[0] = 0;
    for (var b = 1; b <= maxLen; b++) { code = (code + cnt[b - 1]) << 1; nc[b] = code; }
    var tbl = [];
    for (var i = 0; i <= maxLen; i++) tbl.push({});
    for (var n = 0; n < lens.length; n++) {
      if (lens[n]) { tbl[lens[n]][nc[lens[n]]] = n; nc[lens[n]]++; }
    }
    return { tbl: tbl, maxLen: maxLen };
  }

  // Read n bits LSB-first (for lengths, counts, literal values)
  function rLSB(data, pos, n) {
    var v = 0;
    for (var i = 0; i < n; i++) {
      v |= ((data[pos >> 3] >> (pos & 7)) & 1) << i;
      pos++;
    }
    return { v: v, pos: pos };
  }

  // Decode one Huffman symbol — reads bits MSB-first into growing code
  function rSym(tree, data, pos) {
    var code = 0;
    for (var len = 1; len <= tree.maxLen; len++) {
      code = (code << 1) | ((data[pos >> 3] >> (pos & 7)) & 1);
      pos++;
      if (tree.tbl[len][code] !== undefined) return { sym: tree.tbl[len][code], pos: pos };
    }
    throw new Error("bad huffman code");
  }

  function fixedTrees() {
    var ll = [];
    for (var i = 0; i <= 143; i++) ll.push(8);
    for (var i = 144; i <= 255; i++) ll.push(9);
    for (var i = 256; i <= 279; i++) ll.push(7);
    for (var i = 280; i <= 287; i++) ll.push(8);
    var dd = []; for (var i = 0; i < 32; i++) dd.push(5);
    return { lit: buildTree(ll), dst: buildTree(dd) };
  }

  function inflate(data) {
    var out = [], pos = 0;
    for (;;) {
      var r = rLSB(data, pos, 1); var bfinal = r.v; pos = r.pos;
      r = rLSB(data, pos, 2); var btype = r.v; pos = r.pos;

      if (btype === 0) {
        pos = (pos + 7) & ~7;
        r = rLSB(data, pos, 16); var len = r.v; pos = r.pos;
        pos += 16; // skip NLEN
        for (var i = 0; i < len; i++) { r = rLSB(data, pos, 8); out.push(r.v); pos = r.pos; }

      } else {
        var lit, dst;
        if (btype === 1) {
          var ft = fixedTrees(); lit = ft.lit; dst = ft.dst;
        } else {
          r = rLSB(data, pos, 5); var hlit  = r.v + 257; pos = r.pos;
          r = rLSB(data, pos, 5); var hdist = r.v + 1;   pos = r.pos;
          r = rLSB(data, pos, 4); var hclen = r.v + 4;   pos = r.pos;

          var cll = arr(19, 0);
          for (var i = 0; i < hclen; i++) { r = rLSB(data, pos, 3); cll[CLORD[i]] = r.v; pos = r.pos; }
          var clTree = buildTree(cll);

          var allLens = [], rs;
          while (allLens.length < hlit + hdist) {
            rs = rSym(clTree, data, pos); pos = rs.pos;
            var sym = rs.sym;
            if (sym < 16) { allLens.push(sym); }
            else if (sym === 16) {
              r = rLSB(data, pos, 2); pos = r.pos;
              var last = allLens[allLens.length - 1];
              for (var i = 0; i < r.v + 3; i++) allLens.push(last);
            } else if (sym === 17) {
              r = rLSB(data, pos, 3); pos = r.pos;
              for (var i = 0; i < r.v + 3; i++)  allLens.push(0);
            } else {
              r = rLSB(data, pos, 7); pos = r.pos;
              for (var i = 0; i < r.v + 11; i++) allLens.push(0);
            }
          }
          lit = buildTree(allLens.slice(0, hlit));
          dst = buildTree(allLens.slice(hlit));
        }

        for (;;) {
          var rs2 = rSym(lit, data, pos); pos = rs2.pos;
          var sym2 = rs2.sym;
          if (sym2 === 256) break;
          if (sym2 < 256) { out.push(sym2); }
          else {
            var li = sym2 - 257;
            r = rLSB(data, pos, LEXT[li]); var length = r.v + LBASE[li]; pos = r.pos;
            var rd = rSym(dst, data, pos); pos = rd.pos;
            r = rLSB(data, pos, DEXT[rd.sym]); var dist = r.v + DBASE[rd.sym]; pos = r.pos;
            var cp = out.length - dist;
            for (var i = 0; i < length; i++) out.push(out[cp + i]);
          }
        }
      }
      if (bfinal) break;
    }
    return out;
  }

  // Parse gzip header, inflate, return byte array
  function gunzip(bytes) {
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error("not gzip");
    var flg = bytes[3], p = 10;
    if (flg & 4)  { p += 2 + (bytes[p] | (bytes[p+1] << 8)); }
    if (flg & 8)  { while (bytes[p++] !== 0); }
    if (flg & 16) { while (bytes[p++] !== 0); }
    if (flg & 2)  { p += 2; }
    return inflate(bytes.slice(p, bytes.length - 8));
  }

  // Decode base64url string → byte array
  var B64CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var B64MAP = (function () {
    var m = {};
    for (var i = 0; i < B64CHARS.length; i++) m[B64CHARS[i]] = i;
    return m;
  })();

  function b64UrlDecode(s) {
    s = s.replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
    while (s.length % 4) s += "=";
    var out = [];
    for (var i = 0; i < s.length; i += 4) {
      var a = B64MAP[s[i]], b = B64MAP[s[i+1]], c = B64MAP[s[i+2]], d = B64MAP[s[i+3]];
      out.push((a << 2) | (b >> 4));
      if (s[i+2] !== "=") out.push(((b & 0xf) << 4) | (c >> 2));
      if (s[i+3] !== "=") out.push(((c & 0x3) << 6) | d);
    }
    return out;
  }

  // Encode string → base64url (no padding) — UTF-8 aware
  function b64UrlEncode(str) {
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
      var c = str.charCodeAt(i);
      if      (c < 0x80)   { bytes.push(c); }
      else if (c < 0x800)  { bytes.push(0xc0|(c>>6));  bytes.push(0x80|(c&0x3f)); }
      else                 { bytes.push(0xe0|(c>>12));  bytes.push(0x80|((c>>6)&0x3f)); bytes.push(0x80|(c&0x3f)); }
    }
    var out = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var a = bytes[i], b = bytes[i+1]||0, c = bytes[i+2]||0;
      out += B64CHARS[a>>2] + B64CHARS[((a&3)<<4)|(b>>4)];
      out += i+1 < bytes.length ? B64CHARS[((b&0xf)<<2)|(c>>6)] : "=";
      out += i+2 < bytes.length ? B64CHARS[c&0x3f] : "=";
    }
    return out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  // Byte array → UTF-8 string
  function bytesToStr(bytes) {
    var out = "", i = 0;
    while (i < bytes.length) {
      var b = bytes[i] & 0xff;
      if      (b < 0x80) { out += String.fromCharCode(b); i++; }
      else if (b < 0xe0) { out += String.fromCharCode(((b&0x1f)<<6)|(bytes[i+1]&0x3f)); i+=2; }
      else if (b < 0xf0) { out += String.fromCharCode(((b&0xf)<<12)|((bytes[i+1]&0x3f)<<6)|(bytes[i+2]&0x3f)); i+=3; }
      else {
        var cp = ((b&7)<<18)|((bytes[i+1]&0x3f)<<12)|((bytes[i+2]&0x3f)<<6)|(bytes[i+3]&0x3f);
        cp -= 0x10000;
        out += String.fromCharCode(0xd800|(cp>>10), 0xdc00|(cp&0x3ff));
        i+=4;
      }
    }
    return out;
  }

  // Decode Miruro's obfuscated response: base64url(gzip(json)) → parsed object
  function decodeBody(body) {
    if (!body || body.length < 8) return null;
    var bytes   = b64UrlDecode(body);
    var rawJson = bytesToStr(gunzip(bytes));
    return JSON.parse(rawJson);
  }

  return { b64UrlEncode: b64UrlEncode, decodeBody: decodeBody };
})();

// ─── Extension class ─────────────────────────────────────────────────────────

class Miruro {
  constructor() {
    this.type       = "anime-streaming";
    this.version    = "1.2.0";
    this.baseUrl    = "https://www.miruro.tv";
    this.aniskipUrl = "https://api.aniskip.com/v2";
    this.ua         = "Mozilla/5.0 (Linux; Android 10; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

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
  _cacheSet(store, timeMap, key, val) { store[key] = val; timeMap[key] = Date.now(); }

  // ─── Pipe API ─────────────────────────────────────────────────────────────

  _encodePayload(path, query) {
    var payload = JSON.stringify({ path: path, method: "GET", query: query || {}, body: null, version: "0.2.0" });
    return _MiruroCodec.b64UrlEncode(payload);
  }

  _pipe(path, query) {
    var e   = this._encodePayload(path, query);
    var url = this.baseUrl + "/api/secure/pipe?e=" + e;
    console.log("[Miruro] pipe path=" + path);
    var res = this._fetch(url);
    if (!res || !res.body) { console.warn("[Miruro] pipe empty path=" + path); return null; }
    try {
      var data = _MiruroCodec.decodeBody(res.body);
      if (!data) console.warn("[Miruro] pipe decode null path=" + path);
      return data;
    } catch (e) {
      console.error("[Miruro] pipe decode error path=" + path + " err=" + e.message);
      return null;
    }
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
      console.log("[Miruro] fetch status=" + status + " bodyLen=" + String(j.body || "").length);
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
    if (obj && obj.dub === true)  return "dub";
    if (obj && obj.dub === false) return "sub";
    var t = String((obj && (obj.subOrDub || obj.track)) || "").toLowerCase();
    return t === "dub" ? "dub" : "sub";
  }

  _parseMediaId(mediaId) {
    var raw   = String(mediaId || "").trim();
    var track = raw.toLowerCase().endsWith("/dub") ? "dub" : "sub";
    return { anilistId: raw.replace(/\/(sub|dub)$/i, ""), track: track };
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
      anilistId: parts[0] || "", b64EpId: parts[1] || "",
      epNum: parseInt(parts[2] || "0", 10) || (ep && ep.number) || 0,
      provider: parts[3] || "", track: track
    };
  }

  _normalize(s) {
    return String(s || "").toLowerCase()
      .replace(/(season|part|the animation|the movie|movie|uncensored|cour)/g, "")
      .replace(/\biii\b/g,"3").replace(/\bii\b/g,"2").replace(/\biv\b/g,"4")
      .replace(/[^a-z0-9]+/g, "");
  }
  _score(candidate, targets) {
    var c = this._normalize(candidate), best = 0;
    if (!c) return 0;
    for (var i = 0; i < targets.length; i++) {
      var t = this._normalize(targets[i]);
      if (!t) continue;
      if (c === t) { best = Math.max(best, 1000); continue; }
      if (c.indexOf(t) !== -1 || t.indexOf(c) !== -1) best = Math.max(best, 850);
    }
    return best;
  }

  // ─── search() ─────────────────────────────────────────────────────────────

  search(arg) {
    arg = this._parseArg(arg);
    var q     = String(arg.query || arg.title || arg.name || "").trim();
    var track = this._getTrack(arg);
    var media = arg.media || {};

    // Fast path: AniList ID already known — zero network calls
    var directId = String(arg.anilistId || media.anilistId || media.id || "").trim();
    if (directId && /^\d+$/.test(directId)) {
      var title = media.englishTitle || media.romajiTitle || q || ("Anime " + directId);
      console.log("[Miruro] search fast-path anilistId=" + directId + " track=" + track);
      return [{
        id: directId + "/" + track, title: title,
        jname: media.romajiTitle || "", url: this.baseUrl + "/watch/" + directId, subOrDub: track
      }];
    }

    if (!q) return [];
    var targets = [q];
    if (media.englishTitle) targets.push(media.englishTitle);
    if (media.romajiTitle)  targets.push(media.romajiTitle);
    if (media.nativeTitle)  targets.push(media.nativeTitle);
    if (media.altTitles) for (var i = 0; i < media.altTitles.length; i++) targets.push(media.altTitles[i]);

    var data = this._pipe("search", { q: q, limit: 15, offset: 0, type: "ANIME", sort: "POPULARITY_DESC" });
    if (!data || !Array.isArray(data) || !data.length) { console.warn("[Miruro] search empty q=" + q); return []; }

    var out = [];
    for (var r = 0; r < data.length; r++) {
      var item = data[r];
      if (!item || !item.id) continue;
      var en = (item.title && item.title.english) || "";
      var ro = (item.title && item.title.romaji)  || "";
      var pri = en || ro || ("Anime " + item.id);
      out.push({
        id: String(item.id) + "/" + track, title: pri, jname: ro !== pri ? ro : "",
        url: this.baseUrl + "/watch/" + item.id, subOrDub: track,
        _score: Math.max(this._score(en, targets), this._score(ro, targets))
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
    if (cached !== undefined) { console.log("[Miruro] findEpisodes CACHE HIT count=" + cached.length); return cached; }

    var data = this._pipe("episodes", { anilistId: anilistId });
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      console.error("[Miruro] findEpisodes bad response anilistId=" + anilistId); return [];
    }

    if (data._malId && !this._malIdCache[anilistId]) this._malIdCache[anilistId] = String(data._malId);

    var order = track === "dub" ? this._dubProviders : this._subProviders;
    var chosenProvider = null, chosenEps = [];

    for (var pi = 0; pi < order.length; pi++) {
      var pdata = data[order[pi]];
      if (!pdata || !pdata.episodes) continue;
      var eps = pdata.episodes[track === "dub" ? "dub" : "sub"] || [];
      if (eps.length > 0) { chosenProvider = order[pi]; chosenEps = eps; break; }
    }

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
      var ep = chosenEps[i];
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

  // ─── AniSkip fallback ─────────────────────────────────────────────────────

  _getMalId(anilistId) {
    if (this._malIdCache[anilistId]) return this._malIdCache[anilistId];
    var info = this._pipe("info/" + anilistId, {});
    if (info && info.malId) { this._malIdCache[anilistId] = String(info.malId); return this._malIdCache[anilistId]; }
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
        var item = data.results[i];
        var iv   = item.interval || {};
        var s    = Number(iv.startTime || 0), en = Number(iv.endTime || 0);
        if (en <= s) continue;
        var type = String(item.skipType || "").toLowerCase();
        if (type === "op" || type === "mixed-op")      intro = { start: s, end: en };
        else if (type === "ed" || type === "mixed-ed") outro = { start: s, end: en };
      }
      if (intro) console.log("[Miruro] AniSkip intro=" + JSON.stringify(intro));
      if (outro) console.log("[Miruro] AniSkip outro=" + JSON.stringify(outro));
      return { intro: intro, outro: outro };
    } catch (e) { console.warn("[Miruro] AniSkip error: " + e.message); return null; }
  }

  // ─── findEpisodeServer() ──────────────────────────────────────────────────

  findEpisodeServer(episodeObj, serverName) {
    console.log("[Miruro] findEpisodeServer START obj=" + JSON.stringify(episodeObj));
    var ep = this._parseEpisodeObj(episodeObj);
    console.log("[Miruro] findEpisodeServer anilistId=" + ep.anilistId + " provider=" + ep.provider + " epNum=" + ep.epNum + " track=" + ep.track);

    if (!ep.b64EpId)  throw new Error("Missing episode ID");
    if (!ep.provider) throw new Error("Missing provider");

    var cacheKey = ep.b64EpId + ":" + ep.provider + ":" + ep.track;
    var cached   = this._cacheGet(this._serverCache, this._serverCacheTime, cacheKey);
    if (cached !== undefined) { console.log("[Miruro] findEpisodeServer CACHE HIT"); return cached; }

    var query = { episodeId: ep.b64EpId, provider: ep.provider, category: ep.track === "dub" ? "dub" : "sub" };
    if (ep.anilistId) query.anilistId = parseInt(ep.anilistId, 10) || ep.anilistId;

    var data = this._pipe("sources", query);
    if (!data) throw new Error("No response from sources");

    var streams = data.streams || [];
    if (!streams.length) throw new Error("No streams");

    var best = null;
    for (var i = 0; i < streams.length; i++) {
      var s = streams[i];
      if (s.type !== "hls" || !s.url) continue;
      if (!best) { best = s; continue; }
      var sAct = s.isActive !== false, bAct = best.isActive !== false;
      var sq = parseInt(s.quality || "0", 10) || 0, bq = parseInt(best.quality || "0", 10) || 0;
      if (sAct && !bAct) { best = s; continue; }
      if (sq > bq && (sAct || !bAct)) best = s;
    }
    if (!best) for (var j = 0; j < streams.length; j++) { if (streams[j].url && streams[j].type !== "embed") { best = streams[j]; break; } }
    if (!best || !best.url) throw new Error("No playable stream");

    var streamUrl = best.url;
    var referer   = best.referer || "https://miruro.tv/";
    var origin    = referer.replace(/\/+$/, "").split("/").slice(0, 3).join("/");

    var subtitles = [];
    var tracks = data.subtitles || data.tracks || [];
    for (var k = 0; k < tracks.length; k++) {
      var t = tracks[k]; var tUrl = t.url || t.file || "";
      if (!tUrl) continue;
      var lang = t.lang || t.label || t.language || "Unknown";
      if (lang.toLowerCase() === "thumbnails" || t.kind === "thumbnails") continue;
      subtitles.push({ id: "sub-" + k, language: lang, url: tUrl,
        isDefault: !!(t.default || lang.toLowerCase() === "english") });
    }

    var intro = null, outro = null;
    if (data.intro && data.intro.start !== undefined && data.intro.end !== undefined) {
      var is = Number(data.intro.start), ie = Number(data.intro.end);
      if (ie > is) intro = { start: is, end: ie };
    }
    if (data.outro && data.outro.start !== undefined && data.outro.end !== undefined) {
      var os = Number(data.outro.start), oe = Number(data.outro.end);
      if (oe > os) outro = { start: os, end: oe };
    }
    if (!intro && !outro && ep.anilistId && ep.epNum) {
      var malId = this._getMalId(ep.anilistId);
      if (malId) { var skip = this._getAniSkip(malId, ep.epNum); if (skip) { intro = skip.intro; outro = skip.outro; } }
    }

    console.log("[Miruro] SUCCESS url=" + streamUrl.substring(0,80) + " subs=" + subtitles.length + " intro=" + !!intro + " outro=" + !!outro);

    var resp = {
      // Server label MUST contain "dub" for dub tracks or WaifuTV's serverMatchesRequestedTrack()
      // will reject it. Provider names like "arc"/"zoro"/"kiwi" don't trigger the dub check,
      // so we append "-dub" when the track is dub. Sub track is fine as-is (no "dub" in name).
      server:       ep.track === "dub" ? ep.provider + "-dub" : ep.provider,
      headers:      { "Referer": referer, "Origin": origin, "User-Agent": this.ua },
      videoSources: [{ url: streamUrl, file: streamUrl, type: "m3u8", quality: best.quality || "auto", subtitles: subtitles }],
      sources:      [{ url: streamUrl, file: streamUrl, type: "m3u8", quality: best.quality || "auto" }],
      subtitles:    subtitles, intro: intro, outro: outro
    };

    this._cacheSet(this._serverCache, this._serverCacheTime, cacheKey, resp);
    return resp;
  }
}

module.exports = Miruro;
