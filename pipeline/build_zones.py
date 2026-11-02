"""
Day 3 · Polygons · Frankfurt 2035 — Land Value Dynamics & Scenario Explorer.

Input  data/Frankfurt_BORIS_2022_2024_2026_WERTE_POLYGON.gpkg  (layer brw_2026_zonen_mit_werten)
         2026 BORIS zones (polygons) with 2022/2024 values matched on zone number + land-use code (attribute match,
         not a spatial match: historical zone boundaries are not verified)
       data/BORIS-2026_Stadt_Frankfurt_1.XML.zip  (optional, for the reference floor-area ratio and remarks)
       input/lst_summer.tif                        (optional, from build_heat.py)

What it computes per zone
  CAGR_22_26 = (BRW2026/BRW2022)^(1/4) − 1,  CAGR_24_26 = (BRW2026/BRW2024)^(1/2) − 1
  Scenarios (in the browser, from these numbers):  BRW_year = BRW2026 × (1 + r)^(year − 2026)
     M1 stagnation r = 0 · M2 dampened trend r = 0.5 × CAGR_22_26 · M3 trend continuation r = CAGR_22_26 · M4 user rate
     M2/M3 only where a 2022 value was matched (the project brief: no scenario on an invalid historical match)
  Simulation (Monte Carlo, 1,000 runs, fixed seed): yearly growth = μ + δ + σ·(0.5·z_year + 0.7·ε_zone,year)
     μ = ½ zone CAGR (2022–26, else 2024–26) + ½ median CAGR of its land-use group  (partial pooling)
     δ ~ N(0, 2.5 %/yr) per run and group: the trend itself is uncertain (2022–26 is one short, falling period)
     σ = robust spread (1.4826 × MAD) of zone CAGRs in the group, at least 1 %/yr
     → P10 / P50 / P90 per zone for 2028, 2030, 2035, and a fan chart per land-use group.
  Heat: mean summer land-surface temperature per zone (Landsat), heat thirds over all built-up zones.

These are what-if calculations, not forecasts. Bodenrichtwerte are reference values, not transaction prices.
"""
import argparse, io, json, re, zipfile, tempfile
from pathlib import Path

import numpy as np
import pandas as pd
import geopandas as gpd

GROUPS = {"W": "Residential", "M": "Mixed use", "G": "Commercial", "O": "Other (public, gardens, farmland, forest)"}
YEARS = [2028, 2030, 2035]
N_SIM, SEED = 1000, 2026
TAU = 0.025          # 1σ uncertainty of the long-run trend itself (%/yr), drawn once per run and land-use group


def gfz_from_xml(path):
    """reference floor-area ratio and remarks per value record (gml:id of BR_Bodenrichtwert)"""
    if not Path(path).exists():
        return pd.DataFrame(columns=["gml_id_wert", "gfz", "remark"])
    z = zipfile.ZipFile(path)
    name = [n for n in z.namelist() if n.lower().endswith(".xml") and not n.startswith("__")][0]
    s = z.read(name).decode("utf-8", errors="replace")
    rows = []
    for m in re.finditer(r'<br:BR_Bodenrichtwert gml:id="([^"]+)">(.*?)</br:BR_Bodenrichtwert>', s, re.S):
        body = m.group(2)
        g = re.search(r"<br:wertrelevanteGeschossflaechenzahl>([^<]+)<", body)
        b = re.search(r"<br:bemerkungen>([^<]+)<", body)
        rows.append({"gml_id_wert": m.group(1), "gfz": float(g.group(1)) if g else np.nan,
                     "remark": b.group(1).strip()[:200] if b else ""})
    return pd.DataFrame(rows)


def cagr(a, b, years):
    with np.errstate(divide="ignore", invalid="ignore"):
        r = np.where((a > 0) & (b > 0), (b / a) ** (1 / years) - 1, np.nan)
    return r


