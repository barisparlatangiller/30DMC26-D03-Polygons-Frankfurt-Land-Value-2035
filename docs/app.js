/* Frankfurt 2035 · Land Value Scenarios — #30DayMapChallenge 2026 · Day 3 · Polygons */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const fmt = (v, d = 0) => v == null || Number.isNaN(v) ? "–" : Number(v).toLocaleString("en-GB", { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (v, d = 1) => v == null || Number.isNaN(v) ? "–" : (v > 0 ? "+" : "") + fmt(v * 100, d) + " %";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const GN = { W: "Residential", M: "Mixed use", G: "Commercial", O: "Other" };
  const MN = { m1: "M1 Stagnation", m2: "M2 Dampened trend", m3: "M3 Trend continues", m4: "M4 Your rate", sim: "Simulation" };
  // value palette (€/m², log-like steps)
  const VB = [10, 50, 150, 300, 500, 750, 1000, 1500, 2500, 5000];
  const VC = ["#f3efe6", "#e9e1c8", "#f2d58a", "#f0b45e", "#e98a49", "#d9603f", "#bb3f45", "#92284f", "#651b52", "#3d1347", "#1c0b30"];
  const CB = [-0.3, -0.15, -0.05, -0.01, 0.01, 0.05, 0.15, 0.3];
  const CC = ["#7a1f3d", "#c2456a", "#ec9bb0", "#f6d6de", "#ece8df", "#cfe6e2", "#86c6bd", "#2f9488", "#145b55"];
  const NA = "#dcd7cd";
  const UC = { W: "#e4a33a", M: "#c75b7a", G: "#4f78c4", O: "#9db58a" };                      // zone land use
  const BN = { res: "Residential", com: "Commerce & offices", pub: "Public & community", ind: "Industry & utilities", gar: "Garages & parking", oth: "Other structures" };
  const BC = { res: "#e4a33a", com: "#4f78c4", pub: "#8a63c2", ind: "#6e6a66", gar: "#b9b2a6", oth: "#d6d0c4" };
  const HEAT_NAMES = ["cooler third", "middle third", "hottest third"];

  const state = { year: 2026, model: "m3", u: 2, p: "50", hadj: 0, grp: "all", col: "value", view: "2d", heat: false, opac: 0.85, sel: null };
  let map, Z, S, HEAT = null, popup, playing = null;

  const j = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(u + " " + r.status); return r.json(); });
  Promise.all([j("data/zones.geojson"), j("data/stats.json"), j("data/heat.json").catch(() => null)]).then(([z, s, h]) => {
    Z = z; S = s; HEAT = h && h.corners ? h : null;
    initMap(); initPanel();
  }).catch((e) => { $("#loading").textContent = "Could not load the data: " + e.message; });

  // ------------------------------------------------------------------ scenario maths (same formulas in expressions and JS)
  const future = () => state.year > 2026;
  function rateOf(p) {                       // yearly rate for a zone in the current model, or null
    const h = p.hot === 2 ? state.hadj / 100 : 0;
    if (state.model === "m1") return 0;
    if (state.model === "m2") return p.r22 == null ? null : 0.5 * p.r22 + h;
    if (state.model === "m3") return p.r22 == null ? null : p.r22 + h;
    if (state.model === "m4") return state.u / 100 + h;
    return null;
  }
  function valueOf(p, year = state.year, model = state.model) {
    if (year <= 2026) return p["v" + String(year).slice(2)] ?? null;
    if (p.v26 == null) return null;
    if (model === "sim") return p[`s${String(year).slice(2)}${state.p}`] ?? null;
    const keep = state.model; state.model = model; const r = rateOf(p); state.model = keep;
    return r == null ? null : p.v26 * Math.pow(1 + r, year - 2026);
  }
  function baseOf(p) { return future() ? p.v26 : p.v22; }       // change: vs 2026 for scenarios, vs 2022 for 2024/2026

  function valueExpr() {
    const y = state.year;
    if (y <= 2026) return ["get", "v" + String(y).slice(2)];
    if (state.model === "sim") return ["get", `s${String(y).slice(2)}${state.p}`];
    const n = y - 2026, h = state.hadj / 100;
    const hot = ["case", ["==", ["get", "hot"], 2], h, 0];
    let r;
    if (state.model === "m1") r = 0;
    else if (state.model === "m4") r = ["+", state.u / 100, hot];
    else r = ["+", ["*", state.model === "m2" ? 0.5 : 1, ["get", "r22"]], hot];
    const need = state.model === "m2" || state.model === "m3" ? ["all", ["has", "r22"], ["has", "v26"]] : ["has", "v26"];
    return ["case", need, ["*", ["get", "v26"], ["^", ["+", 1, r], n]], -1];
  }
  function hasExpr() {
    const y = state.year;
    if (y <= 2026) return ["has", "v" + String(y).slice(2)];
    if (state.model === "sim") return ["has", `s${String(y).slice(2)}${state.p}`];
    return [">=", valueExpr(), 0];
  }
  function colorExpr(forBuildings = false) {
    if (state.col === "zuse") return ["match", ["get", "g"], "W", UC.W, "M", UC.M, "G", UC.G, "O", UC.O, NA];
    if (state.col === "buse") return forBuildings ? ["match", ["get", "c"], ...Object.entries(BC).flat(), NA] : (document.documentElement.dataset.dark ? "#3a3833" : "#ebe7df");
    const v = valueExpr();
    if (state.col === "zuse") {
      h = `<div class="lg-title">Land use of the BORIS zone</div><div class="lg-sub">${state.view === "3d" ? "buildings coloured by the zone they stand in" : "zones"}</div>` +
        Object.entries(UC).map(([k, c]) => `<div class="lg-row"><i class="sq" style="background:${c}"></i>${GN[k]}<small>${fmt(S.groups[k].n)} zones${S.buildings && S.buildings.by_zone_use[k] ? " · " + fmt(S.buildings.by_zone_use[k].n) + " buildings, median " + fmt(S.buildings.by_zone_use[k].h_median, 0) + " m" : ""}</small></div>`).join("");
    } else if (state.col === "buse") {
      h = `<div class="lg-title">Building use (cadastre)</div><div class="lg-sub">${state.view === "3d" ? "LoD2 buildings at measured height" : "switch to 3D buildings to see them"}</div>` +
        Object.entries(BC).map(([k, c]) => `<div class="lg-row"><i class="sq" style="background:${c}"></i>${BN[k]}<small>${S.buildings && S.buildings.by_cat[k] ? fmt(S.buildings.by_cat[k]) : ""}</small></div>`).join("");
    } else if (state.col === "change" && state.year !== 2022) {
      const base = future() ? ["get", "v26"] : ["get", "v22"];
      const ok = future() ? hasExpr() : ["all", ["has", "v22"], hasExpr()];
      const ch = ["-", ["/", v, base], 1];
      const e = ["step", ch, CC[0]]; CB.forEach((b, i) => e.push(b, CC[i + 1]));
      return ["case", ok, e, NA];
    }
    const e = ["step", ["coalesce", v, 0], VC[0]]; VB.forEach((b, i) => e.push(b, VC[i + 1]));
    return ["case", hasExpr(), e, NA];
  }

  function filterExpr() { return state.grp === "all" ? null : ["==", ["get", "g"], state.grp]; }

  // ------------------------------------------------------------------ map
  function initMap() {
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    if (dark) document.documentElement.dataset.dark = "1";
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
    map = new maplibregl.Map({
      container: "map", hash: true, maxPitch: 70, attributionControl: { compact: true },
      center: [8.64, 50.12], zoom: 10.7, minZoom: 9, maxZoom: 18,
      style: `https://basemaps.cartocdn.com/gl/${dark ? "dark-matter" : "positron"}-gl-style/style.json`
    });
    window._map = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");
    popup = new maplibregl.Popup({ closeButton: true, maxWidth: "360px", offset: 10 });
    let ready = false;
    const setup = () => {
      if (ready || !map.isStyleLoaded()) return;
      ready = true;
      const labels = map.getStyle().layers.filter((l) => l.type === "symbol").map((l) => l.id);
      if (HEAT) {
        map.addSource("heat", { type: "image", url: "data/heat.png", coordinates: HEAT.corners });
        map.addLayer({ id: "heat", type: "raster", source: "heat", paint: { "raster-opacity": 0, "raster-fade-duration": 0 } });
      }
      map.addSource("z", { type: "geojson", data: Z, promoteId: "i" });
      map.addLayer({ id: "zf", type: "fill", source: "z", paint: { "fill-color": colorExpr(), "fill-opacity": state.opac } });
      map.addLayer({ id: "zl", type: "line", source: "z", paint: { "line-color": dark ? "#111" : "#fff",
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 0.2, 14, 1], "line-opacity": 0.7 } });
      if (S.buildings) map.addSource("bld", { type: "vector", url: "pmtiles://" + new URL("data/buildings.pmtiles", location.href).href });
      else map.addSource("bld", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer(Object.assign({ id: "b3", type: "fill-extrusion", source: "bld", minzoom: 12, layout: { visibility: "none" },
        paint: { "fill-extrusion-color": colorExpr(true), "fill-extrusion-height": ["get", "h"], "fill-extrusion-base": 0,
                 "fill-extrusion-opacity": 0.92, "fill-extrusion-vertical-gradient": true } }, S.buildings ? { "source-layer": "b" } : {}));
      map.addLayer({ id: "zh", type: "line", source: "z", filter: ["==", ["get", "i"], -1],
        paint: { "line-color": dark ? "#fff" : "#1f1d1a", "line-width": 2.5 } });
      labels.forEach((id) => map.moveLayer(id));
      bind(); render();
      $("#loading").classList.add("done");
      try { if (!localStorage.getItem("d3-intro")) $("#intro").hidden = false; } catch (e) { $("#intro").hidden = false; }
    };
    map.on("load", setup);
    map.on("styledata", () => setTimeout(setup, 0));
    const poll = setInterval(() => { setup(); if (ready) clearInterval(poll); }, 400);
  }

  function render() {
    if (!map || !map.getLayer("zf")) return;
    const c = colorExpr(), f = filterExpr();
    map.setPaintProperty("zf", "fill-color", c);
    const b3 = state.view === "3d";
    map.setPaintProperty("zf", "fill-opacity", b3 ? Math.min(0.35, state.opac) : state.opac);
    map.setPaintProperty("b3", "fill-extrusion-color", colorExpr(true));
    map.setPaintProperty("b3", "fill-extrusion-opacity", Math.max(0.6, state.opac));
    map.setLayoutProperty("b3", "visibility", b3 ? "visible" : "none");
    ["zf", "zl", "b3"].forEach((l) => map.setFilter(l, f));
    if (map.getLayer("heat")) map.setPaintProperty("heat", "raster-opacity", state.heat ? 0.7 : 0);
    document.querySelectorAll("#yearSeg button").forEach((b) => b.classList.toggle("on", +b.dataset.y === state.year));
    document.querySelectorAll("#modelSeg button").forEach((b) => b.classList.toggle("on", b.dataset.m === state.model));
    document.querySelectorAll("#pSeg button").forEach((b) => b.classList.toggle("on", b.dataset.p === state.p));
    document.querySelectorAll("#useSeg button").forEach((b) => b.classList.toggle("on", b.dataset.g === state.grp));
    document.querySelectorAll("#colSeg button").forEach((b) => b.classList.toggle("on", b.dataset.c === state.col));
    document.querySelectorAll("#viewSeg button").forEach((b) => b.classList.toggle("on", b.dataset.view === state.view));
    $("#heatBtn").classList.toggle("on", state.heat);
    $("#modelBlock").classList.toggle("off", !future());
    $("#m4row").hidden = state.model !== "m4";
    $("#pSeg").hidden = state.model !== "sim";
    $("#heatRow").hidden = !S.heat || state.model === "m1" || state.model === "sim";
    $("#m4v").textContent = fmt(state.u, 1);
    $("#m4o").textContent = (state.u > 0 ? "+" : "") + fmt(state.u, 1) + " %";
    $("#hadjo").textContent = (state.hadj > 0 ? "+" : state.hadj < 0 ? "" : "±") + fmt(state.hadj, 1) + " pp";
    $("#modelHint").innerHTML = future() ? modelHint() : "Scenarios apply to 2028, 2030 and 2035. Pick one of those years.";
    $("#colHint").textContent = state.col === "zuse" ? "Land use of the BORIS zone (Bodenrichtwert use class). In 3D, every building takes the colour of the zone it stands in."
      : state.col === "buse" ? "Use of each building from the cadastre (ALKIS building function). Switch to 3D buildings to see it." : state.col === "change"
      ? (state.year === 2022 ? "2022 is the start year — showing values." : future() ? `Change from 2026 to ${state.year}.` : `Change from 2022 to ${state.year} (zones with a matched 2022 value).`)
      : "Official reference value (or scenario value) in € per m² of land.";
    legend(); fan();
    if (state.sel != null) showZone(state.sel, false);
  }
  function modelHint() {
    const n = { m1: "Values stay at their 2026 level: the reference line.", m2: "Half of each zone's yearly change 2022–2026 continues. Zones without a 2022 value stay grey.",
      m3: "Each zone's yearly change 2022–2026 continues unchanged. Zones without a 2022 value stay grey.",
      m4: "Every zone changes by the same yearly rate you choose.",
      sim: `Range from 1,000 simulated paths per zone. P10: 1 in 10 runs ends lower; P90: 1 in 10 ends higher.` }[state.model];
    return n + (state.hadj && state.model !== "m1" && state.model !== "sim" ? ` Heat what-if: ${state.hadj > 0 ? "+" : ""}${state.hadj} pp per year in the hottest third.` : "");
  }

  function bind() {
    const tip = $("#tip");
    let hoverB = false, clickB = false;
    const layer = () => "zf";
    const move = (e) => {
      const f = e.features[0], p = f.properties;
      map.getCanvas().style.cursor = "pointer";
      const v = valueOf(p), b = baseOf(p);
      tip.innerHTML = `<b>${GN[p.g]}</b> · ${esc(p.ul)}<br><span class="mono">${state.year}: ${v == null ? "no value" : fmt(v) + " €/m²"}</span>` +
        (v != null && b ? `<small>${pct(v / b - 1)} vs ${future() ? 2026 : 2022}</small>` : "");
      tip.hidden = false;
      const r = $("#map").getBoundingClientRect();
      tip.style.left = Math.min(e.point.x, r.width - tip.offsetWidth - 30) + "px"; tip.style.top = e.point.y + "px";
    };
    map.on("mousemove", "b3", (e) => {
      const p = e.features[0].properties; map.getCanvas().style.cursor = "pointer";
      const v = p.v26 != null ? valueOf(p) : null;
      tip.innerHTML = `<b>${BN[p.c] || "Building"}</b> · ${fmt(p.h, 0)} m<br><small>${p.g ? GN[p.g] + " zone" : "no BORIS zone"}${v != null ? ` · ${state.year}: ${fmt(v)} €/m²` : ""}</small>`;
      tip.hidden = false; const r = $("#map").getBoundingClientRect();
      tip.style.left = Math.min(e.point.x, r.width - tip.offsetWidth - 30) + "px"; tip.style.top = e.point.y + "px";
      hoverB = true;
    });
    map.on("mouseleave", "b3", () => { hoverB = false; tip.hidden = true; map.getCanvas().style.cursor = ""; });
    map.on("click", "b3", (e) => {
      const p = e.features[0].properties; clickB = true;
      popup.setLngLat(e.lngLat).setHTML(buildingHTML(p)).addTo(map);
      if (p.zi != null) showZone(p.zi);
    });
    ["zf"].forEach((l) => {
      map.on("mousemove", l, (e) => { if (!hoverB) move(e); });
      map.on("mouseleave", l, () => { tip.hidden = true; map.getCanvas().style.cursor = ""; });
      map.on("click", l, (e) => { if (clickB) { clickB = false; return; } const p = e.features[0].properties; showZone(p.i); popup.setLngLat(e.lngLat).setHTML(zoneHTML(p)).addTo(map); });
    });
  }

  // ------------------------------------------------------------------ zone detail
  const byId = (i) => Z.features[i].properties;
  function spark(p) {
    const W = 300, H = 120, pad = 26;
    const years = [2022, 2024, 2026, 2028, 2030, 2035];
    const series = {
      hist: [2022, 2024, 2026].map((y) => [y, valueOf(p, y)]).filter((d) => d[1] != null),
      m1: [2026, 2028, 2030, 2035].map((y) => [y, valueOf(p, y, "m1")]),
      m2: [2026, 2028, 2030, 2035].map((y) => [y, valueOf(p, y, "m2")]).filter((d) => d[1] != null),
      m3: [2026, 2028, 2030, 2035].map((y) => [y, valueOf(p, y, "m3")]).filter((d) => d[1] != null),
    };
    const band = [2026, 2028, 2030, 2035].map((y) => y === 2026 ? [y, p.v26, p.v26] : [y, p[`s${String(y).slice(2)}10`], p[`s${String(y).slice(2)}90`]]);
    const all = [].concat(...Object.values(series).map((s) => s.map((d) => d[1])), ...band.map((d) => [d[1], d[2]])).filter((v) => v != null);
    if (!all.length) return "";
    let lo = Math.min(...all), hi = Math.max(...all); if (hi - lo < 1) { hi += 1; lo -= 1; }
    const x = (y) => pad + (y - 2022) / 13 * (W - pad - 8), yv = (v) => H - 18 - (v - lo) / (hi - lo) * (H - 30);
    const path = (s) => s.map((d, i) => (i ? "L" : "M") + x(d[0]).toFixed(1) + "," + yv(d[1]).toFixed(1)).join("");
    const bandPath = band.every((d) => d[1] != null) ? "M" + band.map((d) => x(d[0]) + "," + yv(d[2])).join("L") + "L" + band.slice().reverse().map((d) => x(d[0]) + "," + yv(d[1])).join("L") + "Z" : "";
    return `<svg class="spark" viewBox="0 0 ${W} ${H}">
      ${bandPath ? `<path d="${bandPath}" fill="#8a7fb8" opacity=".18"/>` : ""}
      <line x1="${x(2026)}" x2="${x(2026)}" y1="6" y2="${H - 18}" stroke="#bbb" stroke-dasharray="2 3"/>
      ${series.m1.length ? `<path d="${path(series.m1)}" fill="none" stroke="#9b958a" stroke-width="1.5" stroke-dasharray="4 3"/>` : ""}
      ${series.m2.length > 1 ? `<path d="${path(series.m2)}" fill="none" stroke="#d98a3d" stroke-width="1.8"/>` : ""}
      ${series.m3.length > 1 ? `<path d="${path(series.m3)}" fill="none" stroke="#b33a3a" stroke-width="1.8"/>` : ""}
      <path d="${path(series.hist)}" fill="none" stroke="#2b2925" stroke-width="2.4"/>
      ${series.hist.map((d) => `<circle cx="${x(d[0])}" cy="${yv(d[1])}" r="3" fill="#2b2925"/>`).join("")}
      ${years.map((y) => `<text x="${x(y)}" y="${H - 4}" text-anchor="middle">${y}</text>`).join("")}
      <text x="2" y="${yv(hi) + 4}">${fmt(hi)}</text><text x="2" y="${yv(lo) + 4}">${fmt(lo)}</text>
    </svg><div class="spk"><i style="background:#2b2925"></i>official <i style="background:#9b958a"></i>M1 <i style="background:#d98a3d"></i>M2 <i style="background:#b33a3a"></i>M3 <i style="background:#8a7fb8;opacity:.4"></i>simulation P10–P90</div>`;
  }
  function zoneHTML(p) {
    const v = valueOf(p);
    const rows = [["2022 · 2024 · 2026", `${fmt(p.v22)} · ${fmt(p.v24)} · ${fmt(p.v26)} €/m²`],
      ["CAGR 2022–26", p.r22 != null ? pct(p.r22, 2) + "/yr" : "no matched 2022 value"],
      ["CAGR 2024–26", p.r24 != null ? pct(p.r24, 2) + "/yr" : "–"]];
    if (future()) rows.push([`${state.year} · ${MN[state.model]}${state.model === "sim" ? " P" + state.p : ""}`, v == null ? "not computed" : `${fmt(v)} €/m² <small>(${pct(v / p.v26 - 1)})</small>`]);
    if (p.s3510 != null) rows.push(["2035 simulation P10–P90", `${fmt(p.s3510)} – ${fmt(p.s3590)} €/m²`]);
    if (p.lst != null) rows.push(["Summer surface temp.", `${fmt(p.lst, 1)} °C <small>(${HEAT_NAMES[p.hot] || ""})</small>`]);
    if (p.gfz) rows.push(["Reference floor-area ratio", esc(p.gfz)]);
    rows.push(["Zone area", `${fmt(p.a, 1)} ha`]);
    return `<div class="pop"><b style="font-size:15px">${esc(p.ul)}</b><small>BORIS zone ${esc(p.z)}${p.nr > 1 ? " · two value records (averaged)" : ""}</small>
      <table class="ptab">${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("")}</table>
      ${p.all ? `<small>${esc(p.all)}</small>` : ""}${p.rm ? `<small>Note: ${esc(p.rm)}</small>` : ""}</div>`;
  }
  function buildingHTML(p) {
    const v = p.v26 != null ? valueOf(p) : null;
    const rows = [["Height (LoD2, measured)", `${fmt(p.h, 1)} m`], ["Building use", `${BN[p.c] || "–"}${p.fn ? ` <small>(ALKIS ${esc(p.fn)})</small>` : ""}`]];
    if (p.g) {
      rows.push(["Zone land use", `${esc(GN[p.g])}${p.u ? ` <small>(${esc(p.u)})</small>` : ""}`]);
      rows.push(["Land value 2022 · 24 · 26", `${fmt(p.v22)} · ${fmt(p.v24)} · ${fmt(p.v26)} €/m²`]);
      if (future()) rows.push([`${state.year} · ${MN[state.model]}`, v == null ? "not computed" : `${fmt(v)} €/m² <small>(${pct(v / p.v26 - 1)})</small>`]);
    }
    return `<div class="pop"><b style="font-size:15px">${BN[p.c] || "Building"} · ${fmt(p.h, 0)} m</b><small>Values are those of the BORIS zone the building stands in (land, not the building).</small>
      <table class="ptab">${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join("")}</table></div>`;
  }
  function showZone(i, scroll = true) {
    state.sel = i;
    const p = byId(i);
    map.setFilter("zh", ["==", ["get", "i"], i]);
    const v = valueOf(p);
    $("#detail").hidden = false;
    $("#detail").innerHTML = `<button class="close" aria-label="Close">×</button><h3>${esc(p.ul)}</h3>
      <p class="hint" style="margin:0">BORIS zone ${esc(p.z)} · ${fmt(p.a, 1)} ha${p.lst != null ? ` · ${fmt(p.lst, 1)} °C summer surface` : ""}</p>
      <div class="kpis">
        <div class="kpi"><b>${fmt(p.v26)}</b><span>€/m² 2026</span></div>
        <div class="kpi"><b>${p.r22 != null ? pct(p.r22, 1) : "–"}</b><span>per year 2022–26</span></div>
        <div class="kpi"><b>${future() && v != null ? fmt(v) : "–"}</b><span>${future() ? `€/m² ${state.year} · ${state.model.toUpperCase()}` : "pick 2028+"}</span></div>
      </div>${spark(p)}`;
    $("#detail .close").onclick = () => { $("#detail").hidden = true; state.sel = null; map.setFilter("zh", ["==", ["get", "i"], -1]); };
    if (scroll && innerWidth > 860) $("#detail").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // ------------------------------------------------------------------ panel
  function initPanel() {
    const W = S.groups.W, M = S.groups.M, G = S.groups.G;
    $("#lede").innerHTML = `Frankfurt's official land reference values have turned. Between 2022 and 2026 the median <b>residential</b> zone lost ${fmt(-W.pct22_26_med, 0)} % and <b>${fmt(S.w_falls.le_minus20)} of ${fmt(S.w_falls.n)}</b> residential zones fell by a fifth or more; <b>mixed-use</b> zones lost ${fmt(-M.pct22_26_med, 0)} %, while <b>commercial</b> land gained ${fmt(G.pct22_26_med, 0)} %. Where could ${fmt(S.zones)} zones be in 2035?`;
    document.querySelectorAll("#yearSeg button").forEach((b) => b.onclick = () => { stop(); state.year = +b.dataset.y; render(); });
    document.querySelectorAll("#modelSeg button").forEach((b) => b.onclick = () => { state.model = b.dataset.m; if (!future()) state.year = 2035; render(); });
    document.querySelectorAll("#pSeg button").forEach((b) => b.onclick = () => { state.p = b.dataset.p; render(); });
    document.querySelectorAll("#useSeg button").forEach((b) => b.onclick = () => { state.grp = b.dataset.g; render(); });
    document.querySelectorAll("#colSeg button").forEach((b) => b.onclick = () => { state.col = b.dataset.c; render(); });
    document.querySelectorAll("#viewSeg button").forEach((b) => b.onclick = () => {
      state.view = b.dataset.view;
      if (state.view === "3d") map.easeTo({ pitch: 60, bearing: -20, zoom: Math.max(map.getZoom(), 14.2), duration: 1200 });
      else map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
      render();
    });
    $("#m4").oninput = (e) => { state.u = +e.target.value; state.model = "m4"; if (!future()) state.year = 2035; render(); };
    $("#hadj").oninput = (e) => { state.hadj = +e.target.value; render(); };
    $("#opac").oninput = (e) => { state.opac = e.target.value / 100; render(); };
    $("#heatBtn").onclick = () => { if (!HEAT) return; state.heat = !state.heat; render(); };
    if (!HEAT) { $("#heatBtn").disabled = true; $("#heatBtn").title = "Heat data not available"; }
    $("#playBtn").onclick = () => playing ? stop() : play();
    $("#introGo").onclick = () => { $("#intro").hidden = true; try { localStorage.setItem("d3-intro", "1"); } catch (e) {} };
    const m = location.hostname.match(/^([^.]+)\.github\.io$/);
    if (m) { const repo = location.pathname.split("/").filter(Boolean)[0]; if (repo) $("#repoLink").href = `https://github.com/${m[1]}/${repo}`; }

    // group table
    $("#gtab").innerHTML = `<tr><th></th><th>2022</th><th>2024</th><th>2026</th><th>Δ 22–26</th><th>falling</th></tr>` +
      ["W", "M", "G", "O"].map((k) => { const g = S.groups[k]; return `<tr data-g="${k}"><td>${GN[k]}<small>${fmt(g.n)} zones</small></td><td>${fmt(g.v22)}</td><td>${fmt(g.v24)}</td><td>${fmt(g.v26)}</td>
        <td class="${g.pct22_26_med < 0 ? "neg" : "pos"}">${g.pct22_26_med == null ? "–" : (g.pct22_26_med > 0 ? "+" : "") + fmt(g.pct22_26_med, 1) + " %"}</td><td>${g.share_down == null ? "–" : fmt(g.share_down, 0) + " %"}</td></tr>`; }).join("");
    document.querySelectorAll("#gtab tr[data-g]").forEach((tr) => tr.onclick = () => { state.grp = tr.dataset.g; render(); });
    // heat text
    if (S.heat && S.heat.corr) {
      const c = S.heat.corr;
      const line = (k) => c[k] ? `<tr><td>${GN[k]}</td><td>${c[k].cagr_by_third.map((v) => v == null ? "–" : (v > 0 ? "+" : "") + fmt(v, 1)).join(" · ")}</td><td class="mono">${fmt(c[k].rho_lst_cagr, 2)}</td></tr>` : "";
      $("#heatTxt").innerHTML = `<p class="hint">Median yearly change 2022–26 (%) in the cooler · middle · hottest third of zones by summer surface temperature, and the rank correlation ρ between heat and that change.</p>
        <table class="gtab heat"><tr><th></th><th>cool · mid · hot</th><th>ρ</th></tr>${line("W")}${line("M")}${line("G")}</table>
        <p class="hint">Hotter zones are mostly the dense, central and commercial ones, so this mixes heat with location and building type. It describes a pattern, not a cause — which is why heat enters the scenarios only as an optional what-if.</p>`;
    } else $("#heatBlock").hidden = true;
    $("#dq").innerHTML = `${fmt(S.records)} value records on ${fmt(S.zones)} zone polygons (${S.two_records} polygons carry two records and are averaged). A 2022 value could be matched for ${fmt(S.with_2022)} zones, a 2024 value for ${fmt(S.with_2024)}. Symbolic values below 1 €/m² (public land) are excluded from growth statistics.`;
    const items = [["data/zones_scenarios.gpkg.zip", "Zones & scenarios · GeoPackage"], ["data/zones_scenarios.csv.zip", "Zones & scenarios · CSV"]];
    if (HEAT) items.push(["data/lst_summer_frankfurt.tif", "Surface temperature · GeoTIFF"]);
    $("#downloads").innerHTML = `<span>Open the data in QGIS or Excel:</span>` + items.map(([u, t]) => `<a href="${u}" download>${t}</a>`).join("");
  }

  function play() {
    const seq = [2022, 2024, 2026, 2028, 2030, 2035]; let k = 0;
    $("#playBtn").textContent = "■ Stop"; $("#playBtn").classList.add("on");
    const step = () => { state.year = seq[k]; render(); k++; if (k >= seq.length) { stop(); return; } playing = setTimeout(step, 1300); };
    step();
  }
  function stop() { if (playing) clearTimeout(playing); playing = null; $("#playBtn").textContent = "▶ Play 2022–2035"; $("#playBtn").classList.remove("on"); }

  // ------------------------------------------------------------------ fan chart
  function fan() {
    const k = state.grp === "all" ? "W" : state.grp;
    const F = S.fan[k]; $("#fanName").textContent = GN[k];
    const svg = $("#fan");
    if (!F) { svg.innerHTML = ""; $("#fanHint").textContent = "Too few zones with values."; return; }
    const W = 330, H = 190, L = 34, R = 10, T = 10, B = 24;
    const ys = [2022, 2024, 2026, ...F.years];
    const pts = { hist: [[2022, F.hist["2022"]], [2024, F.hist["2024"]], [2026, 100]].filter((d) => d[1] != null) };
    const q = F.q;  // [p10,p25,p50,p75,p90] × years
    const all = [...q.flat(), ...pts.hist.map((d) => d[1]), 100];
    const med = S.groups[k].r22_med / 100;
    const m3 = [2026, ...F.years].map((y) => [y, 100 * Math.pow(1 + med, y - 2026)]);
    const m2 = [2026, ...F.years].map((y) => [y, 100 * Math.pow(1 + med / 2, y - 2026)]);
    all.push(...m3.map((d) => d[1]));
    const lo = Math.floor(Math.min(...all) / 10) * 10, hi = Math.ceil(Math.max(...all) / 10) * 10;
    const x = (y) => L + (y - 2022) / 13 * (W - L - R), y = (v) => T + (hi - v) / (hi - lo) * (H - T - B);
    const area = (a, b) => "M" + x(2026) + "," + y(100) + F.years.map((yy, i) => "L" + x(yy) + "," + y(q[b][i])).join("") +
      F.years.slice().reverse().map((yy, i) => "L" + x(yy) + "," + y(q[a][F.years.length - 1 - i])).join("") + "Z";
    const line = (s) => s.map((d, i) => (i ? "L" : "M") + x(d[0]).toFixed(1) + "," + y(d[1]).toFixed(1)).join("");
    let g = "";
    for (let v = lo; v <= hi; v += (hi - lo > 60 ? 20 : 10)) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${v}</text>`;
    svg.innerHTML = g + `<path d="${area(0, 4)}" fill="#8a7fb8" opacity=".18"/><path d="${area(1, 3)}" fill="#8a7fb8" opacity=".28"/>
      <path d="${line([[2026, 100], ...F.years.map((yy, i) => [yy, q[2][i]])])}" fill="none" stroke="#5d4f99" stroke-width="2"/>
      <path d="${line([[2026, 100], [2035, 100]])}" fill="none" stroke="#9b958a" stroke-dasharray="4 3"/>
      <path d="${line(m2)}" fill="none" stroke="#d98a3d" stroke-width="1.5"/><path d="${line(m3)}" fill="none" stroke="#b33a3a" stroke-width="1.5"/>
      <path d="${line(pts.hist)}" fill="none" stroke="#2b2925" stroke-width="2.4"/>${pts.hist.map((d) => `<circle cx="${x(d[0])}" cy="${y(d[1])}" r="3" fill="#2b2925"/>`).join("")}
      <line x1="${x(state.year)}" x2="${x(state.year)}" y1="${T}" y2="${H - B}" stroke="var(--accent)" stroke-width="1.5"/>
      ${[2022, 2026, 2030, 2035].map((yy) => `<text x="${x(yy)}" y="${H - 6}" text-anchor="middle">${yy}</text>`).join("")}`;
    const last = (i) => fmt(q[i][q[i].length - 1], 0);
    $("#fanHint").innerHTML = `Index 2026 = 100, median ${GN[k].toLowerCase()} zone. <b style="color:#2b2925">Black</b>: official values. <b style="color:#5d4f99">Purple</b>: simulation median with 50 % and 80 % bands — 2035: ${last(2)} (P10 ${last(0)} – P90 ${last(4)}). Dashed M1, <span style="color:#d98a3d">orange M2</span>, <span style="color:#b33a3a">red M3</span> at the group's median trend (${pct(med, 1)}/yr).`;
  }

  // ------------------------------------------------------------------ legend
  function legend() {
    const L = $("#legend");
    const title = `${state.year}${future() ? " · " + MN[state.model] + (state.model === "sim" ? " P" + state.p : "") : " · official"}`;
    let h = "";
    if (state.col === "zuse") {
      h = `<div class="lg-title">Land use of the BORIS zone</div><div class="lg-sub">${state.view === "3d" ? "buildings coloured by the zone they stand in" : "zones"}</div>` +
        Object.entries(UC).map(([k, c]) => `<div class="lg-row"><i class="sq" style="background:${c}"></i>${GN[k]}<small>${fmt(S.groups[k].n)} zones${S.buildings && S.buildings.by_zone_use[k] ? " · " + fmt(S.buildings.by_zone_use[k].n) + " buildings, median " + fmt(S.buildings.by_zone_use[k].h_median, 0) + " m" : ""}</small></div>`).join("");
    } else if (state.col === "buse") {
      h = `<div class="lg-title">Building use (cadastre)</div><div class="lg-sub">${state.view === "3d" ? "LoD2 buildings at measured height" : "switch to 3D buildings to see them"}</div>` +
        Object.entries(BC).map(([k, c]) => `<div class="lg-row"><i class="sq" style="background:${c}"></i>${BN[k]}<small>${S.buildings && S.buildings.by_cat[k] ? fmt(S.buildings.by_cat[k]) : ""}</small></div>`).join("");
    } else if (state.col === "change" && state.year !== 2022) {
      h = `<div class="lg-title">Change ${future() ? "2026 → " + state.year : "2022 → " + state.year}</div><div class="lg-sub">${title}${state.grp !== "all" ? " · " + GN[state.grp] : ""}</div>
        <div class="lg-bar" style="background:linear-gradient(90deg,${CC.join(",")})"></div><div class="lg-ticks"><span>−30 %</span><span>−5</span><span>0</span><span>+5</span><span>+30 %</span></div>`;
    } else {
      h = `<div class="lg-title">Land reference value, €/m²</div><div class="lg-sub">${title}${state.grp !== "all" ? " · " + GN[state.grp] : ""}</div>
        <div class="vsteps">${VC.map((c, i) => `<i style="background:${c}"></i>`).join("")}</div>
        <div class="vticks">${["", ...VB].map((b) => `<span>${b === "" ? "" : b >= 1000 ? b / 1000 + "k" : b}</span>`).join("")}</div>`;
    }
    if (state.col === "value" || state.col === "change") h += `<div class="lg-row"><i class="sq" style="background:${NA}"></i>no value / not computed for this scenario</div>`;
    if (state.view === "3d") h += `<div class="hint lg-note">3D: ${S.buildings ? fmt(S.buildings.n) + " " : ""}LoD2 buildings at their measured height. ${state.col === "value" || state.col === "change" ? "Each building shows the land value of the zone it stands in — land, not the building." : ""} Zoom in to street level.</div>`;
    if (state.heat && HEAT) h += `<div class="lg-sel"><div class="lg-title" style="font-size:12px">Summer surface temperature</div><div class="lg-bar" style="background:linear-gradient(90deg,${HEAT.scale.stops.map(([t, c]) => `${c} ${t * 100}%`).join(",")})"></div><div class="lg-ticks"><span>${fmt(HEAT.scale.lo, 0)} °C</span><span>${fmt(HEAT.scale.hi, 0)} °C</span></div></div>`;
    L.innerHTML = h;
  }
})();
