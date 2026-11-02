"""
3D buildings for the web map: every LoD2 footprint gets the BORIS zone it stands in, so the map can colour real
buildings by the zone's land use, its official value, its change and any scenario — and extrude them to their
measured height.

Input   input/frankfurt_lod2.parquet  (lod2_to_buildings.py) · docs/data/zones.geojson (build_zones.py)
Output  docs/data/buildings.pmtiles   layer "b" (tippecanoe) · stats.json["buildings"]

  python pipeline/build_buildings.py
"""
import argparse, json, subprocess, tempfile
from pathlib import Path

import numpy as np
import pandas as pd
import geopandas as gpd
from shapely.geometry import mapping

ZONE_KEYS = ["i", "g", "u", "v22", "v24", "v26", "r22", "hot", "s2810", "s2850", "s2890", "s3010", "s3050", "s3090",
             "s3510", "s3550", "s3590"]


def category(fn):
    """ALKIS building function (Gebäudefunktion, e.g. 31001_1000) → simple use class"""
    if not isinstance(fn, str) or "_" not in fn:
        return "oth"
    kind, code = fn.split("_", 1)
    try:
        c = int(code)
    except ValueError:
        return "oth"
    if kind != "31001":
        return "oth"                       # 51009 etc.: other structures, not buildings in the narrow sense
    if 1000 <= c < 2000:
        return "res"                       # residential incl. residential with shops/offices
    if 2000 <= c < 2100:
        return "com"                       # trade, services, offices
    if 2400 <= c < 2500:
        return "gar"                       # garages, parking, transport
    if 2100 <= c < 3000:
        return "ind"                       # production, industry, utilities, agriculture
    if 3000 <= c < 4000:
        return "pub"                       # public, education, health, culture, religion
    return "oth"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--buildings", default="input/frankfurt_lod2.parquet")
    ap.add_argument("--zones", default="docs/data/zones.geojson")
    ap.add_argument("--out", default="docs/data")
    a = ap.parse_args()
    out = Path(a.out)

    b = gpd.read_parquet(a.buildings).to_crs(25832)
    b = b[b.h.notna() & (b.h > 0)].reset_index(drop=True)
    b["h"] = b.h.clip(1, 260).round(1)
    b["cat"] = b.fn.map(category)
    z = gpd.read_file(a.zones).to_crs(25832)
    for k in ZONE_KEYS:
        if k not in z:
            z[k] = np.nan

    pts = gpd.GeoDataFrame(geometry=b.geometry.representative_point(), crs=25832)
    j = gpd.sjoin(pts, z[["i", "geometry"]], how="left", predicate="within")
    j = j[~j.index.duplicated()]
    miss = j.i.isna()
    if miss.any():                                                        # point just outside every zone (gaps, roads)
        n = gpd.sjoin_nearest(pts[miss], z[["i", "geometry"]], how="left", max_distance=30)
        n = n[~n.index.duplicated()]
        j.loc[n.index, "i"] = n.i
    b["zi"] = pd.array(j.i.values, dtype="Int64")
    z["i"] = z.i.astype(int)
    zp = z.drop(columns="geometry").set_index("i")
    print(f"Buildings: {len(b):,} footprints · in a BORIS zone: {b.zi.notna().sum():,}")

    b4 = b.to_crs(4326)
    with tempfile.TemporaryDirectory() as td:
        seq = Path(td) / "b.geojsonl"
        with open(seq, "w") as f:
            for r in b4.itertuples():
                p = {"h": float(r.h), "c": r.cat}
                if isinstance(r.fn, str): p["fn"] = r.fn.split("_")[-1]
                if pd.notna(r.zi):
                    zr = zp.loc[r.zi]
                    p["zi"] = int(r.zi)
                    for k in ZONE_KEYS[1:]:
                        v = zr.get(k)
                        if v is not None and not (isinstance(v, float) and np.isnan(v)):
                            p[k] = v if isinstance(v, str) else (round(float(v), 5) if k == "r22" else round(float(v), 1))
                f.write(json.dumps({"type": "Feature", "properties": p, "geometry": mapping(r.geometry)},
                                   separators=(",", ":")) + "\n")
        target = out / "buildings.pmtiles"
        cmd = ["tippecanoe", "-o", str(target), "--force", "-l", "b", "-Z", "12", "-z", "16",
               "--drop-smallest-as-needed", "--coalesce-densest-as-needed", "--extend-zooms-if-still-dropping",
               "--simplification=2", "-P", str(seq)]
        print(" ".join(cmd), flush=True)
        subprocess.run(cmd, check=True)
    print(f"buildings.pmtiles: {target.stat().st_size / 1e6:.1f} MB")

    # stats: buildings and heights per land use of the zone
    s = json.load(open(out / "stats.json", encoding="utf-8"))
    bb = b.join(zp[["g"]], on="zi")
    s["buildings"] = {
        "n": int(len(b)), "in_zone": int(b.zi.notna().sum()), "h_median": round(float(b.h.median()), 1),
        "by_zone_use": {k: {"n": int((bb.g == k).sum()), "h_median": round(float(bb.loc[bb.g == k, "h"].median()), 1) if (bb.g == k).any() else None,
                            "h_p90": round(float(bb.loc[bb.g == k, "h"].quantile(.9)), 1) if (bb.g == k).any() else None}
                        for k in ["W", "M", "G", "O"]},
        "by_cat": {k: int(v) for k, v in b.cat.value_counts().items()},
        "tallest": [{"h": float(r.h), "zone_use": zp.loc[r.zi, "u"] if pd.notna(r.zi) else None}
                    for r in b.sort_values("h", ascending=False).drop_duplicates("oid").head(5).itertuples()],
    }
    json.dump(s, open(out / "stats.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps(s["buildings"], indent=1))


if __name__ == "__main__":
    main()
