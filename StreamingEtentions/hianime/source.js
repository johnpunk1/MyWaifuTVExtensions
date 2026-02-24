class HiAnime {
  constructor() {
    this.baseUrl = "https://hianime.to";
    this._cache = {};
    this._cacheMaxAge = 1000 * 60 * 5;
  }

  getSettings() {
    return {
      episodeServers: ["HD-1", "HD-2", "HD-3"],
      supportsDub: true
    };
  }

  getMetaData() {
    return {
      id: "hianime",
      name: "HiAnime",
      version: "3.1.2",
      author: "Fixed",
      description: "Streams from HiAnime.to with fallback API",
      url: this.baseUrl,
      supportsDub: true,
      supportsSub: true,
      settings: this.getSettings()
    };
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _nativeFetch(url, options, retries = 2) {
    return fetch(url, options).catch(async (err) => {
      if (retries > 0) {
        console.log(`Fetch failed for ${url}, retrying... (${retries} left)`);
        await this._sleep(500);
        return this._nativeFetch(url, options, retries - 1);
      }
      throw err;
    });
  }

  _getCached(key) {
    const item = this._cache[key];
    if (!item) return null;
    if (Date.now() - item.timestamp > this._cacheMaxAge) {
      delete this._cache[key];
      return null;
    }
    return item.data;
  }

  _setCache(key, data) {
    this._cache[key] = { data, timestamp: Date.now() };
  }

  async search(query) {
    const normalize = (title) => {
      return (title || "")
        .toLowerCase()
        .replace(/(season|cour|part|the animation|the movie|movie|uncensored)/g, "")
        .replace(/\d+(st|nd|rd|th)/g, (m) => m.replace(/st|nd|rd|th/, ""))
        .replace(/[^a-z0-9]+/g, "")
        .replace(/(?<!i)ii(?!i)/g, "2");
    };

    const decodeHtmlEntities = (str) => {
      return (str || "")
        .replace(/\\u0026/g, "&")
        .replace(/&#(\d+);?/g, (m, dec) => String.fromCharCode(parseInt(dec, 10)))
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
    };

    const levenshteinSimilarity = (a, b) => {
      a = a || "";
      b = b || "";
      const lenA = a.length;
      const lenB = b.length;
      if (!lenA && !lenB) return 1;
      if (!lenA || !lenB) return 0;

      const dp = Array.from({ length: lenA + 1 }, () => new Array(lenB + 1).fill(0));
      for (let i = 0; i <= lenA; i++) dp[i][0] = i;
      for (let j = 0; j <= lenB; j++) dp[0][j] = j;

      for (let i = 1; i <= lenA; i++) {
        for (let j = 1; j <= lenB; j++) {
          if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
          else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
      }

      const distance = dp[lenA][lenB];
      const maxLen = Math.max(lenA, lenB);
      return 1 - distance / maxLen;
    };

    const start = query && query.media ? query.media.startDate : null;
    const startYear = start && start.year ? start.year : 0;
    const startMonth = start && start.month ? start.month : 0;

    const targetNormJP = normalize(query?.media?.romajiTitle);
    const targetNormEN = normalize(query?.media?.englishTitle);
    const targetNormQ = normalize(query?.query);

    const targetNorm = targetNormEN || targetNormJP || targetNormQ;
    const targetNormAlt = targetNormJP || targetNormEN || targetNormQ;

    const monthMap = {
      Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
      Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
    };

    const parseStartDate = (dateStr) => {
      const s = (dateStr || "").trim();
      const m = s.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
      if (!m) return { year: 0, month: 0, day: 0 };
      const month = monthMap[m[1]] || 0;
      return { year: parseInt(m[3], 10) || 0, month, day: parseInt(m[2], 10) || 0 };
    };

    const ensureWatchPath = (href) => {
      const h = (href || "").replace(/^\/+/, "");
      if (!h) return "";
      // h can be "watch/slug-12345?ep=..." OR "slug-12345" (old suggest)
      if (h.startsWith("watch/")) return h.split("?")[0];
      if (h.startsWith("search?")) return "";
      // If it's already a full slug path, keep it; watch pages on HiAnime are /watch/<slug>
      return h.includes("/") ? h.split("?")[0] : `watch/${h.split("?")[0]}`;
    };

    const extractIdFromHref = (href) => {
      const h = href || "";
      const m = h.match(/-(\d+)(?:\b|$)/);
      return m ? m[1] : "";
    };

    const fetchMatches = async (url) => {
      const reply = await this._nativeFetch(url).then(r => r.json());
      const html = reply && reply.html ? reply.html : "";

      // Works for suggest HTML blocks; tries to capture title + data-jname + date + format.
      const regex = /<a href="\/([^"]+)" class="nav-item">[\s\S]*?<h3 class="film-name"[^>]*data-jname="([^"]+)"[^>]*>([^<]+)<\/h3>[\s\S]*?<div class="film-infor">\s*<span>([^<]+)<\/span>\s*<i[^>]*><\/i>\s*([^<]+)\s*<i[^>]*><\/i>/g;

      const out = [];
      for (const m of html.matchAll(regex)) {
        const rawHref = m[1];
        if (!rawHref || rawHref.startsWith("search?")) continue;

        const pagePath = ensureWatchPath(rawHref);
        if (!pagePath) continue;

        const jname = decodeHtmlEntities((m[2] || "").trim());
        const title = decodeHtmlEntities((m[3] || "").trim());
        const dateStr = (m[4] || "").trim();
        const format = ((m[5] || "").trim() || "").toUpperCase();

        const id = extractIdFromHref(pagePath) || extractIdFromHref(rawHref) || pagePath;

        out.push({
          id,
          pagePath,
          title,
          normTitle: normalize(title),
          normTitleJP: normalize(jname),
          startDate: parseStartDate(dateStr),
          format
        });
      }
      return out;
    };

    const scoreCandidate = (m) => {
      const t1 = levenshteinSimilarity(m.normTitle, targetNorm);
      const t2 = levenshteinSimilarity(m.normTitleJP, targetNormAlt);
      let titleScore = Math.max(t1, t2);

      // substring boosts (useful when site has extra words)
      if (m.normTitle.includes(targetNorm) || targetNorm.includes(m.normTitle)) titleScore = Math.max(titleScore, 0.86);
      if (m.normTitleJP.includes(targetNormAlt) || targetNormAlt.includes(m.normTitleJP)) titleScore = Math.max(titleScore, 0.86);

      const wantFormat = (query?.media?.format || "").toUpperCase();
      const formatScore = !wantFormat ? 0.75 : (m.format === wantFormat ? 1 : 0.65);

      // If the site doesn't provide year/month, don't punish hard.
      const y = m.startDate?.year || 0;
      const mo = m.startDate?.month || 0;

      let yearScore = 0.75; // unknown / not provided
      if (startYear && y) yearScore = (startYear === y ? 1 : 0);

      let monthBonus = 0;
      if (startYear && y && startYear === y && startMonth && mo) {
        monthBonus = (startMonth === mo ? 0.1 : 0);
      }

      // Weighted final
      return (titleScore * 0.78) + (yearScore * 0.14) + (formatScore * 0.08) + monthBonus;
    };

    const base = `${this.baseUrl}/ajax/search/suggest?keyword=${encodeURIComponent(query.query)}`;

    const bestById = new Map();
    let anyUseful = false;

    for (let page = 1; page <= 7; page++) {
      const pageUrl = page === 1 ? base : `${base}&page=${page}`;
      const pageMatches = await fetchMatches(pageUrl);

      if (!pageMatches.length) break;

      // Track if this page has anything vaguely similar; otherwise stop early.
      const maxTitleSim = pageMatches.reduce((mx, m) => {
        const t = Math.max(
          levenshteinSimilarity(m.normTitle, targetNorm),
          levenshteinSimilarity(m.normTitleJP, targetNormAlt)
        );
        return Math.max(mx, t);
      }, 0);

      if (maxTitleSim < 0.35 && anyUseful) break;
      if (maxTitleSim >= 0.35) anyUseful = true;

      for (const m of pageMatches) {
        const s = scoreCandidate(m);
        const prev = bestById.get(m.id);
        if (!prev || s > prev._score) {
          bestById.set(m.id, { ...m, _score: s });
        }
      }

      // If we already have strong matches, don't keep paging forever.
      const currentBest = Array.from(bestById.values()).reduce((mx, m) => Math.max(mx, m._score), 0);
      if (currentBest >= 0.92) break;
    }

    let candidates = Array.from(bestById.values());

    // If filtering was too strict for newer/unknown entries, keep looser candidates.
    candidates = candidates
      .filter((m) => m._score >= 0.58)
      .sort((a, b) => b._score - a._score)
      .slice(0, 12);

    // Last-resort fallback: if nothing, try the normal search page and match by substring only.
    if (!candidates.length) {
      const url2 = `${this.baseUrl}/search?keyword=${encodeURIComponent(query.query)}`;
      const html = await this._nativeFetch(url2).then(r => r.text());

      const regex2 = /<a href="\/watch\/([^"]+)"[^>]+title="([^"]+)"[^>]+data-id="(\d+)"/g;
      const out = [];
      for (const m of html.matchAll(regex2)) {
        const id = m[3];
        const pagePath = `watch/${m[1].split("?")[0]}`;
        const title = decodeHtmlEntities(m[2]);
        const norm = normalize(title);
        const sim = Math.max(levenshteinSimilarity(norm, targetNorm), levenshteinSimilarity(norm, targetNormAlt));
        if (sim >= 0.52 || norm.includes(targetNorm) || targetNorm.includes(norm)) {
          out.push({ id, pagePath, title, _score: sim });
        }
      }
      out.sort((a, b) => b._score - a._score);
      candidates = out.slice(0, 12);
    }

    return candidates.map((m) => ({
      id: `${m.id}/${query.dub ? "dub" : "sub"}`,
      title: m.title,
      url: `${this.baseUrl}/${m.pagePath}`,
      subOrDub: query.dub ? "dub" : "sub"
    }));
  }

  async getEpisodes(animeId) {
    const [id, subOrDub] = (animeId || "").split("/");
    const cacheKey = `episodes-${id}`;
    const cached = this._getCached(cacheKey);
    if (cached) return cached.filter(ep => ep.id.endsWith(`/${subOrDub}`));

    const res = await this._nativeFetch(`${this.baseUrl}/ajax/v2/episode/list/${id}`, {
      headers: { "X-Requested-With": "XMLHttpRequest" }
    });
    const json = await res.json();
    const html = json && json.html ? json.html : "";

    const episodes = [];
    const regex = /<a[^>]*class="[^"]*\bep-item\b[^"]*"[^>]*data-number="(\d+)"[^>]*data-id="(\d+)"[^>]*href="([^"]+)"[\s\S]*?<div class="ep-name[^"]*"[^>]*title="([^"]+)"/g;

    let match;
    while ((match = regex.exec(html)) !== null) {
      const epNum = parseInt(match[1], 10);
      const epId = match[2];
      const epUrl = this.baseUrl + match[3];
      const epTitle = match[4];

      episodes.push({ id: `${epId}/sub`, number: epNum, url: epUrl, title: epTitle });
      episodes.push({ id: `${epId}/dub`, number: epNum, url: epUrl, title: epTitle });
    }

    this._setCache(cacheKey, episodes);
    return episodes.filter(ep => ep.id.endsWith(`/${subOrDub}`));
  }

  async getStreamingLinks(episodeId, server = "default") {
    const [id, subOrDub] = (episodeId || "").split("/");
    const allowedTypes = subOrDub === "sub" ? ["sub", "raw"] : [subOrDub];
    const typePattern = allowedTypes.join("|");
    const serverName = server !== "default" ? server : "HD-1";

    const serverJson = await this._nativeFetch(
      `${this.baseUrl}/ajax/v2/episode/servers?episodeId=${id}`,
      { headers: { "X-Requested-With": "XMLHttpRequest" } }
    ).then(res => res.json());

    const serverHtml = serverJson && serverJson.html ? serverJson.html : "";
    const regex = new RegExp(
      `<div[^>]*class="item server-item"[^>]*data-type="(${typePattern})"[^>]*data-id="(\\d+)"[^>]*>\\s*<a[^>]*>\\s*${serverName}\\s*</a>`,
      "i"
    );

    const match = regex.exec(serverHtml);
    if (!match) throw new Error(`Server "${serverName}" (${allowedTypes.join("/")}) not found`);

    const serverId = match[2];

    const sourcesJson = await this._nativeFetch(
      `${this.baseUrl}/ajax/v2/episode/sources?id=${serverId}`,
      { headers: { "X-Requested-With": "XMLHttpRequest" } }
    ).then(res => res.json());

    let decryptData = null;

    try {
      decryptData = await this._extractMegaCloud(sourcesJson.link);
    } catch (err) {
      console.warn("Primary decrypter failed:", err);
    }

    if (!decryptData) {
      console.warn("Primary decrypter failed — trying fallback API...");
      const fallbackRes = await this._nativeFetch(
        `https://ac-api.ofchaos.com/api/anime/embed/convert/v2?embedUrl=${encodeURIComponent(sourcesJson.link)}`
      );
      decryptData = await fallbackRes.json();
    }

    const streamSource =
      (decryptData.sources || []).find(s => s.type === "hls") ||
      (decryptData.sources || []).find(s => s.type === "mp4");

    if (!streamSource || !streamSource.file) throw new Error("No valid stream file found");

    const subtitles = (decryptData.tracks || [])
      .filter(t => t.kind === "captions")
      .map((track, index) => ({
        id: `sub-${index}`,
        language: track.label || "Unknown",
        url: track.file,
        isDefault: !!track.default,
      }));

    return {
      server: serverName,
      headers: {
        "Referer": "https://megacloud.club/",
        "Origin": "https://megacloud.club",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36 Edg/139.0.0.0",
      },
      sources: [
        {
          file: streamSource.file,
          type: streamSource.type === "hls" ? "m3u8" : "mp4",
          quality: "auto",
        }
      ],
      subtitles
    };
  }

  async _extractMegaCloud(embedUrl) {
    const url = new URL(embedUrl);
    const baseDomain = `${url.protocol}//${url.host}/`;

    const headers = {
      "Accept": "*/*",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": baseDomain,
      "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
    };

    const html = await this._nativeFetch(embedUrl, { headers }).then(r => r.text());

    const fileIdMatch = html.match(/<title>\s*File\s+#([a-zA-Z0-9]+)\s*-/i);
    if (!fileIdMatch) throw new Error("file_id not found in embed page");
    const fileId = fileIdMatch[1];

    let nonce = null;
    const match48 = html.match(/\b[a-zA-Z0-9]{48}\b/);
    if (match48) {
      nonce = match48[0];
    } else {
      const match3x16 = [...html.matchAll(/["']([A-Za-z0-9]{16})["']/g)];
      if (match3x16.length >= 3) {
        nonce = match3x16[0][1] + match3x16[1][1] + match3x16[2][1];
      }
    }
    if (!nonce) throw new Error("nonce not found");

    const sourcesJson = await this._nativeFetch(
      `${baseDomain}embed-2/v3/e-1/getSources?id=${fileId}&_k=${nonce}`,
      { headers }
    ).then(r => r.json());

    return {
      sources: sourcesJson.sources,
      tracks: sourcesJson.tracks || [],
      intro: sourcesJson.intro || null,
      outro: sourcesJson.outro || null,
      server: sourcesJson.server || null,
    };
  }
}

module.exports = new HiAnime();
