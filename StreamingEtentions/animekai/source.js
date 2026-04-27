// Replace these methods inside class AnimeKai in your source.js

  _parseServersHtml(html) {
    console.log("[AnimeKai] _parseServersHtml RAW HTML (len=" + html.length + "): " + html.substring(0, 2000).replace(/\s+/g, " "));

    var out = [];
    var seen = {};

    var self = this;

    function cleanType(type) {
      type = String(type || "").toLowerCase().trim();
      if (type === "hard-sub" || type === "hardsub") return "sub";
      if (type === "soft-sub" || type === "softsubs" || type === "s-sub") return "softsub";
      if (type === "dubbed" || type === "dub-s-sub" || type === "dub-&-s-sub") return "dub";
      if (type === "sub" || type === "softsub" || type === "dub") return type;
      return "";
    }

    function addServer(type, attrs, text) {
      type = cleanType(type);
      var lid = attrs["data-lid"] || attrs.lid || "";
      if (!type || !lid) return;

      var key = type + "|" + lid;
      if (seen[key]) return;
      seen[key] = true;

      var name = self._stripTags(text || "").trim() || attrs.title || attrs["data-name"] || "Server";
      out.push({
        lid: lid,
        sid: attrs["data-sid"] || attrs.sid || "",
        eid: attrs["data-eid"] || attrs.eid || "",
        type: type,
        name: name,
        label: self._typeSuffix(type) + " - " + name
      });
      console.log("[AnimeKai] _parseServersHtml found type=" + type + " lid=" + lid + " name=" + name);
    }

    var groupRe = /<div\b([^>]*\bserver-items\b[^>]*)>([\s\S]*?)<\/div>/gi;
    var group;
    while ((group = groupRe.exec(String(html || ""))) !== null) {
      var groupAttrs = this._attrs(group[1]);
      var type = cleanType(groupAttrs["data-id"] || groupAttrs["data-type"] || groupAttrs.lang || "");
      if (!type) continue;

      var groupHtml = group[2] || "";
      var itemRe = /<(?:span|button|a)\b([^>]*\bdata-lid\b[^>]*)>([\s\S]*?)<\/(?:span|button|a)>/gi;
      var item;
      while ((item = itemRe.exec(groupHtml)) !== null) {
        addServer(type, this._attrs(item[1]), item[2] || "");
      }
    }

    if (!out.length) {
      console.warn("[AnimeKai] _parseServersHtml typed group parse failed, trying section fallback");
      var sectionRe = /data-id=["'](sub|softsub|dub)["'][\s\S]*?(?=data-id=["'](?:sub|softsub|dub)["']|$)/gi;
      var section;
      while ((section = sectionRe.exec(String(html || ""))) !== null) {
        var type2 = cleanType(section[1]);
        var sectionHtml = section[0] || "";
        var itemRe2 = /<(?:span|button|a)\b([^>]*\bdata-lid\b[^>]*)>([\s\S]*?)<\/(?:span|button|a)>/gi;
        var item2;
        while ((item2 = itemRe2.exec(sectionHtml)) !== null) {
          addServer(type2, this._attrs(item2[1]), item2[2] || "");
        }
      }
    }

    console.log("[AnimeKai] _parseServersHtml FINAL found=" + out.length + " servers=" + out.map(function(s) { return s.type + ":" + s.label + "(lid=" + s.lid + ")"; }).join(", "));
    return out;
  }

  _chooseServer(servers, serverName, track) {
    if (!servers || !servers.length) return null;
    var want = String(serverName || "").toLowerCase().replace(/\s+/g, "-");
    var wantDub = track === "dub" || want.indexOf("dub") !== -1;
    var preferredTypes = wantDub ? ["dub"] : ["sub", "softsub"];

    console.log("[AnimeKai] _chooseServer want=" + want + " track=" + track + " available=[" + servers.map(function(s) { return s.type + ":" + s.label; }).join(", ") + "]");

    if (want && want !== "default") {
      for (var i = 0; i < servers.length; i++) {
        var full = String(servers[i].label || servers[i].name || "").toLowerCase().replace(/\s+/g, "-");
        if ((full === want || full.indexOf(want) !== -1 || want.indexOf(full) !== -1) && preferredTypes.indexOf(servers[i].type) !== -1) {
          console.log("[AnimeKai] _chooseServer matched by name: " + servers[i].label);
          return servers[i];
        }
      }
    }

    for (var t = 0; t < preferredTypes.length; t++) {
      for (var j = 0; j < servers.length; j++) {
        if (servers[j].type === preferredTypes[t]) {
          console.log("[AnimeKai] _chooseServer picked by type: " + servers[j].label);
          return servers[j];
        }
      }
    }

    if (wantDub) {
      console.warn("[AnimeKai] _chooseServer no dub server found, refusing to fall back to sub");
      return null;
    }

    console.log("[AnimeKai] _chooseServer fallback to first: " + servers[0].label);
    return servers[0];
  }

  checkDubForEpisode(arg) {
    arg = this._parseArg(arg);
    var mediaId = String(arg.animeId || arg.mediaId || arg.id || "").trim();
    mediaId = mediaId.replace(/\/(sub|dub)$/i, "");
    var wanted = Number(arg.episodeNumber || arg.episode || arg.number || 1);
    if (!mediaId || !isFinite(wanted)) return false;

    try {
      var episodes = this.findEpisodes(mediaId + "/dub") || [];
      var match = null;
      for (var i = 0; i < episodes.length; i++) {
        if (Math.abs(Number(episodes[i].number || 0) - wanted) < 0.001) {
          match = episodes[i];
          break;
        }
      }
      if (!match) return false;

      var server = this.findEpisodeServer(match, "Dub & S-Sub");
      var sources = server && (server.videoSources || server.sources || []);
      return !!(sources && sources.length);
    } catch (e) {
      console.warn("[AnimeKai] checkDubForEpisode failed: " + (e && e.message || e));
      return false;
    }
  }
