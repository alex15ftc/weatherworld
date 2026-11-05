# Reference shots (since 2026-10-31)

Every supercell-body change is judged in these fixed shots, against the same photo each round.
Judge the whole picture first: shape and proportion, light, sky. Fix local artefacts after that.

| Key | Shot | Scene id | Camera | Compare with (docs/storm-reference/real/) |
|---|---|---|---|---|
| P1 | Classic supercell, 15 km, inflow side | `shot_classic` | 15 km SE, aim base + 600 m | `12_mesocyclone_striations_c.jpg`, `01_classic_supercell_a.jpg` |
| P2 | Wall cloud, occluding | `wall_cloud` | 4.5 km | `04_wall_cloud_a.jpg` |
| P3 | Under the base | `shot_under` | 2.5 km SE, aim base + 500 m | `04_wall_cloud_underside_c.jpg` |
| P4 | HP supercell | `shot_hp` | 10 km SE | `03_hp_supercell_b.jpg` |
| P5 | LP / mothership | `mothership` | 14 km | `02_lp_supercell_b.jpg` |
| SC | Supercell lifecycle, 2.5 h (key `'`) | `life_supercell` | 20 km SE, aim base + 3 km | `13_towering_cumulus_b` → `01_classic_supercell_a` → `07_shelf_cloud_a` |

## Running them

- Comma (or F7, which Studio usually takes) steps P1 → P5 → SC. The status line in the F4 panel names the photo.
- Apostrophe runs SC directly. Watch it at 60x (about 2.5 min). The server prints `[Life] life_supercell ...` every 60 sim seconds: W, Ru, top, anvil length, mesos, occlusion, RFD and rain.
- Press each key once and wait for `visual test ... built` before pressing again. The server now ignores a scene request while another is building (overlapping builds stalled it for about 40 s each).
- `\` turns the storm-owned sky on/off for A/B comparisons.
- Side by side: `python tools/shot_compare.py <photo> <capture.png> <out.png> [--crop x,y,w,h]`. It prints mean and p5/p50/p95 brightness and the share of blue sky in the top third, for both images.

## Captures on file (`shots/`)

- `P1_mesh_skyoff_2026-10-31.png`, `P1_mesh_skyon_anvil_2026-10-31.png`: P1 with the mesh body, before and after the matured anvil.
- `SC_20min_mesh.png`, `SC_45min_mesh.png`, `SC_100min_mesh.png`: the lifecycle with the mesh body.
- `SC_120min_cards.png`: the same storm with cards only (key F twice).
- `engine_storms_overhead_skyon.png`: under the engine storms with the storm-owned sky on.

## First findings (2026-10-31)

1. The mesh body (Round 15) causes the dark look. At every stage the tower is a dark rock, even sunlit in mid-afternoon, with a sharp blade-shaped top while growing, and the anvil is a near-black flat slab. Cards only, the same storm reads as a soft grey-white cumulonimbus with a spreading anvil: too flat and featureless, but the right kind of object.
2. The base is a small disc from the towering-cumulus stage onward: a dark "UFO" with the mesh, a pale disc with cards. Real bases (rain-free base + forward flank) are 20–30 km across and low and wide in the frame.
3. Sky: from P1 (15 km on the inflow side) the storm covers about 23% of the dome with the matured anvil (9% before). The open sky is still blue, as it would be beside a storm of this size. The photos are more overcast because the real cloud is bigger (point 2). Under the engine storms the new sky goes grey as intended.
