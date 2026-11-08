# Rain and hail shafts seen from 2-40 km (research, 2026-11-06)

This guides how the game draws precipitation shafts from engine frames (`roblox/src/cloudlab/shared/Model/RainView.luau`).
- **Physical facts** come from spotter guides, NSSL, chaser reports and optics papers, linked below.
- **Rendering advice** is inference from that physics. None of the game talks checked (Nubis, the Horizon Forbidden West superstorms talk, RDR2, Flight Simulator) explain their rain-shaft method in anything that could be read.

## Shape
- **Edges.** Precipitation shafts look "fuzzy or stringy" ([NWS Fort Worth spotter handout](https://www.weather.gov/media/fwd/skywarn/Spotter%20Handout%202022.pdf)). A heavy core has no hard edge: it thins through lighter rain.
- **Streaks.** Single drop streaks are only seen within tens of metres ([Garg & Nayar](https://www.cs.columbia.edu/CAVE/publications/pdfs/Garg_TR04.pdf)). With distance:
  - about 5 km: soft vertical texture and ragged edges;
  - about 15 km: a smooth veil with faint banding;
  - about 30 km: a uniform grey or blue-grey wedge.
- **Top.** The shaft comes out of the cloud base with no visible join, and its top never stands above the base. The rain-free updraft base beside it is flat and smooth ([spotterguides](https://www.spotterguides.us/advanced/advanced06.htm)).
- **Foot.** A rain foot is an outward bulge at the ground from wet-microburst outflow. Dry microbursts raise rings of blowing dust (same source).

## Opacity
- **Fit.** Lidar extinction is β ≈ 0.16 R^0.74 per km, with R in mm/h ([scilit summary](https://scilit.com/publications/387b97ca94d7aa1dccd83f650e326c4e)). Transmission through path L is exp(−βL).

| Rate | Through 1 km | Through 3 km |
|---|---|---|
| 2 mm/h | 76% | 45% |
| 10 mm/h | 41% | 7% |
| 50 mm/h | 5% | ≈ 0 |
| 100 mm/h | under 1% | ≈ 0 |

- **What it hides.** A 50 mm/h core a few km deep hides the horizon.
- **Upper bound.** Showers have optical thickness 0.1-3 ([Gedzelman 2008](https://opg.optica.org/abstract.cfm?URI=ao-47-34-H176)). Large drops scatter forward, so these opacities are an upper bound.
- **Path.** Opacity is rate × path. Through a round core the path is longest at the centre and goes to zero at the edge, so the edge fades softly.

## Colour
- **The range.** Shafts can look very dark, nearly white, or faintly glowing.
- **Dark.** Mostly contrast: the drops are lit only by the dim light under the cloud ([stormtrack](https://stormtrack.org/threads/hail-shaft.15771)).
- **Bright.** Only with large particles (Gedzelman), and only when sunlight reaches the shaft from behind it, through forward scatter (silver-white).
- **Sun behind the viewer.** Grey.
- **In the storm's shadow.** Slate blue-grey. Water barely absorbs visible light, so a shaft takes the colour of the light that falls on it.
- **Distance.** Haze mixes it toward the horizon colour (aerial perspective; inference).

## Motion and structure
- **Fall speeds.**
  - Rain falls at up to about 10 m/s ([GPM](https://gpm.nasa.gov/resources/faq/how-fast-do-raindrops-fall)).
  - Hail under 1 in falls at 9-25 mph; 1-1.75 in at 25-40 mph; 2-4 in at 44-72 mph ([NSSL](https://nssl.noaa.gov/education/svrwx101/hail)).
- **Lean.** The lean is the shear from base to ground × the fall time. A 1.5 km base gives about 3.5 min of fall, so 5-10 m/s of shear gives 1-2 km of lean. Hail stands straighter.
- **Where things sit in a supercell.**
  - The forward flank and anvil give wide, see-through veils, often virga.
  - The core is dense and reaches the ground.
  - The updraft region is a rain-free base with thin curtains wrapping round the wall cloud.

## Hail
- **Colour.** Hail looks "brilliant white" against dark cloud only when the sun reaches it. It is sparse and large, so it is less opaque than a heavy rain core. In shade it is grey like rain.
- **Shafts.** Being straighter, hail can show crisper edges than the wind-blown rain round it. It is mixed into the rain core, brightest nearest the updraft.
- **Where it falls.** Most often in the hook, or just north of the updraft base, beside the wall cloud and rain-free base (stormtrack). The largest stones fall nearest the updraft; that is the standard supercell model, not a fetched source.
- **Green sky.** Not a hail sign. Green and grey storms both occur with and without hail. The green is light through very thick cloud under low, reddened sun ([Bohren](https://scicolloq.gsfc.nasa.gov/Bohren.htm), [Gallagher](https://shareok.org/handle/11244/5519)).
- **Melting.** Hail cores aloft may melt before they reach the ground ([NWS Louisville](https://www.weather.gov/media/lmk/soo/Hail_Size_Melting_Considerations_Web.pdf)).
- **On the ground.** Hail can whiten the ground. Melting hail can make shallow, dense fog after the core passes ([NWS Tallahassee](https://www.weather.gov/tae/event-20110327-hailstorms)).

## What RainView does with this
1. **No picket fence.** It smooths the rate field (about 1.4 columns), then draws many overlapping curtains on a jittered lattice, each 2.5 spacings wide. It never draws one curtain per column.
2. **Texture.** `tools/rain/distant_shaft.py` makes a bell across with no hard side. The top ramps in over 30%, so the curtain starts 250 m inside the cloud with no join. The foot feathers out over the bottom 6%. Banding is faint, ±12%.
3. **Opacity.** Each curtain carries its share of rate × path, using the lidar fit, so the edges thin like a chord. Hail has a fifth of rain's extinction per mm/h.
4. **Colour.**
   - The base colour is the light under the cloud.
   - A forward-scatter brightening applies only with the sun behind the shaft and reaching it. Hail gets twice the gain, which is the only time it looks white.
   - Haze mixes far curtains toward the sky colour.
5. **Height.** The top is the lowest cloud base, at most 3 km, so a curtain never sticks out above the storm.

**Not done yet:**
- the lean (the frame has no low-level wind);
- the rain-foot flare;
- the white hail ground and hail fog;
- hail size in the frame, which near-camera hail needs.
