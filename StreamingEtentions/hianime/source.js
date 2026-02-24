class HiAnime {
  constructor() {
    this.type = "anime-streaming";
    this.version = "2.5.1";
    this.baseUrl = "https://hianime.to";
    this._cache = { dub: {}, search: {}, serverCheck: {} };
  }

  getSettings() {
    return {
      episodeServers: ["HD-1", "HD-2", "HD-3"],
      supportsSub: true,
      supportsDub: true,
      supportsHls: true
    };
  }

  stream(payload) {
    return null;
  }

  _fetch(url, headers = {}) {
    const res = Native.fetch(String(url), "GET", JSON.stringify(headers), "");
    try {
      return JSON.parse(res || "{}");
    } catch {
      return { ok: false, status: 0, body: "" };
    }
  }

  _json(url, headers) {
    const res = this._fetch(url, headers);
    try {
      return JSON.parse(String(res.body || "{}"));
    } catch {
      return {};
    }
  }

  _text(url, headers) {
    return String(this._fetch(url, headers).body || "");
  }

  _headers(json = true) {
    return {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept": json ? "application/json" : "text/html",
      "Referer": this.baseUrl + "/",
      "Origin": this.baseUrl,
      "X-Requested-With": "XMLHttpRequest"
    };
  }

  _clean(str) {
    return String(str || "")
      .replace(/\\u0026/g, "&")
      .replace(/&(?:amp|#38);/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&(?:#39|apos);/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
  }

  _norm(title) {
    return String(title || "")
      .toLowerCase()
      .replace(/\(?\b(19|20)\d{2}\b\)?/g, "")
      .replace(/\b(season|cour|part|uncensored|the animation|the movie|movie)\b/g, "")
      .replace(/\d+(st|nd|rd|th)/g, m => m.replace(/st|nd|rd|th/, ""))
      .replace(/(?<!i)ii(?!i)/g, "2")
      .replace(/[^a-z0-9]+/g, "")
      .trim();
  }

  _normTitle(title) {
    return String(title || "")
      .toLowerCase()
      .replace(/\b(season|cour|part|uncensored)\b/g, "")
      .replace(/\d+(st|nd|rd|th)/g, m => m.replace(/st|nd|rd|th/, ""))
      .replace(/[^a-z0-9]+/g, "");
  }

  _similarity(a, b) {
    const [lenA, lenB] = [a.length, b.length];
    if (!lenA || !lenB) return lenA === lenB ? 1 : 0;

    const dp = Array(lenA + 1).fill(null).map(() => Array(lenB + 1).fill(0));
    for (let i = 0; i <= lenA; i++) dp[i][0] = i;
    for (let j = 0; j <= lenB; j++) dp[0][j] = j;

    for (let i = 1; i <= lenA; i++) {
      for (let j = 1; j <= lenB; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }

    return 1 - dp[lenA][lenB] / Math.max(lenA, lenB);
  }

  _parseDate(str) {
    const m = String(str || "").match(/([A-Za-z]{3})\s+(\d+),\s*(\d{4})/);
    if (!m) return null;
    const months = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
    return { 
      year: parseInt(m[3], 10), 
      month: months[m[1]] || 0,
      day: parseInt(m[2], 10) || 0
    };
  }

  _extractId(input) {
    const s = String(input || "");
    const m = s.match(/(?:\/watch\/[^-]+-|-)(\d+)/);
    return m ? m[1] : (/^\d+$/.test(s) ? s : "");
  }

  _parseArg(arg) {
    if (typeof arg === "string") {
      const s = arg.trim();
      try {
        return s.startsWith("{") || s.startsWith("[") ? JSON.parse(s) : { query: s };
      } catch {
        return { query: s };
      }
    }
    return arg || {};
  }

  _getTrack(obj) {
    if (obj.dub === true) return "dub";
    if (obj.dub === false) return "sub";
    const t = String(obj.subOrDub || obj.track || "").toLowerCase();
    return t === "dub" || t === "sub" ? t : "sub";
  }

  _escapeRegex(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  _searchSuggest(q, page = 1) {
    const url = page === 1
      ? `${this.baseUrl}/ajax/search/suggest?keyword=${encodeURIComponent(q)}`
      : `${this.baseUrl}/ajax/search/suggest?keyword=${encodeURIComponent(q)}&page=${page}`;
    
    const data = this._json(url, this._headers());
    const html = this._clean(String(data.html || data.result || ""));
    
    const re = /<a href="\/([^"]+)" class="nav-item">[\s\S]*?<h3 class="film-name"[^>]*data-jname="([^"]+)"[^>]*>([^<]+)<\/h3>[\s\S]*?<div class="film-infor">\s*<span>([^<]+)<\/span>\s*<i[^>]*><\/i>\s*([^<]+)\s*<i[^>]*><\/i>/g;
    
    const out = [];
    let m;

    while ((m = re.exec(html)) !== null) {
      const path = m[1].trim();
      if (path.startsWith("search?")) continue;

      const jname = m[2]?.trim() || "";
      const title = m[3]?.trim() || "";
      const dateStr = m[4]?.trim() || "";
      const format = m[5]?.trim().toUpperCase() || "";

      const id = this._extractId(path);
      if (!id) continue;

      out.push({
        id,
        pageUrl: path,
        title: this._clean(title),
        jname: this._clean(jname),
        normTitle: this._norm(title),
        normTitleJP: this._norm(jname),
        startDate: this._parseDate(dateStr),
        format,
        url: `${this.baseUrl}/${path}`
      });
    }

    return out;
  }

  _searchFallback(q) {
    const url = `${this.baseUrl}/search?keyword=${encodeURIComponent(q)}`;
    const html = this._text(url, this._headers(false));
    
    const regex = /<a href="\/watch\/([^"]+)"[^>]+title="([^"]+)"[^>]+data-id="(\d+)"/g;
    const out = [];
    let m;

    while ((m = regex.exec(html)) !== null) {
      const pageUrl = m[1];
      const title = m[2];
      const id = m[3];

      const jnameRegex = new RegExp(
        `<h3 class="film-name">[\\s\\S]*?<a[^>]+href="\\/${this._escapeRegex(pageUrl)}[^"]*"[^>]+data-jname="([^"]+)"`,
        "i"
      );
      const jnameMatch = html.match(jnameRegex);
      const jname = jnameMatch ? jnameMatch[1] : "";

      out.push({
        id,
        pageUrl,
        title: this._clean(title),
        jname: this._clean(jname),
        normTitle: this._normTitle(title),
        normTitleJP: this._normTitle(jname),
        url: `${this.baseUrl}/watch/${pageUrl}`
      });
    }

    return out;
  }

  /**
   * Check if a specific episode has dub available
   */
  _checkEpisodeHasDub(animeId, episodeId) {
    const cacheKey = `${animeId}:${episodeId}`;
    if (this._cache.serverCheck[cacheKey] !== undefined) {
      return this._cache.serverCheck[cacheKey];
    }

    try {
      const data = this._json(`${this.baseUrl}/ajax/v2/episode/servers?episodeId=${episodeId}`, this._headers());
      const html = this._clean(String(data.html || data.result || ""));
      const hasDub = /data-type="dub"/i.test(html);
      this._cache.serverCheck[cacheKey] = hasDub;
      return hasDub;
    } catch {
      this._cache.serverCheck[cacheKey] = false;
      return false;
    }
  }

  /**
   * Improved: Check more episodes and return percentage of episodes with dub
   */
  _checkDubAvailability(id) {
    const animeId = this._extractId(id);
    if (!animeId) return { hasDub: false, percentage: 0 };
    
    if (this._cache.dub[animeId] !== undefined) {
      return this._cache.dub[animeId];
    }

    try {
      const data = this._json(`${this.baseUrl}/ajax/v2/episode/list/${animeId}`, this._headers());
      const html = this._clean(String(data.html || data.result || ""));
      
      // Extract all episode IDs
      const episodeIds = [];
      const re = /data-id="([^"]+)"/g;
      let m;
      while ((m = re.exec(html)) !== null) {
        episodeIds.push(m[1]);
      }

      if (!episodeIds.length) {
        const result = { hasDub: false, percentage: 0, total: 0, dubCount: 0 };
        this._cache.dub[animeId] = result;
        return result;
      }

      // Check first 10 episodes or all if less than 10
      const toCheck = episodeIds.slice(0, Math.min(10, episodeIds.length));
      let dubCount = 0;

      for (const epId of toCheck) {
        if (this._checkEpisodeHasDub(animeId, epId)) {
          dubCount++;
        }
      }

      const percentage = (dubCount / toCheck.length) * 100;
      const result = {
        hasDub: dubCount > 0,
        percentage,
        total: toCheck.length,
        dubCount
      };

      this._cache.dub[animeId] = result;
      return result;

    } catch {
      const result = { hasDub: false, percentage: 0, total: 0, dubCount: 0 };
      this._cache.dub[animeId] = result;
      return result;
    }
  }

  /**
   * Legacy method for backwards compatibility
   */
  _checkDub(id) {
    const result = this._checkDubAvailability(id);
    // Consider it has dub if at least 50% of checked episodes have dub
    return result.hasDub && result.percentage >= 50;
  }

  search(arg) {
    arg = this._parseArg(arg);
    const q = String(arg.query || arg.q || "").trim();
    if (!q) return JSON.stringify([]);

    const track = this._getTrack(arg);
    const media = arg.media || {};
    const start = media.startDate || {};
    const targetYear = parseInt(start.year, 10) || 0;
    const targetMonth = parseInt(start.month, 10) || 0;

    const en = String(media.englishTitle || media.english || "").trim();
    const ro = String(media.romajiTitle || media.romaji || "").trim();
    const format = String(media.format || "").trim().toUpperCase();
    
    const normEn = this._norm(en);
    const normRo = this._norm(ro);
    const targetNormJP = normRo || normEn;
    const targetNorm = normEn || normRo || this._norm(q);

    const cacheKey = `${q}|${track}|${targetYear}|${targetMonth}|${format}`;
    if (this._cache.search[cacheKey]) return JSON.stringify(this._cache.search[cacheKey]);

    let filtered = [];

    // Use fallback search if no date info
    if (!targetYear) {
      let items = this._searchFallback(q);
      if (!items.length) return JSON.stringify([]);

      const normQuery = this._normTitle(q);
      items = items.filter(x => {
        return x.normTitle === normQuery ||
               x.normTitleJP === normQuery ||
               x.normTitle.includes(normQuery) ||
               x.normTitleJP.includes(normQuery) ||
               normQuery.includes(x.normTitle) ||
               normQuery.includes(x.normTitleJP);
      });

      items.sort((a, b) => {
        const diff = a.normTitle.length - b.normTitle.length;
        return diff !== 0 ? diff : a.normTitle.localeCompare(b.normTitle);
      });

      filtered = items;

      // IMPORTANT: Check dub for fallback search too!
      if (track === "dub") {
        filtered = filtered.slice(0, 12).filter(x => {
          const dubInfo = this._checkDubAvailability(x.id);
          // Require at least 70% of episodes to have dub
          return dubInfo.hasDub && dubInfo.percentage >= 70;
        });
        if (!filtered.length) return JSON.stringify([]);
      }

      const results = filtered.map(x => ({
        id: `${x.id}/${track}`,
        title: x.title,
        url: x.url,
        subOrDub: track
      }));

      this._cache.search[cacheKey] = results;
      return JSON.stringify(results);
    }

    // Multi-page search with date matching
    const exactTitle = x => x.normTitle === targetNorm || x.normTitleJP === targetNormJP;
    const looseTitle = x => 
      this._similarity(x.normTitle, targetNorm) > 0.8 ||
      this._similarity(x.normTitleJP, targetNormJP) > 0.8;
    const looserTitle = x =>
      x.normTitle.includes(targetNorm) ||
      x.normTitleJP.includes(targetNormJP) ||
      targetNorm.includes(x.normTitle) ||
      targetNormJP.includes(x.normTitleJP) ||
      this._similarity(x.normTitle, targetNorm) > 0.6 ||
      this._similarity(x.normTitleJP, targetNormJP) > 0.6;

    const dateYM = x =>
      x.startDate && x.startDate.year === targetYear && x.startDate.month === targetMonth;
    const dateY = x =>
      x.startDate && x.startDate.year === targetYear;
    const exactFormat = x => format && x.format === format;

    const matchTiers = [
      x => exactTitle(x) && dateYM(x) && exactFormat(x),
      x => exactTitle(x) && dateY(x) && exactFormat(x),
      x => looseTitle(x) && dateYM(x) && exactFormat(x),
      x => looseTitle(x) && dateY(x) && exactFormat(x),
      x => exactTitle(x) && dateYM(x),
      x => exactTitle(x) && dateY(x),
      x => looseTitle(x) && dateYM(x),
      x => looseTitle(x) && dateY(x)
    ];

    for (let page = 1; page <= 7; page++) {
      const pageMatches = this._searchSuggest(q, page);
      if (!pageMatches.length) break;

      const hasLoose = pageMatches.some(looserTitle);
      if (!hasLoose) break;

      for (const tier of matchTiers) {
        filtered = pageMatches.filter(tier);
        if (filtered.length) break;
      }

      if (filtered.length) break;
    }

    if (!filtered.length) return JSON.stringify([]);

    filtered.sort((a, b) => {
      const diff = a.normTitle.length - b.normTitle.length;
      return diff !== 0 ? diff : a.normTitle.localeCompare(b.normTitle);
    });

    if (track === "dub") {
      filtered = filtered.slice(0, 12).filter(x => {
        const dubInfo = this._checkDubAvailability(x.id);
        // Require at least 70% of checked episodes to have dub
        return dubInfo.hasDub && dubInfo.percentage >= 70;
      });
      if (!filtered.length) return JSON.stringify([]);
    }

    const results = filtered.map(x => ({
      id: `${x.id}/${track}`,
      title: x.title,
      url: x.url,
      subOrDub: track,
      startDate: x.startDate
    }));

    this._cache.search[cacheKey] = results;
    return JSON.stringify(results);
  }

  findEpisodes(animeId) {
    const [id, track] = String(animeId || "").split("/");
    const numId = this._extractId(id);
    if (!numId) return JSON.stringify([]);

    const actualTrack = track && (track === "dub" || track === "sub") ? track : "sub";

    const data = this._json(`${this.baseUrl}/ajax/v2/episode/list/${numId}`, this._headers());
    const html = this._clean(String(data.html || data.result || ""));
    
    const re = /<a[^>]*class="[^"]*\bep-item\b[^"]*"[^>]*data-number="([^"]+)"[^>]*data-id="([^"]+)"[^>]*href="([^"]+)"[\s\S]*?<div class="ep-name[^"]*"[^>]*title="([^"]+)"/g;
    const episodes = [];
    let m;

    while ((m = re.exec(html)) !== null) {
      const num = parseFloat(m[1]);
      const epId = m[2].trim();
      const epTitle = this._clean(m[4]) || "";
      
      if (epId && isFinite(num)) {
        episodes.push({
          id: `${epId}/${actualTrack}`,
          number: num,
          title: epTitle,
          url: `${this.baseUrl}${m[3]}`
        });
      }
    }

    episodes.sort((a, b) => a.number - b.number);
    return JSON.stringify(episodes);
  }

  findEpisodeServer(episodeObj, serverName) {
    let ep = typeof episodeObj === "string" ? JSON.parse(episodeObj) : episodeObj;
    const epIdRaw = String(ep.id || "").trim();
    if (!epIdRaw) throw new Error("Missing episode id");

    const [epId, trackFromId] = epIdRaw.split("/");
    
    let track = trackFromId && (trackFromId === "dub" || trackFromId === "sub") 
      ? trackFromId 
      : this._getTrack(ep);
    
    if (track !== "dub" && track !== "sub") track = "sub";

    const allowedTypes = track === "dub" ? ["dub"] : ["sub", "raw"];
    const typePattern = allowedTypes.join("|");
    const requestedServer = (serverName || "HD-1").trim();
    const escapedServer = this._escapeRegex(requestedServer);

    const data = this._json(`${this.baseUrl}/ajax/v2/episode/servers?episodeId=${epId}`, this._headers());
    const html = this._clean(String(data.html || data.result || ""));
    
    const trackAvailable = new RegExp(`data-type="${track}"`, "i").test(html);
    
    if (!trackAvailable) {
      if (track === "dub") {
        throw new Error(`Dub not available for this episode. Try switching to sub.`);
      }
      throw new Error(`No ${track} servers found for this episode`);
    }
    
    const regex = new RegExp(
      `<div[^>]*class="item server-item"[^>]*data-type="(${typePattern})"[^>]*data-id="(\\d+)"[^>]*>\\s*<a[^>]*>\\s*${escapedServer}\\s*</a>`,
      "i"
    );

    const match = regex.exec(html);
    
    if (!match) {
      const fallbackRegex = new RegExp(
        `<div[^>]*class="item server-item"[^>]*data-type="(${typePattern})"[^>]*data-id="(\\d+)"`,
        "i"
      );
      const fallbackMatch = fallbackRegex.exec(html);
      
      if (!fallbackMatch) {
        throw new Error(`No ${track} servers found for this episode`);
      }
      
      const serverId = fallbackMatch[2];
      const sources = this._json(`${this.baseUrl}/ajax/v2/episode/sources?id=${serverId}`, this._headers());
      const embed = String(sources.link || "");
      if (!embed) throw new Error("No embed link");

      return this._buildStreamResponse(embed, requestedServer);
    }

    const serverId = match[2];
    const sources = this._json(`${this.baseUrl}/ajax/v2/episode/sources?id=${serverId}`, this._headers());
    const embed = String(sources.link || "");
    if (!embed) throw new Error("No embed link");

    return this._buildStreamResponse(embed, requestedServer);
  }

  _buildStreamResponse(embed, serverName) {
    let decrypt = null;
    let headers = {};

    try {
      decrypt = this._extractMega(embed);
      headers = decrypt.headers || {};
    } catch {
      const fb = this._json(`https://ac-api.ofchaos.com/api/anime/embed/convert/v2?embedUrl=${encodeURIComponent(embed)}`, {});
      decrypt = fb;
      const u = new URL(embed);
      headers = {
        "Referer": `${u.protocol}//${u.host}/`,
        "Origin": `${u.protocol}//${u.host}`,
        "User-Agent": "Mozilla/5.0"
      };
    }

    const srcs = Array.isArray(decrypt.sources) ? decrypt.sources : [];
    const stream = srcs.find(s => s && s.type === "hls") || srcs.find(s => s && s.file);
    if (!stream || !stream.file) throw new Error("No stream found");

    const subs = (Array.isArray(decrypt.tracks) ? decrypt.tracks : [])
      .filter(t => t && String(t.kind || "").toLowerCase() === "captions" && t.file)
      .map((t, i) => ({
        id: `sub-${i}`,
        language: t.label || "Unknown",
        url: t.file,
        isDefault: !!t.default
      }));

    return JSON.stringify({
      server: serverName,
      headers,
      intro: decrypt.intro || null,
      outro: decrypt.outro || null,
      videoSources: [{
        url: stream.file,
        type: String(stream.type || "").toLowerCase() === "hls" ? "m3u8" : "mp4",
        quality: "auto",
        subtitles: subs,
        intro: decrypt.intro || null,
        outro: decrypt.outro || null
      }]
    });
  }

  _extractMega(url) {
    const u = new URL(url);
    const base = `${u.protocol}//${u.host}/`;
    const headers = {
      "Accept": "*/*",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": base,
      "Origin": `${u.protocol}//${u.host}`,
      "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36"
    };

    const html = this._text(url, headers);
    const idM = html.match(/<title>\s*File\s+#([a-zA-Z0-9]+)/i);
    if (!idM) throw new Error("File ID not found");
    const fileId = idM[1];

    let nonce = (html.match(/\b[a-zA-Z0-9]{48}\b/) || [])[0];
    if (!nonce) {
      const parts = [...html.matchAll(/["']([A-Za-z0-9]{16})["']/g)];
      if (parts.length >= 3) nonce = parts[0][1] + parts[1][1] + parts[2][1];
    }
    if (!nonce) throw new Error("Nonce not found");

    const data = this._json(`${base}embed-2/v3/e-1/getSources?id=${fileId}&_k=${nonce}`, headers);
    return {
      sources: data.sources || [],
      tracks: data.tracks || [],
      intro: data.intro || null,
      outro: data.outro || null,
      headers
    };
  }
}

module.exports = HiAnime;
