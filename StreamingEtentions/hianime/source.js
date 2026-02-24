class HiAnime {
  constructor() {
    this.baseUrl = "https://hianime.to";
    this._cache = {};
    this._cacheMaxAge = 1000 * 60 * 5;
    this._defaultServers = ["HD-1", "HD-2", "HD-3"];
    this._defaultTimeoutMs = 12000;
  }

  getMetaData() {
    return {
      id: "hianime",
      name: "HiAnime",
      version: "3.1.1",
      author: "Fixed",
      description: "Streams from HiAnime.to with fallback API",
      url: this.baseUrl,
      supportsSub: true,
      supportsDub: true,
      settings: {
        episodeServers: this._defaultServers.slice()
      }
    };
  }

  getSettings() {
    return {
      episodeServers: this._defaultServers.slice()
    };
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  _nativeFetch(url, options = {}, retries = 2) {
    const hasAbort = typeof AbortController !== "undefined";
    const controller = hasAbort ? new AbortController() : null;

    const timeout = setTimeout(() => {
      try { controller && controller.abort(); } catch (_) {}
    }, this._defaultTimeoutMs);

    const opts = controller ? { ...(options || {}), signal: controller.signal } : (options || {});

    return fetch(url, opts)
      .finally(() => clearTimeout(timeout))
      .catch(async (err) => {
        clearTimeout(timeout);
        if (retries > 0) {
          try { console.log(`Fetch failed for ${url}, retrying... (${retries} left)`); } catch (_) {}
          await this._sleep(500);
          return this._nativeFetch(url, options, retries - 1);
        }
        throw err;
      });
  }

  async _fetchText(url, options) {
    const res = await this._nativeFetch(url, options);
    return res.text();
  }

  async _fetchJsonFromText(url, options) {
    const raw = await this._fetchText(url, options);
    try {
      return JSON.parse(raw);
    } catch (_) {
      throw new Error("Non-JSON response (blocked or server changed)");
    }
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
        .replace(/(season|cour|part|the animation|the movie|movie)/g, "")
        .replace(/\d+(st|nd|rd|th)/g, (m) => m.replace(/st|nd|rd|th/, ""))
        .replace(/[^a-z0-9]+/g, "")
        .replace(/(?<!i)ii(?!i)/g, "2");
    };

    const normalizeTitle = (title) => {
      return (title || "")
        .toLowerCase()
        .replace(/(season|cour|part|uncensored)/g, "")
        .replace(/\d+(st|nd|rd|th)/g, (m) => m.replace(/st|nd|rd|th/, ""))
        .replace(/[^a-z0-9]+/g, "");
    };

    const decodeHtmlEntities = (str) => {
      return (str || "")
        .replace(/\\u0026/g, "&")
        .replace(/&#(\d+);?/g, (m, dec) => String.fromCharCode(dec))
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">");
    };

    const levenshteinSimilarity = (a, b) => {
      const lenA = a.length;
      const lenB = b.length;
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
      return maxLen === 0 ? 0 : (1 - distance / maxLen);
    };

    const start = query && query.media ? query.media.startDate : null;
    const targetNormJP = normalize(query?.media?.romajiTitle);
    const targetNorm = query?.media?.englishTitle ? normalize(query.media.englishTitle) : targetNormJP;

    const monthMap = {
      Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
      Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
    };

    const fetchMatches = async (url) => {
      const reply = await this._fetchJsonFromText(url, {
        headers: { "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/plain, */*" }
      });

      const html = reply && reply.html ? String(reply.html) : "";

      const regex = /<a href="\/([^"]+)" class="nav-item">[\s\S]*?<h3 class="film-name"[^>]*data-jname="([^"]+)"[^>]*>([^<]+)<\/h3>[\s\S]*?<div class="film-infor">\s*<span>([^<]+)<\/span>\s*<i[^>]*><\/i>\s*([^<]+)\s*<i[^>]*><\/i>/g;

      const matches = [...html.matchAll(regex)]
        .map((m) => {
          const pageUrl = m[1];
          if (!pageUrl || pageUrl.startsWith("search?")) return null;

          const jname = (m[2] || "").trim();
          const title = (m[3] || "").trim();
          const dateStr = (m[4] || "").trim();
          const format = (m[5] || "").trim().toUpperCase();

          let startDate = { year: 0, month: 0, day: 0 };
          const dateMatch = dateStr.match(/([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
          if (dateMatch) {
            const month = monthMap[dateMatch[1]];
            const day = parseInt(dateMatch[2], 10);
            const year = parseInt(dateMatch[3], 10);
            startDate = { year, month: month || 0, day: isNaN(day) ? 0 : day };
          }

          const idMatch = pageUrl.match(/-(\d+)$/);
          const id = idMatch ? idMatch[1] : pageUrl;

          return {
            id,
            pageUrl,
            title: decodeHtmlEntities(title),
            normTitleJP: normalize(decodeHtmlEntities(jname)),
            normTitle: normalize(decodeHtmlEntities(title)),
            startDate,
            format,
          };
        })
        .filter(Boolean);

      return matches;
    };

    const url = `${this.baseUrl}/ajax/search/suggest?keyword=${encodeURIComponent(query?.query || "")}`;
    let matches;
    try {
      matches = await fetchMatches(url);
    } catch (e) {
      try { console.warn("Suggest search failed:", e && e.message ? e.message : e); } catch (_) {}
      return [];
    }

    if (!matches || matches.length === 0) return [];

    const exactTitle = (m) => m.normTitle === targetNorm || m.normTitleJP === targetNormJP;
    const looseTitle = (m) =>
      levenshteinSimilarity(m.normTitle, targetNorm) > 0.8 ||
      levenshteinSimilarity(m.normTitleJP, targetNormJP) > 0.8;
    const looserTitle = (m) =>
      m.normTitle.includes(targetNorm) ||
      m.normTitleJP.includes(targetNormJP) ||
      targetNorm.includes(m.normTitle) ||
      targetNormJP.includes(m.normTitleJP) ||
      levenshteinSimilarity(m.normTitle, targetNorm) > 0.6 ||
      levenshteinSimilarity(m.normTitleJP, targetNormJP) > 0.6;

    const dateYM = (m) => m.startDate?.year === start?.year && m.startDate?.month === start?.month;
    const dateY = (m) => m.startDate?.year === start?.year;
    const exactFormat = (m) => (m.format || "") === String(query?.media?.format || "").toUpperCase();

    const matchTiers = [
      (m) => exactTitle(m) && dateYM(m) && exactFormat(m),
      (m) => exactTitle(m) && dateY(m) && exactFormat(m),
      (m) => looseTitle(m) && dateYM(m) && exactFormat(m),
      (m) => looseTitle(m) && dateY(m) && exactFormat(m),
    ];

    let filtered = [];

    for (let page = 1; page <= 7; page++) {
      const pageUrl = page === 1 ? url : `${url}&page=${page}`;
      let pageMatches;
      try {
        pageMatches = await fetchMatches(pageUrl);
      } catch (_) {
        break;
      }

      if (!pageMatches || !pageMatches.length) break;

      const hasLoose = pageMatches.some(looserTitle);
      if (!hasLoose) break;

      for (const tier of matchTiers) {
        filtered = pageMatches.filter(tier);
        if (filtered.length) break;
      }

      if (filtered.length) break;
    }

    let results = (filtered.length ? filtered : matches).map((m) => ({
      id: `${m.id}/${query?.dub ? "dub" : "sub"}`,
      title: m.title,
      url: `${this.baseUrl}/${m.pageUrl}`,
      subOrDub: query?.dub ? "dub" : "sub",
    }));

    if (!query?.media?.startDate || !query.media.startDate.year) {
      const fetchMatches2 = async (url2) => {
        const html = await this._fetchText(url2, {});
        const regex = /<a href="\/watch\/([^"]+)"[^>]+title="([^"]+)"[^>]+data-id="(\d+)"/g;

        return [...html.matchAll(regex)].map((m) => {
          const id = m[3];
          const pageUrl = m[1];
          const title = m[2];
          const jnameRegex = new RegExp(
            `<h3 class="film-name">[\\s\\S]*?<a[^>]+href="\\/${pageUrl}[^"]*"[^>]+data-jname="([^"]+)"`,
            "i"
          );
          const jnameMatch = html.match(jnameRegex);
          const jname = jnameMatch ? jnameMatch[1] : null;
          return {
            id,
            pageUrl,
            title: decodeHtmlEntities(title),
            normTitleJP: normalizeTitle(decodeHtmlEntities(jname)),
            normTitle: normalizeTitle(decodeHtmlEntities(title)),
          };
        });
      };

      const url2 = `${this.baseUrl}/search?keyword=${encodeURIComponent(query?.query || "")}`;
      let matches2 = [];
      try {
        matches2 = await fetchMatches2(url2);
      } catch (_) {
        matches2 = [];
      }

      const qn = normalizeTitle(query?.query || "");
      filtered = matches2.filter((m) => {
        return (
          m.normTitle === qn ||
          m.normTitleJP === qn ||
          m.normTitle.includes(qn) ||
          m.normTitleJP.includes(qn) ||
          qn.includes(m.normTitle) ||
          qn.includes(m.normTitleJP)
        );
      });

      filtered.sort((a, b) => {
        const A = normalizeTitle(a.title);
        const B = normalizeTitle(b.title);
        if (A.length !== B.length) return A.length - B.length;
        return A.localeCompare(B);
      });

      if (filtered.length) {
        results = filtered.map((m) => ({
          id: `${m.id}/${query?.dub ? "dub" : "sub"}`,
          title: m.title,
          url: `${this.baseUrl}/${m.pageUrl}`,
          subOrDub: query?.dub ? "dub" : "sub",
        }));
      }
    }

    return results;
  }

  async getEpisodes(animeId) {
    const [id, subOrDub] = String(animeId || "").split("/");
    const cacheKey = `episodes-${id}`;
    const cached = this._getCached(cacheKey);
    if (cached) return cached.filter((ep) => String(ep.id).endsWith(`/${subOrDub}`));

    const json = await this._fetchJsonFromText(`${this.baseUrl}/ajax/v2/episode/list/${id}`, {
      headers: { "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/plain, */*" }
    });

    const html = json && json.html ? String(json.html) : "";

    const episodes = [];
    const regex = /<a[^>]*class="[^"]*\bep-item\b[^"]*"[^>]*data-number="(\d+)"[^>]*data-id="(\d+)"[^>]*href="([^"]+)"[\s\S]*?<div class="ep-name[^"]*"[^>]*title="([^"]+)"/g;

    let match;
    while ((match = regex.exec(html)) !== null) {
      episodes.push({
        id: `${match[2]}/sub`,
        number: parseInt(match[1], 10),
        url: this.baseUrl + match[3],
        title: match[4],
      });
      episodes.push({
        id: `${match[2]}/dub`,
        number: parseInt(match[1], 10),
        url: this.baseUrl + match[3],
        title: match[4],
      });
    }

    this._setCache(cacheKey, episodes);
    return episodes.filter((ep) => String(ep.id).endsWith(`/${subOrDub}`));
  }

  async getStreamingLinks(episodeId, server = "default") {
    const [id, subOrDub] = String(episodeId || "").split("/");
    const allowedTypes = subOrDub === "sub" ? ["sub", "raw"] : [subOrDub];
    const typePattern = allowedTypes.join("|");
    const serverName = server !== "default" ? server : "HD-1";

    const serverJson = await this._fetchJsonFromText(
      `${this.baseUrl}/ajax/v2/episode/servers?episodeId=${encodeURIComponent(id)}`,
      { headers: { "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/plain, */*" } }
    );

    const serverHtml = serverJson && serverJson.html ? String(serverJson.html) : "";
    const regex = new RegExp(
      `<div[^>]*class="item server-item"[^>]*data-type="(${typePattern})"[^>]*data-id="(\\d+)"[^>]*>\\s*<a[^>]*>\\s*${serverName}\\s*</a>`,
      "i"
    );

    const match = regex.exec(serverHtml);
    if (!match) throw new Error(`Server "${serverName}" (${allowedTypes.join("/")}) not found`);

    const serverId = match[2];

    const sourcesJson = await this._fetchJsonFromText(
      `${this.baseUrl}/ajax/v2/episode/sources?id=${encodeURIComponent(serverId)}`,
      { headers: { "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/plain, */*" } }
    );

    let decryptData = null;

    try {
      decryptData = await this._extractMegaCloud(String(sourcesJson.link || ""));
    } catch (err) {
      try { console.warn("Primary decrypter failed:", err); } catch (_) {}
    }

    if (!decryptData) {
      try { console.warn("Primary decrypter failed — trying fallback API..."); } catch (_) {}
      const fallbackRes = await this._nativeFetch(
        `https://ac-api.ofchaos.com/api/anime/embed/convert/v2?embedUrl=${encodeURIComponent(String(sourcesJson.link || ""))}`
      );
      const raw = await fallbackRes.text();
      try {
        decryptData = JSON.parse(raw);
      } catch (_) {
        throw new Error("Fallback API returned non-JSON");
      }
    }

    const sourcesArr = Array.isArray(decryptData?.sources) ? decryptData.sources : [];
    const streamSource =
      sourcesArr.find((s) => s && s.type === "hls") ||
      sourcesArr.find((s) => s && s.type === "mp4");

    if (!streamSource || !streamSource.file) throw new Error("No valid stream file found");

    const subtitles = (Array.isArray(decryptData?.tracks) ? decryptData.tracks : [])
      .filter((t) => t && t.kind === "captions" && t.file)
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
    if (!embedUrl) throw new Error("Missing embedUrl");

    const url = new URL(embedUrl);
    const baseDomain = `${url.protocol}//${url.host}/`;

    const headers = {
      "Accept": "*/*",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": baseDomain,
      "User-Agent": "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
    };

    const html = await this._fetchText(embedUrl, { headers });

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

    const sourcesJson = await this._fetchJsonFromText(
      `${baseDomain}embed-2/v3/e-1/getSources?id=${encodeURIComponent(fileId)}&_k=${encodeURIComponent(nonce)}`,
      { headers }
    );

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
