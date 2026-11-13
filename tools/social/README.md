# Social post kit

Makes post-ready pictures and loops from a day of the live world, using only the hosted engine's public
routes. Output goes under `data/social/<day>/` (not in git).

```
node tools/social/record-live.mjs data/social/<day>/raw     # while the day runs (stops at the outlook's end)
node tools/social/make-post.mjs  data/social/<day>          # 1-outlook.png, 2-what-happened.png, captions.md
node tools/social/make-loop.mjs  data/social/<day>          # 3-<chart>.mp4, .gif and a still, per chart
```

## On the site instead

For a day that has just been played, the site makes the same two pictures without any recording: sign in as
admin on `/days`, open the day and press Save. The saved day's page has both pictures (Save as PNG, or Open
alone for a screenshot), the day's numbers and draft post text. The engine keeps what a day needs for about
two weeks; a saved day is kept for good.

For 16 world days (two real days) after a day, its page also has replays: the mesoanalysis and the large-scale
charts hour by hour and the warnings on a time slider. Each has a "Save as GIF"
button that makes the picture in the browser. The recording below is still the way to keep a day's loops longer
than that, or as MP4.

## What each step does

- **record-live.mjs** saves, as the world runs: each Day 1 outlook issue (text and maps), every 5-minute
  storm tick of `/api/live/storms`, each watch and discussion with its map, the warnings, and the synoptic
  fields of each half-hour analysis. A world day is 3 real hours; start it near the day's first outlook
  (12Z) for a whole day. The engine only keeps the last 18 h of synoptic frames and loses them on a
  restart, so a day cannot be fetched afterwards.
- **make-post.mjs** takes the day's highest-risk outlook issue (or `--issue <hour>`) and writes two
  1600x900 pictures: the outlook as issued, and the same areas with the day's tornado tracks, their
  ratings and how many began inside the top risk area. `captions.md` has draft text and every number used.
- **make-loop.mjs** draws each recorded analysis with the site's synoptic page in its share view
  (`/synoptic?share=1`: the chart following the game map east-west; `--hold` holds the view still instead so the map's box
  moves through the weather; no drift arrow either way),
  then joins them with ffmpeg. `--charts vort,wind500,jet,llj,surface,moisture`,
  `--zoom 1.7`, `--fps 5`, `--size 1600x900` (use `1080x1350` for a 4:5 picture).

Needs Chrome or Edge (`CHROME=path` to choose) and ffmpeg (`FFMPEG=path` if it is not found).

## Posting notes

- Post the MP4: X, Bluesky and Reddit turn GIFs into video anyway, and the MP4 is smaller and sharper. The
  GIF (800 px wide) is for Discord and forums.
- Every picture carries its title, time and "simulated weather, not a real forecast" in the frame, so it
  still says what it is after a repost. Do not crop that off.
- The daily pair works as a post and a reply: the outlook when it is issued, the tracks about three real
  hours later when the day ends.
- A single still of any chart, any time: open `/synoptic?share=1&chart=vort&zoom=1.7` on the site and take
  a screenshot of the window.
