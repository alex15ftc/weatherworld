# Tornado / supercell reference video: sources

Private reference only. All files come from Wikimedia Commons with the licence shown on the file page (checked
2026-11-07 through the Commons API, `extmetadata.LicenseShortName`). CC BY / CC BY-SA need credit if ever shown
publicly, and BY-SA needs share-alike for derivatives. "Public domain" CCTV/doorbell clips are tagged PD on Commons
(automated-camera rationale). That claim comes from Commons, and we have not checked it independently.

Contact sheets (`<name>_sheet.jpg`): 12 frames evenly spaced over the clip, tiled 4x3, read left-to-right,
top-to-bottom. Frame spacing = duration / 12. No timestamps are burned in (ffmpeg drawtext has no fontconfig here).

| File | Source | Licence | Credit | Stage(s) | Res / fps / length |
|---|---|---|---|---|---|
| `prospect_valley_lifecycle_timelapse.webm` | [File:Tornado time lapse.webm](https://commons.wikimedia.org/wiki/File:Tornado_time_lapse.webm) | CC BY-SA 4.0 | Runningonbrains | **Whole life cycle** (a)(d): funnel lowers from the wall cloud, rope/elephant-trunk tornado, retreat and decay. Prospect Valley CO, 19 Jun 2018, about 5 min real life | 1920x1080, 60 fps, 36.2 s (timelapse, about 8-10x, inferred) |
| `elreno_2013_subvortices.ogv` | [File:May 31, 2013 EF5 El Reno…sub vortices.ogv](https://commons.wikimedia.org/wiki/File:May_31,_2013_EF5_El_Reno,_OK_Tornado_showing_multiple_sub_vortices.ogv) | CC BY 3.0 | Ray Bohac (TVN Dominator) | (b)(e) mature multi-vortex wedge, **rain-wrapped**; satellite vortices visible as bright columns at the base | 1920x1080, 29.97 fps, 51.3 s, real time |
| `tail_cloud_birth_10fps.ogv` | [File:Naissance tuba 10fps.ogv](https://commons.wikimedia.org/wiki/File:Naissance_tuba_10fps.ogv) | CC BY-SA 3.0 | Matthieu Pron | (c) wall cloud with a tail cloud / funnel forming and extending from its edge; striated base. Eure-et-Loir, France | 320x240, 10 fps, 5 s (timelapse, real span unknown) |
| `noaa_waterspout_5stages.webm` | [File:Ocean Today - Waterspouts 5stages.webm](https://commons.wikimedia.org/wiki/File:Ocean_Today_-_Waterspouts_5stages.webm) | Public domain (NOAA Ocean Today) | NOAA | (a)(d) Golden's five stages: dark spot, spiral, spray ring, mature funnel, **decay** (tilted, fading funnel in rain) | 1280x720, 29.97 fps, 24.3 s, real-time segments with captions |
| `moore_2013_forming.gif` | [File:Moore, OK tornado forming 2013.gif](https://commons.wikimedia.org/wiki/File:Moore,_OK_tornado_forming_2013.gif) | Public domain | Newcastle (OK) Police dashcam | (a)/(b) early-stage Moore EF5, 20 May 2013: thin funnel with a debris whirl, widening into a cone with a debris skirt | 426x240, 15 fps (avg 16.7), 10.7 s |
| `southern_indiana_tornado.webm` | [File:Southern Indiana tornado.webm](https://commons.wikimedia.org/wiki/File:Southern_Indiana_tornado.webm) | CC BY 3.0 | predatorylizard | (b)(e) large cone/stovepipe tornado, grey on grey, with a bright rain curtain (RFD/hook precipitation) wrapping in on the right; later frames show it becoming rain-wrapped. Memphis IN (15 mi N of Louisville), probably 2 Mar 2012 | 1280x720, 30 fps, 121.9 s, real time |
| `jonesboro_2020_ef3_ardot.webm` | [File:Jonesboro AR tornado video.webm](https://commons.wikimedia.org/wiki/File:Jonesboro_AR_tornado_video.webm) | Public domain | ARDOT traffic camera | (a)→(b)→(e): funnel lowers in the distance, becomes a broad tornado, then rain and wind wrap the camera view. Fixed camera, buildings give scale | 1470x690, 9 fps, 82.4 s |
| `enderlin_2025_ringcam.webm` | [File:Footage of the June 20, 2025, tornado near Enderlin, North Dakota.webm](https://commons.wikimedia.org/wiki/File:Footage_of_the_June_20,_2025,_tornado_near_Enderlin,_North_Dakota.webm) | Public domain | Ring doorbell | Night, lit by lightning: narrow funnel under a huge, sharply edged lowering. Good for **backlit / flash-lit** looks. Fixed fisheye with houses for scale | 1920x1080, 60 fps, 58.1 s, IR/mono |
| `aurora_co_2016_funnel.webm` | [File:Crazy Funnel Cloud in Aurora, CO on May 8, 2016.webm](https://commons.wikimedia.org/wiki/File:Crazy_Funnel_Cloud_in_Aurora,_CO_on_May_8,_2016.webm) | CC BY 2.0 | Lyn Lomasi | (c) close view of a turbulent, rotating lowered base with scud and striated cloud tags. Real time, good for measuring base motion | 1920x1080, 29.97 fps, 21.7 s |

## What the contact sheets show

- **prospect_valley_lifecycle**: frame 1: a broad, smooth lowering with a hint of a cone. Frames 2-4: a thin, white,
  curved funnel lowers to the ground about 1/3 of the way across the frame. Frames 5-8: the funnel stretches into a
  long, horizontal "elephant trunk" bent downshear, then becomes a near-vertical rope. Frames 9-11: a thin rope that
  tilts strongly and shrinks upward. Frame 12: gone, with a rain shaft behind. **Lit from the front: the funnel
  (grey level 137) is brighter than the dark rain shaft behind it (96-97) and about the same as the cloud base
  (126).** Trees and a grain bin are about 2-5 km away, so the funnel is narrow (estimated tens of metres wide).
- **elreno_subvortices**: mostly grey-green murk from inside the rain. Frames 4-7 show the bright, rain-lit base of
  the wedge with 1-2 brighter sub-vortex columns. The parent tornado is mostly invisible as a funnel: a classic
  rain-wrapped/HP look with very low contrast (judged by eye, not measured).
- **noaa_waterspout_5stages**: captioned stages. The decay frames show a thin, tilted, broken funnel fading inside a
  rain shaft. This is the best free rope-out/decay imagery we found.
- **tail_cloud_birth**: a dark striated base above a bright backlit horizon. A ragged tag hangs from the wall cloud
  edge (frames 4-6), grows into a curved finger (frames 6-8), and in frames 9-12 becomes a long tail cloud sloping
  into the rain. **Backlit: the cloud is dark against the bright sky.**
- **moore_forming**: a dashcam shot of a thin, slightly tilted funnel with a ground debris whirl, widening into a
  grey cone with a broad, diffuse debris skirt wider than the funnel. Low contrast against a grey sky, front-lit.
- **southern_indiana**: a large grey cone/stovepipe with a smooth, sheared edge. The bright white rain curtain to the
  right is the brightest thing in frame. **Tornado grey 148 vs rain curtain 186 and sky 167: the funnel is darker
  than its surroundings.** By the end the bottom becomes a diffuse, rain-wrapped column.
- **jonesboro**: lowering and a thin funnel far behind the hotel (frames 5-7), a wide cone (8-10), then haze and
  rain cover everything (11-12). The fixed camera makes it good for timing.
- **enderlin**: lightning frames show a sharply edged, layered (stacked-plate) lowering and a narrow funnel with a
  debris base. Between flashes everything is black.
- **aurora_funnel**: a turbulent base filling the frame with stretched, striated tags. Motion is slow from frame to
  frame (the 1.8 s spacing shows only small shifts), which matches the real-time rotation speed of a wall cloud.

## Gaps

- **No free real-time video of a classic, front-lit rope-out of a large plains tornado** (the iconic
  "rope dance"). Prospect Valley (timelapse, small tornado) and the NOAA waterspout decay are the substitutes.
  Candidate: NSSL/NOAA Photo Library VORTEX2 media-vehicle footage, La Grange WY, 5 Jun 2009 (public domain). We
  found it mentioned but have no direct file URL.
- **No long real-time video of a rotating wall cloud with measurable rising scud.** Aurora is a close view of a
  rotating base, and Naissance tuba is a short timelapse.
- `0411_Tornado_06_00_36_00.webm` (Calvin Productions, PD, 14.6 min, 130 MB) and the extended El Reno video
  (`May 31 El Reno EF5 Extended Version.webm`, CC BY 3.0, 67 MB, 5.3 min) were not downloaded because of their
  size. Both could be trimmed with ffmpeg if needed.
