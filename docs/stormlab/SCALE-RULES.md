# Scale and ground rules for lab code (2026-10-26)

The game runs at **Roblox's standard scale, 1 stud = 0.28 m (about 3.57 studs per metre)** (`LabConfig.SCALE = 1 / 0.28`; set 2026-10-26, replacing 0.3), the same on every axis, and its ground is not flat. All lab code follows these rules so the renderers work at any scale and on any ground. With `SCALE = 1` and flat ground, behaviour must be exactly what it was.

## Units

- **Metres** are what the simulation, the frames (`docs/stormlab/FRAME-V2.md`) and every renderer computes in: positions, distances, sizes, speeds, heights. Sim frame: x east, y north, z up.
- **Studs** are what Roblox takes: `Vector3` positions, `CFrame`s, `Part.Size`, `BillboardGui.Size` (UDim2.fromScale is in studs), `Attachment.Position`, ParticleEmitter `Size` / `Speed` / `Acceleration`, Beam `Width0/1`, `AssemblyLinearVelocity`, camera positions and offsets, `Workspace.Gravity`, `MaxDistance`s, and Atmosphere / fog distances.
- Cross only through `LabConfig` (`ctx.Config` on the client):
  - `C.toWorld(x, y, z)`: metres → stud position (also for an offset from an anchor: there is no origin shift);
  - `C.fromWorld(v)`: stud position → metres x, y, z;
  - `C.studs(m)` / `C.metres(s)`: lengths, speeds (studs/s = studs(m/s)) and accelerations;
  - `C.dirWorld(u, v)`: a horizontal direction (unit-free).
- **Directions** (unit vectors, the sun's direction, view directions) need no scaling. Only the axis swap (x, y, z) ↔ (X, Z = −y, Y) applies.
- **The camera:** take its position with `C.fromWorld(cam.CFrame.Position)` (or `ctx:simCamera()`), then work in metres. A distance in metres is `(C.fromWorld(a) − …)` or `(stud distance) / SCALE`.
- **Never** write `Vector3.new(x, z, -y)` by hand for a metre position. Use `C.toWorld`.
- Pixel sizes on screen (`ViewportSize`) are unchanged. A card's on-screen size uses metres / metres, so it is unchanged too.

## Ground

- `C.groundAt(x, y)` gives the ground's height above the datum (m). The lab has hills near the town; the main game will plug in its terrain.
- **Things that sit on or rise from the ground** take their height from there:
  - the tornado's contact and lower funnel; dust; debris; the debris cloud;
  - rain-shaft feet; splashes; near-camera rain;
  - scud (a height above the local ground), vehicles, the town, the camera's minimum height.

  Use `C.toWorldGround(x, y, h)` (h = height above the ground there), or add `C.groundAt` to z.
- **Clouds** (bases, towers, anvils, the wall cloud) stay at their altitude above the datum. The atmosphere's heights are not bent by small hills. The funnel blends between the two: its bottom sits on the ground and its top at the cloud base.
- Physics parts (debris, vehicles) collide with the real Terrain the server builds. Don't assume y = 0 is the ground.

## Testing

- Type-check the whole lab (luau-lsp).
- In Studio, run at `SCALE = 1 / 0.28` (default) and, quickly, at `SCALE = 1` to confirm nothing changed there.
