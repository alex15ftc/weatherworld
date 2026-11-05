# Storm frames over Roblox's network: diagnosis (2026-11-05)

How the cloud model's frames get from the workers beside the engine to players
([PLAN.md](PLAN.md), phases A, B and H), and which Roblox limits matter. Limits checked against
the official docs on 2026-11-05. Numbers marked *unconfirmed* are community figures or undocumented,
and must be measured.

## The path

```
engine (Node) --localhost--> workers (Lune, one per detailed storm)
engine --HTTPS poll, one request for all storms near the server--> each Roblox game server
Roblox server --RemoteEvent buffers, only storms near each player--> clients (draw billboards)
```

The game already polls the engine this way: `StormHost.luau` and `ProductFeed.luau` use
HttpService.RequestAsync on `WEATHER_FEED_URL` (or the `WeatherFeedUrl` attribute), with a
`weather_feed_key` secret. Studio's game servers can't reach localhost, so local tests go through
a tunnel or a host.

## Measured frames (SupercellB, worker under Lune, 2026-11-05)

| Frame | Raw | Compressed (gzip / Zstd) |
|---|---|---|
| 1 km box (64 x 64 x 12 bytes), early storm | 49 KB | 3.5-5 KB |
| 1 km box, mature storm with anvil | 49 KB | 7-8 KB |
| box + 250 m nest (48 x 48 x 5 bytes) | 61 KB | 12.5-13.7 KB |

Zstd and gzip come out about the same. A frame goes out every 15 game seconds, which is 1.9 real
seconds at the 8x clock.

## Roblox limits that apply

| Limit | Number | What it means here |
|---|---|---|
| HttpService rate | 500 requests a minute **per game server** (fails and may stall about 30 s past it) | one poll a second for all storms = 60 a minute; room for the existing feed |
| HttpService concurrency | about 16 at once (3 in Studio), *unconfirmed* | keep one frame poll in flight; set `Timeout` (3-5 s) |
| Request/response size | no documented cap on responses | 10 storms x 13 KB = 130 KB a poll is fine |
| Binary responses | not documented whether bytes arrive intact | **test first in Studio**; fall back to base64 (+33%, `EncodingService:Base64Decode`) |
| gzip `Content-Encoding` | not documented whether Roblox unpacks it | compress the payload ourselves; unpack with `EncodingService:DecompressBuffer(..., Zstd)` |
| Protocol | HTTPS (443) for live servers | the engine needs a public HTTPS host for the live game |
| Streaming (WebStreamClient / WebSockets) | **Studio only**, blocked in live games | live servers must poll |
| Secrets | `HttpService:GetSecret`, not available in local Studio runs | the existing feed key pattern, with a Studio fallback |
| Server to client bandwidth | no documented cap now; the old "about 50 KB/s per player" is a community figure | budget **10-20 KB/s per player** for all weather data, less on mobile |
| RemoteEvent with buffers | supported; large buffers compressed on the wire | send frames as buffers, chunked if large |
| UnreliableRemoteEvent | payloads over 1000 bytes dropped | only small cues (lightning flashes), never frames |
| Attributes | can't hold buffers | not for frames |
| MessagingService | 1 KB messages | no; the engine is the one source and every server polls it |
| MemoryStoreService | 32 KB values, 64 KB + 1.2 KB a user in total | no |
| DataStore | per-key budgets of about 60 a minute | no (the report archive keeps using it) |

Sources: the HttpService reference, the In-experience HTTP requests guide and the Open Cloud rate
limits; the RemoteEvent, UnreliableRemoteEvent, EncodingService, buffer and memory-store
references; and the WebSockets-in-Studio announcement of 2025-10-23. All are on
create.roblox.com/docs and devforum.roblox.com.

## The problem: server to client

The full frames are sized for the server, which needs every field: the ground wind for damage
and probes, the cold pool, rotation and pressure for the tornado's placement. Sent to each client
every frame:
- one mature box is about 7.5 KB / 1.9 s = **4 KB/s**;
- a storm with a nest is about 13 KB / 1.9 s = **7 KB/s**;
- three storms in view plus one chased is about 20 KB/s.

That fills the whole weather budget before radar, products and the tornado. HTTP into the Roblox
server isn't the limit.

## Fixes