def zonal_lst(z, path):
    import rasterio
    from rasterio.features import rasterize
    with rasterio.open(path) as src:
        arr = src.read(1).astype("float32")
        geoms = z.to_crs(src.crs).geometry.values
        ids = rasterize(((g, i + 1) for i, g in enumerate(geoms)), out_shape=arr.shape, transform=src.transform,
                        fill=0, dtype="int32", all_touched=False)
        ok = (ids > 0) & np.isfinite(arr)
        s = pd.Series(arr[ok]).groupby(ids[ok]).mean()
        out = s.reindex(np.arange(1, len(geoms) + 1)).to_numpy(dtype="float64", copy=True)
        # small zones without a pixel centre: value at the representative point
        miss = np.isnan(out)
        if miss.any():
            pts = z.to_crs(src.crs).geometry.representative_point().values[miss]
            vals = [v[0] for v in src.sample([(p.x, p.y) for p in pts])]
            out[miss] = vals
    out[~np.isfinite(out)] = np.nan
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--gpkg", default="data/Frankfurt_BORIS_2022_2024_2026_WERTE_POLYGON.gpkg")
    ap.add_argument("--xml", default="data/BORIS-2026_Stadt_Frankfurt_1.XML.zip")
    ap.add_argument("--lst", default="input/lst_summer.tif")
    ap.add_argument("--out", default="docs/data")
    a = ap.parse_args()
    out = Path(a.out); out.mkdir(parents=True, exist_ok=True)

    g = gpd.read_file(a.gpkg, layer="brw_2026_zonen_mit_werten").to_crs(25832)
    print(f"Value records: {len(g):,}")
    g = g.merge(gfz_from_xml(a.xml), on="gml_id_wert", how="left")

    # ------------------------------------------------ one feature per polygon (42 polygons carry two records)
    g["n_rec"] = g.groupby("gml_id").gml_id.transform("size")
    agg = g.groupby("gml_id").agg(
        zone=("zone_nummer", lambda v: " / ".join(sorted(set(str(x) for x in v)))),
        use=("nutz_2026", "first"), use_long=("nutzung_2026", "first"), dev=("entwickl_2026", "first"),
        v22=("brw_2022", "mean"), v24=("brw_2024", "mean"), v26=("brw_2026", "mean"),
        v22_all=("brw_2022", lambda v: "/".join(f"{x:g}" for x in v if pd.notna(x))),
        v24_all=("brw_2024", lambda v: "/".join(f"{x:g}" for x in v if pd.notna(x))),
        v26_all=("brw_2026", lambda v: "/".join(f"{x:g}" for x in v if pd.notna(x))),
        gfz=("gfz", lambda v: "/".join(f"{x:g}" for x in v if pd.notna(x))),
        remark=("remark", lambda v: " | ".join(sorted(set(x for x in v if isinstance(x, str) and x)))),
        n_rec=("n_rec", "first"), m22=("match_2022", "min"), m24=("match_2024", "min"))
    geom = g.drop_duplicates("gml_id").set_index("gml_id").geometry
    z = gpd.GeoDataFrame(agg.join(geom), geometry="geometry", crs=25832).reset_index()
    z["grp"] = np.where(z.use.isin(["W", "M", "G"]), z.use, "O")
    z["area_ha"] = z.area / 1e4
    print(f"Polygons: {len(z):,} ({(z.n_rec > 1).sum()} with two value records — averaged, both shown in the popup)")

    # values below 1 €/m² are symbolic (public land, 0.01 €/m²) → no growth statistics
    for c in ["v22", "v24", "v26"]:
        z.loc[z[c] < 1, c] = np.nan
    z["r22"] = cagr(z.v22, z.v26, 4)
    z["r24"] = cagr(z.v24, z.v26, 2)
    z["r"] = z.r22                                          # M2 / M3 basis (needs a matched 2022 value)

    # ------------------------------------------------ heat
    hstats = None
    if Path(a.lst).exists():
        z["lst"] = zonal_lst(z, a.lst)
        built = z.grp.isin(["W", "M", "G"]) & z.lst.notna()
        q = np.nanquantile(z.loc[built, "lst"], [1 / 3, 2 / 3])
        z["hot"] = np.where(z.lst.isna(), -1, np.digitize(z.lst, q))
        from scipy.stats import spearmanr
        corr = {}
        for grp in ["W", "M", "G"]:
            s = z[(z.grp == grp) & z.lst.notna() & z.r22.notna()]
            if len(s) > 20:
                rho, p = spearmanr(s.lst, s.r22)
                v = z[(z.grp == grp) & z.lst.notna() & z.v26.notna()]
                rho2, p2 = spearmanr(v.lst, v.v26)
                corr[grp] = {"n": int(len(s)), "rho_lst_cagr": round(float(rho), 3), "p": float(f"{p:.3g}"),
                             "rho_lst_value": round(float(rho2), 3), "p_value": float(f"{p2:.3g}"),
                             "cagr_by_third": [round(float(s[s.hot == k].r22.median() * 100), 2) if (s.hot == k).any() else None for k in range(3)],
                             "value_by_third": [round(float(v[v.hot == k].v26.median()), 0) if (v.hot == k).any() else None for k in range(3)]}
        hstats = {"terciles": [round(float(x), 2) for x in q], "corr": corr,
                  "min": round(float(np.nanmin(z.lst)), 1), "max": round(float(np.nanmax(z.lst)), 1)}
        print("Heat:", json.dumps(hstats))
    else:
        z["lst"] = np.nan; z["hot"] = -1
        print("No LST raster — heat skipped")

    # ------------------------------------------------ Monte Carlo simulation
    rng = np.random.default_rng(SEED)
    med_g = z.groupby("grp").r22.median()
    sig_g = z.groupby("grp").r22.apply(lambda v: max(0.01, 1.4826 * np.nanmedian(np.abs(v - np.nanmedian(v)))))
    base = z.r22.fillna(z.r24)
    mu = np.where(base.notna(), 0.5 * base + 0.5 * z.grp.map(med_g), z.grp.map(med_g))
    mu = np.where(np.isnan(mu), 0.0, mu)
    sig = z.grp.map(sig_g).fillna(0.01).values
    ok = z.v26.notna().values
    H = 2035 - 2026
    groups = z.grp.values
    # common shock per group and year, idiosyncratic per zone and year
    common = {k: rng.standard_normal((N_SIM, H), dtype=np.float32) for k in GROUPS}
    drift = {k: (TAU * rng.standard_normal(N_SIM)).astype(np.float32) for k in GROUPS}
    dz = np.stack([drift[k] for k in groups], axis=1)                         # N_SIM × zones
    zc = np.stack([common[k] for k in groups], axis=1)                       # N_SIM × zones × H
    eps = rng.standard_normal((N_SIM, len(z), H), dtype=np.float32)
    growth = (mu[None, :, None] + dz[:, :, None] + sig[None, :, None] * (0.5 * zc + 0.7 * eps)).astype(np.float32)
    del eps, zc
    path = np.cumprod(1 + growth, axis=2)                                    # index vs 2026, years 2027..2035
    for y in YEARS:
        vals = path[:, :, y - 2027] * z.v26.values[None, :]
        q = np.nanpercentile(vals, [10, 50, 90], axis=0)
        for j, p in enumerate(["p10", "p50", "p90"]):
            z[f"s{y % 100}_{p}"] = np.where(ok, q[j], np.nan)
    # fan chart per group: median zone index across the group, per run
    fan = {}
    for k in GROUPS:
        m = (groups == k) & ok
        if m.sum() < 5:
            continue
        idx = np.nanmedian(path[:, m, :], axis=1)                           # N_SIM × H
        qs = np.percentile(idx, [10, 25, 50, 75, 90], axis=0)
        hist = {}
        for yy, col in [(2022, "v22"), (2024, "v24")]:
            s = z.loc[m & z[col].notna()]
            hist[yy] = round(float(np.median(s[col] / s.v26)) * 100, 1) if len(s) else None
        fan[k] = {"years": list(range(2027, 2036)), "q": (np.round(qs * 100, 1)).tolist(), "hist": hist,
                  "n": int(m.sum()), "mu": round(float(np.nanmedian(mu[m]) * 100), 2), "sigma": round(float(sig_g.get(k, 0.01) * 100), 2)}
    print("Fan medians 2035:", {k: v["q"][2][-1] for k, v in fan.items()})

    # ------------------------------------------------ stats
    def gstat(s):
        return {"n": int(len(s)), "v22": float(s.v22.median()) if s.v22.notna().any() else None,
                "v24": float(s.v24.median()) if s.v24.notna().any() else None,
                "v26": float(s.v26.median()) if s.v26.notna().any() else None,
                "n22": int(s.r22.notna().sum()), "r22_med": round(float(s.r22.median() * 100), 2) if s.r22.notna().any() else None,
                "r24_med": round(float(s.r24.median() * 100), 2) if s.r24.notna().any() else None,
                "pct22_26_med": round(float(((s.v26 / s.v22) - 1).median() * 100), 1) if s.r22.notna().any() else None,
                "share_down": round(float((s.r22 < 0).mean() * 100), 1) if s.r22.notna().any() else None,
                "share_up": round(float((s.r22 > 0).mean() * 100), 1) if s.r22.notna().any() else None,
                "area_ha": round(float(s.area_ha.sum()), 0)}
    stats = {"tau": TAU, "zones": int(len(z)), "records": int(len(g)), "two_records": int((z.n_rec > 1).sum()),
             "with_2022": int(z.r22.notna().sum()), "with_2024": int(z.r24.notna().sum()),
             "groups": {k: gstat(z[z.grp == k]) for k in GROUPS}, "group_names": GROUPS,
             "fan": fan, "heat": hstats, "sim": {"runs": N_SIM, "seed": SEED},
             "use_counts": z.use_long.value_counts().to_dict()}
    W = z[(z.grp == "W") & z.r22.notna()]
    stats["w_falls"] = {"le_minus20": int((W.v26 / W.v22 - 1 <= -0.2).sum()), "n": int(len(W))}
    json.dump(stats, open(out / "stats.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    # ------------------------------------------------ web layer
    w = z.to_crs(4326).copy()
    w["geometry"] = w.geometry.simplify(0.000008, preserve_topology=True)
    feats = []
    r3 = lambda v, d=1: None if pd.isna(v) else round(float(v), d)
    for i, r in enumerate(w.itertuples()):
        p = {"i": i, "z": r.zone, "u": r.use, "ul": r.use_long, "g": r.grp, "d": int(r.dev) if pd.notna(r.dev) else None,
             "v22": r3(r.v22), "v24": r3(r.v24), "v26": r3(r.v26), "r22": r3(r.r22, 5), "r24": r3(r.r24, 5),
             "lst": r3(r.lst), "hot": int(r.hot), "nr": int(r.n_rec), "a": r3(r.area_ha, 1)}
        if r.n_rec > 1:
            p["all"] = f"2022: {r.v22_all or '–'} · 2024: {r.v24_all or '–'} · 2026: {r.v26_all}"
        if r.gfz: p["gfz"] = r.gfz
        if r.remark: p["rm"] = r.remark
        for y in YEARS:
            for q in ["p10", "p50", "p90"]:
                p[f"s{y % 100}{q[1:]}"] = r3(getattr(r, f"s{y % 100}_{q}"), 0)
        p = {k: v for k, v in p.items() if v is not None}
        geom = json.loads(gpd.GeoSeries([r.geometry]).to_json())["features"][0]["geometry"]
        def rnd(c):
            return [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 6), round(c[1], 6)]
        geom["coordinates"] = rnd(geom["coordinates"])
        feats.append({"type": "Feature", "id": i, "properties": p, "geometry": geom})
    json.dump({"type": "FeatureCollection", "features": feats}, open(out / "zones.geojson", "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))

    # ------------------------------------------------ downloads
    cols = {"zone": "zone_nummer", "use": "nutz_2026", "use_long": "nutzung_2026", "grp": "use_group", "dev": "entwicklungszustand",
            "v22": "brw_2022", "v24": "brw_2024", "v26": "brw_2026", "r22": "cagr_22_26", "r24": "cagr_24_26",
            "gfz": "gfz_ref", "n_rec": "value_records", "lst": "lst_summer_c", "hot": "heat_third", "area_ha": "area_ha"}
    t = z[list(cols) + [c for c in z.columns if c.startswith("s") and "_p" in c] + ["geometry"]].rename(columns=cols)
    for y in YEARS:
        n = y - 2026
        t[f"m1_{y}"] = t.brw_2026
        t[f"m2_{y}"] = (t.brw_2026 * (1 + 0.5 * t.cagr_22_26) ** n).round(1)
        t[f"m3_{y}"] = (t.brw_2026 * (1 + t.cagr_22_26) ** n).round(1)
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "frankfurt_land_value_scenarios.gpkg"
        t.to_file(p, layer="zones", driver="GPKG")
        with zipfile.ZipFile(out / "zones_scenarios.gpkg.zip", "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(p, p.name)
    with zipfile.ZipFile(out / "zones_scenarios.csv.zip", "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("frankfurt_land_value_scenarios.csv", pd.DataFrame(t.drop(columns="geometry")).to_csv(index=False))
    print(json.dumps({k: stats[k] for k in ("zones", "records", "with_2022", "with_2024", "w_falls")}, indent=1))
    print(json.dumps(stats["groups"], indent=1))


if __name__ == "__main__":
    main()
