--!strict
-- Describing the parts a chunk's props are made of. Descriptions are plain data, built in a
-- parallel phase; ChunkGen.place turns them into Parts in serial. Everything is anchored.

local Builder = {}

export type Prop = {
	shape: string, -- "Block", "Wedge", "CornerWedge", "Ball", "Cylinder"
	cf: CFrame,
	size: Vector3,
	color: Color3,
	material: Enum.Material,
	collide: boolean,
	mesh: string?, -- "Sphere": an ellipsoid filling the part's box (crowns of trees)
	transparency: number?,
	reflectance: number?,
}

export type Props = { Prop }

local M = Enum.Material

-- Uniform 0 to 1 from integers (the same everywhere for the same inputs).
Builder.hash = require(script.Parent.Parent.LandSurface).hash

function Builder.add(props: Props, shape: string, cf: CFrame, size: Vector3, color: Color3, material: Enum.Material?, collide: boolean?): Prop
	local p: Prop = { shape = shape, cf = cf, size = size, color = color, material = material or M.SmoothPlastic, collide = if collide == nil then true else collide }
	table.insert(props, p)
	return p
end

-- A box standing on y (its base), centred on (x, z), turned by yaw (radians).
function Builder.box(props: Props, x: number, y: number, z: number, sx: number, sy: number, sz: number, color: Color3, material: Enum.Material?, yaw: number?): Prop
	return Builder.add(props, "Block", CFrame.new(x, y + sy / 2, z) * CFrame.Angles(0, yaw or 0, 0), Vector3.new(sx, sy, sz), color, material)
end

-- A box given by its centre frame.
function Builder.block(props: Props, cf: CFrame, sx: number, sy: number, sz: number, color: Color3, material: Enum.Material?, collide: boolean?): Prop
	return Builder.add(props, "Block", cf, Vector3.new(sx, sy, sz), color, material, collide)
end

-- A bar of square section from p0 to p1 (beams, cables, chords).
function Builder.beam(props: Props, p0: Vector3, p1: Vector3, thickness: number, color: Color3, material: Enum.Material?, collide: boolean?): Prop?
	local length = (p1 - p0).Magnitude
	if length < 0.05 then
		return nil
	end
	return Builder.add(props, "Block", CFrame.lookAt((p0 + p1) / 2, p1), Vector3.new(thickness, thickness, length), color, material, collide)
end

-- A round bar from p0 to p1 (poles, trunks, branches, piers, pipes).
function Builder.rod(props: Props, p0: Vector3, p1: Vector3, diameter: number, color: Color3, material: Enum.Material?, collide: boolean?): Prop?
	local length = (p1 - p0).Magnitude
	if length < 0.05 then
		return nil
	end
	local axis = (p1 - p0) / length
	-- A cylinder's axis is its X: point -Z along the bar, then turn X onto it.
	local up = if math.abs(axis.Y) > 0.99 then Vector3.xAxis else Vector3.yAxis
	local cf = CFrame.lookAt((p0 + p1) / 2, p1, up) * CFrame.Angles(0, math.pi / 2, 0)
	return Builder.add(props, "Cylinder", cf, Vector3.new(length, diameter, diameter), color, material, collide)
end

-- An upright cylinder standing on y.
function Builder.column(props: Props, x: number, y: number, z: number, height: number, diameter: number, color: Color3, material: Enum.Material?): Prop
	return Builder.add(props, "Cylinder", CFrame.new(x, y + height / 2, z) * CFrame.Angles(0, 0, math.pi / 2), Vector3.new(height, diameter, diameter), color, material)
end

-- An ellipsoid of the given size centred at cf (no collision: foliage).
function Builder.ellipsoid(props: Props, cf: CFrame, size: Vector3, color: Color3, material: Enum.Material?): Prop
	local p = Builder.add(props, "Block", cf, size, color, material or M.LeafyGrass, false)
	p.mesh = "Sphere"
	return p
end

-- A gable roof over a w x d box whose walls top out at y, ridge along the local X axis; the
-- frame's yaw turns it. Two wedges, each sloping down to a long side.
function Builder.gable(props: Props, x: number, y: number, z: number, w: number, d: number, rise: number, color: Color3, yaw: number?, overhang: number?)
	local o = overhang or 1.5
	local base = CFrame.new(x, y, z) * CFrame.Angles(0, yaw or 0, 0)
	local half = d / 2 + o
	-- A wedge's sloping face is its front (-Z): low edge at the front, high edge at the back.
	Builder.add(props, "Wedge", base * CFrame.new(0, rise / 2, half / 2) * CFrame.Angles(0, math.pi, 0), Vector3.new(w + 2 * o, rise, half), color, M.Slate)
	Builder.add(props, "Wedge", base * CFrame.new(0, rise / 2, -half / 2), Vector3.new(w + 2 * o, rise, half), color, M.Slate)
end

-- A sloping slab from p0 to p1 (road pieces, ramps): width across, thickness down from the top
-- surface, which runs through p0 and p1.
function Builder.slab(props: Props, p0: Vector3, p1: Vector3, width: number, thickness: number, color: Color3, material: Enum.Material?, lift: number?): Prop?
	local length = (p1 - p0).Magnitude
	if length < 0.05 then
		return nil
	end
	local cf = CFrame.lookAt((p0 + p1) / 2, p1) * CFrame.new(0, (lift or 0) - thickness / 2, 0)
	return Builder.add(props, "Block", cf, Vector3.new(width, thickness, length), color, material)
end

return Builder