1. **Client frames carry only what the visuals need.**
   - Box: cloud base and top, anvil base and top, rain, hail, snow (7 of the 12 bytes).
   - Nest: the cloud base (wall cloud).
   - The wind, cold pool, updraft and rotation stay on the server. The server sends the client
     only the few derived numbers it draws from them (the tornado's position and size, gust-front
     dust) as a small separate message.
2. **Send to clients less often, and blend.**
   - Clouds change over minutes. A client frame every 60 game seconds (7.5 real seconds) is
     enough if the client blends between frames and moves the storm by its motion in between.
   - The server still takes every frame.
3. **Detail by distance** (PLAN phase D).
   - Storms past view range: the engine's description only (a few hundred bytes).
   - Far storms in view: the box at half resolution (2 km, a quarter of the bytes).
   - The chased storm: full resolution plus the nest.
4. **Changes only, later if needed:** each column's change from the last frame the client has,
   with a full frame now and then. That compresses well while the storm changes slowly.

Estimated with 1-3:
- each far storm about 0.3 KB/s;
- the chased storm about 1 KB/s;
- an outbreak sky of 10 storms in view, about 4 KB/s.

That's an estimate from the measured compression; measure it in the Developer Console
(Network / ServerStats) with a phone in the test.

## Other risks

- **Engine load from many servers:**
  - every Roblox server polls the engine once a second, so N servers make N requests a second for
    identical frames;
  - serve frames from a cache keyed by the sequence number (or a CDN in front), so each frame is
    built and compressed once;
  - rate-limit by the feed key;
  - Roblox publishes no IP ranges, so the key is the only gate.
- **Worker speed** (round 15, the WebAssembly model under Node):
  - the 1 km box runs at about 107x real time, the box plus nest at about 47x, both in one process;
  - a storm whose worker still falls behind keeps drawing its last frame moved by the engine's
    motion, and the server reports the lag.
- **Machine size:**
  - a watched storm (box only) uses about 7.5% of one core at 8x, a chased one (box plus nest)
    about 17%;
  - an outbreak with 10 detailed storms and 2 chased needs about 1-1.5 cores beside the engine;
    15 chased storms about 2.5;
  - storms past the core budget stay tier 0.
- **Undocumented limits** (binary bodies, concurrency, client bandwidth) can change; the Studio
  test below checks the first, the Developer Console the last.

## Tests before building on this

1. **Studio:**
   - an HttpService RequestAsync of a 256-byte response holding bytes 0-255, compared byte for
     byte;
   - a Zstd frame from the engine, decompressed with EncodingService.
2. **Studio:** a frame sent as a RemoteEvent buffer to a client; check the Network stats.
3. **Live test server, later:** many servers polling one engine; check engine CPU and response
   times.

**Results of tests 1 and 2 (2026-11-05, Studio 0.746, the cloudlab place).** Run them again with
`node tools/cloudlab/worker/nettest.mjs`, the workspace attribute `NetTest = true` (plus
`CloudLabPaused = true`), and a Play test. The scripts are server/NetTest.server.luau and
client/NetTest.client.luau.
- **HTTP is byte-exact.**
  - RequestAsync returned the 256 bytes 0-255 unchanged.
  - A real frame (SupercellB at 40 model minutes, with the nest) came through byte for byte, both
    raw (60,730 B) and Zstd-compressed (13,617 B).
- **EncodingService:DecompressBuffer (Zstd)** gave back the exact frame in 0.17 ms on the server,
  and the client can unpack it too.
- **RemoteEvent buffers:** 60 frames were sent to a client over 45 s and all arrived undamaged.
- **Bandwidth: the full compressed frame is too big for clients.**
  - Ten storms, each with the nest, one frame a game minute (every 7.5 s) is 17.7 KB/s of payload
    per player: 4.4 times the 4 KB/s budget.
  - Box-only frames (3.5-8 KB) would still be 5-11 KB/s.
  - So the cut-down client frames of PLAN B2 are needed (visual fields only, half resolution far
    away, the nest only for the chased storm), or a frame every few game minutes for distant
    storms.
- **Stats.DataReceiveKbps reads 0 in a Studio play test,** so these are payload figures; the wire
  rate (after Roblox's own compression) needs the live test server (test 3).
