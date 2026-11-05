--!strict
-- A client frame: the cut-down frame a player's client gets for one detailed storm (made by the
-- engine from the full frame, js/cloudmodel/FrameCodec.js clientFrame; docs/cloudlab/PLAN.md B2).
-- Only what the visuals draw, each field a whole plane. The frame arrives Zstd-compressed; unpack
-- it first (EncodingService:DecompressBuffer(b, Enum.CompressionAlgorithm.Zstd)).
--
-- Header (42 bytes, little-endian, as FrameCodec.luau's): u8 version (129), u8 flags (bit 0 nest,
-- bit 1 storm ended, bit 2 far), u32 seq, f32 model time (s), f64 engine sim hour, u16 nx, ny
-- (this grid's), f32 dx (m; a far frame has half the columns each way at twice the spacing),
-- f32 anchorX, anchorY (m from the box's south-west corner: the point drawn at the engine storm's
-- position), f32 frame motion u, v (m/s).
-- Box planes (nx * ny bytes, row by row from the south-west): base1, top1, base2, top2 (100 m),
-- rain, hail (byte = 40 log10(1 + mm/h)), snow (anvil, 0.05 kg/m2). A far column is a 2 x 2
-- block: the lowest base, the highest of the rest.
-- Near frames with a nest: its header (u16 nx, ny, f32 dx, X0, Y0: its corner in the box, m) and
-- two planes, cloud base below 3 km (25 m; 0 none) and pressure drop (10 Pa).
local ClientFrame = {}

ClientFrame.VERSION = 129
local HEADER = 42
local NEST_HEADER = 16
ClientFrame.PLANES = { "base1", "top1", "base2", "top2", "rain", "hail", "snow" }
local PLANE_INDEX = {}
for k, name in ClientFrame.PLANES do PLANE_INDEX[name] = k - 1 end

export type Nest = { nx: number, ny: number, dx: number, X0: number, Y0: number, offset: number }
export type Frame = {
	buf: buffer, seq: number, time: number, simHour: number, ended: boolean, far: boolean,
	nx: number, ny: number, dx: number, anchorX: number, anchorY: number, um: number, vm: number,
	nest: Nest?,
}

function ClientFrame.decode(b: buffer): Frame
	assert(buffer.readu8(b, 0) == ClientFrame.VERSION, "not a client frame")
	local flags = buffer.readu8(b, 1)
	local nx, ny = buffer.readu16(b, 18), buffer.readu16(b, 20)
	local f: Frame = {
		buf = b, seq = buffer.readu32(b, 2), time = buffer.readf32(b, 6), simHour = buffer.readf64(b, 10),
		ended = bit32.btest(flags, 2), far = bit32.btest(flags, 4),
		nx = nx, ny = ny, dx = buffer.readf32(b, 22),
		anchorX = buffer.readf32(b, 26), anchorY = buffer.readf32(b, 30), um = buffer.readf32(b, 34), vm = buffer.readf32(b, 38),
		nest = nil,
	}
	if bit32.btest(flags, 1) then
		local o = HEADER + #ClientFrame.PLANES * nx * ny
		f.nest = { nx = buffer.readu16(b, o), ny = buffer.readu16(b, o + 2), dx = buffer.readf32(b, o + 4), X0 = buffer.readf32(b, o + 8), Y0 = buffer.readf32(b, o + 12), offset = o + NEST_HEADER }
	end
	return f
end

-- The byte of a box plane at column (i, j), 1-based from the south-west.
function ClientFrame.byte(f: Frame, plane: string, i: number, j: number): number
	return buffer.readu8(f.buf, HEADER + PLANE_INDEX[plane] * f.nx * f.ny + (j - 1) * f.nx + (i - 1))
end

-- In physical units: cloud heights (m above the ground; 0 none), rain and hail (mm/h), snow (kg/m2).
function ClientFrame.cloudM(byte: number): number return byte * 100 end
function ClientFrame.rateMmh(byte: number): number return 10 ^ (byte / 40) - 1 end
function ClientFrame.snowKg(byte: number): number return byte * 0.05 end

-- The nest's cloud base (m; 0 none; 25 for a cloud from the ground up) and pressure drop (Pa) at its
-- column (i, j).
function ClientFrame.nestBaseM(f: Frame, i: number, j: number): number
	local n = f.nest :: Nest
	return buffer.readu8(f.buf, n.offset + (j - 1) * n.nx + (i - 1)) * 25
end
function ClientFrame.nestDropPa(f: Frame, i: number, j: number): number
	local n = f.nest :: Nest
	return buffer.readu8(f.buf, n.offset + n.nx * n.ny + (j - 1) * n.nx + (i - 1)) * 10
end

return ClientFrame
