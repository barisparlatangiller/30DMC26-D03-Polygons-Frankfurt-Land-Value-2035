# Frankfurt 2035 · Land Value Dynamics & Scenario Explorer

**#30DayMapChallenge 2026 · Day 3 · Polygons**

**How did Frankfurt's official land reference values (Bodenrichtwerte) change between 2022, 2024 and 2026, for each land use? And what could they look like in 2028, 2030 and 2035 under transparent what-if assumptions?**

🌍 **Live map:** https://barisparlatangiller.github.io/30DMC26-D03-Polygons-Frankfurt-Land-Value-2035/

Every polygon on the map is a 2026 BORIS valuation zone in Frankfurt am Main (1,466 polygons, 1,508 value records).

The map lets you:
- choose a year: 2022 / 2024 / 2026 (official), or 2028 / 2030 / 2035 (scenario)
- choose a land use: residential, mixed, commercial, other, or all
- choose a scenario model (M1–M4 or the simulation)
- colour zones by value or by change
- switch between a flat map and **3D buildings**: every LoD2 building in Frankfurt at its measured height, coloured by the land use, land value or scenario of the BORIS zone it stands in, or by its own use from the cadastre
- add a summer **heat** layer
- click a zone to see its values, its growth rates, every scenario and the simulation range

## Scenarios

`BRW_year = BRW_2026 × (1 + r)^(year − 2026)`

| Model | Yearly rate r | Meaning |
|---|---|---|
| M1 · Stagnation | 0 | reference line, values stay at 2026 |
| M2 · Dampened trend | ½ × CAGR 2022–26 | half of the past yearly change continues |
| M3 · Trend continues | CAGR 2022–26 | the past yearly change continues |
| M4 · User rate | slider −6 … +8 %/yr | sensitivity test |
| Simulation | Monte Carlo, 1,000 runs | P10 / P50 / P90 range |

- **Growth rates:** `CAGR_22_26 = (BRW2026 / BRW2022)^(1/4) − 1` and `CAGR_24_26 = (BRW2026 / BRW2024)^(1/2) − 1`.
- **Where M2 and M3 apply:** only to zones with a matched 2022 value. Zones without one stay grey; no scenario is built on a missing historical match.
- **Simulation:**
  - Yearly growth = μ + δ + σ·(0.5·z_year + 0.7·ε_zone,year).
  - μ is half the zone's own CAGR plus half the median CAGR of its land-use group.
  - δ ~ N(0, 2.5 %/yr) is drawn once per run and group. It stands for the uncertainty of the trend itself.
  - σ is the robust spread (1.4826 × MAD) of zone CAGRs in the group.
  - The seed is fixed (2026), so every build gives the same result.
- **Heat what-if:** each zone gets its mean summer land-surface temperature: Landsat 8/9, clear scenes in June–August 2022–2025, see `pipeline/build_heat.py`. An optional slider then adds or removes growth in the hottest third of zones. This is a sensitivity test, not a causal claim.

**These are what-if calculations with stated assumptions, not forecasts.** A Bodenrichtwert is an official reference value for a zone, not a transaction price.

## Research basis

The spatial approach, with BORIS value zones as the unit of analysis, is informed by the following work:

- **Siedentop, S. & Schartmann, M. (2025).** Reurbanization and spatially polarized land markets. *Raumforschung und Raumordnung | Spatial Research and Planning* 83(4). https://doi.org/10.14512/rur.2975
  Land-value change in North Rhine-Westphalia, based on BORIS data.
- **Kolbe, J., Schulz, R., Wersing, M. & Werwatz, A. (2019).** Bodenwertermittlung mit statistischen Methoden. *Zeitschrift für Immobilienökonomie* 5(1). https://doi.org/10.1365/s41056-019-00038-9
  Statistical land valuation. It shows how simple trend extrapolation differs from valuation models.
- **Fitzgerald, M., Hansen, D. J., McIntosh, W. & Slade, B. A. (2020).** Urban land: price indices, performance, and leading indicators. *Journal of Real Estate Finance and Economics*. https://doi.org/10.1007/s11146-019-09696-x
  Land prices are volatile, which is a reason not to extrapolate one trend with confidence.

None of these studies validates the M1–M4 coefficients; they are transparent assumptions of this project.

## Data quality and limits

- **How 2022 and 2024 are matched:** by zone number and land-use code to the 2026 zones. The 2022/2024 BORIS exports are attribute tables, so boundary changes between years are **not verified**.
- **Coverage:** a growth rate 2022–26 can be computed for 820 zones (2024–26: 1,321) (see `stats.json`).
- **Two value records:** 42 polygons carry two records; they are averaged, and both values are shown in the popup.
- **Symbolic values:** values below 1 €/m² (0.01 €/m² on public land) are excluded from growth statistics.
- **Heat:** land-surface temperature is the temperature of surfaces around 10:30 on clear days, not air temperature. Hot zones are mostly dense and central, so heat and location overlap.

## 3D buildings

The 3D view uses the official **3D-Gebäudemodelle LoD2** of Hessen (HVBG, Geodaten online, Kreisfreie Stadt Frankfurt). `pipeline/lod2_to_buildings.py` reads each building and building part from the CityGML: its footprint (GroundSurface), its measured height and its ALKIS building function. `pipeline/build_buildings.py` then gives every footprint the BORIS zone it stands in and writes vector tiles. The colours show **land** values of the zone, not the value of the building.

## Build

```bash
pip install -r requirements.txt
python pipeline/build_heat.py     # Landsat LST → input/lst_summer.tif, docs/data/heat.png
python pipeline/build_zones.py    # zones, CAGR, simulation, heat per zone → docs/data
python pipeline/fetch_lod2.py     # HVBG LoD2 package for Frankfurt (~0.5 GB)
python pipeline/lod2_to_buildings.py && python pipeline/build_buildings.py   # needs tippecanoe
```

The GitHub Action (`.github/workflows/build-and-deploy.yml`) runs both steps and publishes `docs/` to GitHub Pages. It also writes the result files (GeoPackage, CSV, GeoTIFF) to the `data` branch.

## Data & licences

- **Bodenrichtwerte 2022 / 2024 / 2026**
  - Source: © Hessisches Landesamt für Bodenmanagement und Geoinformation (HVBG) / Gutachterausschuss für Immobilienwerte Frankfurt am Main, BORIS Hessen.
  - Licence: [dl-de/zero-2-0](https://www.govdata.de/dl-de/zero-2-0).
  - Files: `data/` holds the Frankfurt extract and the original 2026 XML.
- **3D-Gebäudemodelle LoD2:** © Hessische Verwaltung für Bodenmanagement und Geoinformation (HVBG), free download via Geodaten online.
- **Landsat 8/9 Collection 2 Level-2:** courtesy of the U.S. Geological Survey (public domain), via the Microsoft Planetary Computer.
- **Basemap:** © CARTO, © OpenStreetMap contributors.

Code: MIT. Barış Parlatangiller, built with AI assistance (Claude, Anthropic).
