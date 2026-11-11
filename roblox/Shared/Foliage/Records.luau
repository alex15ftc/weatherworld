--!strict
-- The trees of a chunk and what has happened to them, as attributes on the chunk's props model
-- (Workspace.WorldProps.<chunk>), so they replicate with the chunk and every client builds the
-- same trees (FoliageController) with no messages of their own:
--   "Trees"       every tree the chunk generator stood there, in order (a tree's id in the chunk
--                 is its place in this list): base64 of TREE_BYTES each - f32 x, y (its foot),
--                 z (studs, world), u8 which generated tree (Rig.names() order), u8 scale
--                 (SCALE_MIN + byte / 255 x SCALE_SPAN), u16 yaw (turns / 65536)
--   "TreeDamage"  what broke (FoliageService): base64 of DAMAGE_BYTES each - u16 tree, u8 bone
--                 (0: the roots), u8 the way it fell (turns / 256), f64 when (the server's
--                 workspace:GetServerTimeNow()), f32 the 3-s gust (m/s) that did it
-- Only the server writes them. The fall's rest pose is not stored: Mechanics.rest gives the same
-- from these on every machine.
local function dep(path: string, robloxPath: { string }): any
	if script then
		local node: any = (script :: any).Parent
		for _, name in robloxPath do
			node = if name == ".." then node.Parent else node:FindFirstChild(name)
		end
		return require(node)
	end
	return (require :: any)(path)
end
local Frames = dep("../StormLab/Sim/Frames", { "..", "StormLab", "Sim", "Frames" })
local Rig = dep("./Rig", { "Rig" })

local Records = {}

Records.TREE_BYTES = 16
Records.DAMAGE_BYTES = 17
Records.SCALE_MIN = 0.8
Records.SCALE_SPAN = 0.45

export type Tree = { x: number, y: number, z: number, name: string, scale: number, yaw: number }
export type Damage = { tree: number, bone: number, dirX: number, dirZ: number, at: number, gust: number }

local names = nil :: { string }?
local nameIndex: { [string]: number } = {}
local function allNames(): { string }
	if not names then
		names = Rig.names()
		for i, n in names :: { string } do
			nameIndex[n] = i
		end
	end
	return names :: { string }
end

function Records.encodeTrees(list: { Tree }): string
	allNames()
	local b = buffer.create(#list * Records.TREE_BYTES)
	for i, t in list do
		local o = (i - 1) * Records.TREE_BYTES
		buffer.writef32(b, o, t.x)
		buffer.writef32(b, o + 4, t.y)
		buffer.writef32(b, o + 8, t.z)
		buffer.writeu8(b, o + 12, nameIndex[t.name] or 1)
		buffer.writeu8(b, o + 13, math.clamp(math.floor((t.scale - Records.SCALE_MIN) / Records.SCALE_SPAN * 255 + 0.5), 0, 255))
		buffer.writeu16(b, o + 14, math.floor((t.yaw / (2 * math.pi)) % 1 * 65536 + 0.5) % 65536)
	end
	return Frames.toBase64(b)
end

function Records.decodeTrees(s: string): { Tree }
	local all = allNames()
	local b = Frames.fromBase64(s)
	local out = {}
	for o = 0, buffer.len(b) - Records.TREE_BYTES, Records.TREE_BYTES do
		table.insert(out, {
			x = buffer.readf32(b, o), y = buffer.readf32(b, o + 4), z = buffer.readf32(b, o + 8),
			name = all[buffer.readu8(b, o + 12)] or all[1],
			scale = Records.SCALE_MIN + buffer.readu8(b, o + 13) / 255 * Records.SCALE_SPAN,
			yaw = buffer.readu16(b, o + 14) / 65536 * 2 * math.pi,
		})
	end
	return out
end

-- A tree's scale and yaw as stored (so the server's mechanics use what the clients draw).
function Records.quantise(t: Tree): Tree
	local q = table.clone(t)
	q.scale = Records.SCALE_MIN + math.clamp(math.floor((t.scale - Records.SCALE_MIN) / Records.SCALE_SPAN * 255 + 0.5), 0, 255) / 255 * Records.SCALE_SPAN
	q.yaw = (math.floor((t.yaw / (2 * math.pi)) % 1 * 65536 + 0.5) % 65536) / 65536 * 2 * math.pi
	return q
end

function Records.encodeDamage(list: { Damage }): string
	local b = buffer.create(#list * Records.DAMAGE_BYTES)
	for i, d in list do
		local o = (i - 1) * Records.DAMAGE_BYTES
		buffer.writeu16(b, o, d.tree)
		buffer.writeu8(b, o + 2, d.bone)
		buffer.writeu8(b, o + 3, math.floor((math.atan2(d.dirX, -d.dirZ) / (2 * math.pi)) % 1 * 256 + 0.5) % 256)
		buffer.writef64(b, o + 4, d.at)
		buffer.writef32(b, o + 12, d.gust)
		buffer.writeu8(b, o + 16, 0)
	end
	return Frames.toBase64(b)
end

function Records.decodeDamage(s: string): { Damage }
	local out = {}
	if s == "" then
		return out
	end
	local b = Frames.fromBase64(s)
	for o = 0, buffer.len(b) - Records.DAMAGE_BYTES, Records.DAMAGE_BYTES do
		local a = buffer.readu8(b, o + 3) / 256 * 2 * math.pi
		table.insert(out, {
			tree = buffer.readu16(b, o), bone = buffer.readu8(b, o + 2), dirX = math.sin(a), dirZ = -math.cos(a),
			at = buffer.readf64(b, o + 4), gust = buffer.readf32(b, o + 12),
		})
	end
	return out
end

-- A direction as stored (so the server's rest pose is the clients').
function Records.quantiseDir(dx: number, dz: number): (number, number)
	local a = (math.floor((math.atan2(dx, -dz) / (2 * math.pi)) % 1 * 256 + 0.5) % 256) / 256 * 2 * math.pi
	return math.sin(a), -math.cos(a)
end

return Records
