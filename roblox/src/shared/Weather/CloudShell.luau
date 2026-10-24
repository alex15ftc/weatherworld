--!strict
-- A cloud body as a closed, shaded shell (EditableMesh): the building block for storm-scale cloud
-- (towers, anvils, bases), which is far beyond the ~800-stud reach of particles and the 2048-stud
-- size of a part (docs/storm-visuals/PLAN.md).
--
-- The shape is a grid of points (rows x cols, the columns wrapping round), given in world studs
-- by the caller from the storm's fields; the shell keeps it, works out each point's outward
-- normal, and every frame:
--   - draws it as a scaled copy along the view: a point P is shown at cam + (P - cam) * k, which
--     looks the same from the camera, so a body tens of km across fits in one part (k = 1 for a
--     body small enough to draw at full size; a whole storm shares one k so its parts keep their
--     order in depth)
--   - shades each point (vertex colour on a self-lit (Neon) part: the colours are the whole look):
--     sun on the side facing it (wrap lighting), sky light by how much sky the surface sees (dark
--     undersides), a bright silver edge where the sun is behind the cloud, haze with distance,
--     and soft edges where the surface turns away from the view (alpha).
--
-- A shell is solid (opaque, depth-tested: overlapping see-through shells draw in part order, not
-- depth order), or a fringe: a see-through copy a little outside a solid one, opaque face-on and
-- fading to nothing where its surface turns edge-on to the view, which softens the solid one's
-- silhouette (and, depth-tested against the solids, only shows at edges and in front).
--
--   local shell = CloudShell.build(folder, rows, cols, name, fringe?)   -- yields; nil if unavailable
--   shell:setShape(points, opacity, albedo)                     -- when the shape changes
--   shell:draw(camPos, k, light)                                -- every frame
local AssetService = game:GetService("AssetService")

local CloudShell = {}
CloudShell.__index = CloudShell

-- What the scene's light is (StormMesh works it out once a frame).
export type Light = {
	sun: Vector3, -- unit, towards the sun
	sunColour: Color3, -- direct light (already scaled by its strength)
	skyColour: Color3, -- light from the whole sky, seen by an upward surface
	groundColour: Color3, -- light bounced up from the ground, seen by a downward surface
	haze: Color3, -- the colour distance fades to
	visibility: number, -- studs: haze reaches 63% at this distance
	wrap: number, -- how far round the sun's light wraps (soft, thick cloud: 0.3-0.6)
	silver: number, -- strength of the bright edge when the sun is behind the cloud
	soft: number, -- edge softness: alpha ramps over |n.v| 0..soft
	exposure: number,
}

export type Shell = typeof(setmetatable(
	{} :: {
		mesh: EditableMesh,
		part: MeshPart,
		fringe: boolean,
		normalId: number, -- the one normal every face shares (kept toward the sun)
		facing: Vector3,
		rows: number,
		cols: number,
		vids: { number },
		cids: { number },
		world: { Vector3 }, -- the shape, world studs
		normals: { Vector3 },
		opacity: { number },
		albedo: { number },
		sunlit: { number }, -- 0-1: the sun reaching the point past the rest of the storm
		centre: Vector3,
		radius: number, -- the farthest point from the centre
		local_: { Vector3 },
		colours: { Color3 },
		alphas: { number },
		k: number,
		-- what the colours were worked out for (re-shaded only when these change enough)
		shadedFrom: Vector3?,
		shadedSun: Vector3?,
		shadedShift: Vector3?,
		dirty: boolean,
	},
	CloudShell
))

local BOUNDS = 1020 -- the mesh's fixed half-size (a part is at most 2048 a side)
CloudShell.BOUNDS = BOUNDS

function CloudShell.build(parent: Instance, rows: number, cols: number, name: string, fringe: boolean?): Shell?
	local result: Shell? = nil
	local ok, err = pcall(function()
		local em = AssetService:CreateEditableMesh()
		-- fixed bounds: two far corners in a hidden sliver face, so the part's size never changes
		local L = BOUNDS
		local b1 = em:AddVertex(Vector3.new(-L, -L, -L))
		local b2 = em:AddVertex(Vector3.new(L, L, L))
		local b3 = em:AddVertex(Vector3.new(L, L, L)) -- zero area: never drawn
		em:AddTriangle(b1, b2, b3)
		local vids = table.create(rows * cols)
		for k = 1, rows * cols do
			vids[k] = em:AddVertex(Vector3.zero)
		end
		local up = em:AddNormal(Vector3.yAxis)
		local function v(i: number, j: number): number
			return vids[(i - 1) * cols + ((j - 1) % cols) + 1]
		end
		-- rows go up (or along), columns round (so rows x columns points out): (a, c, b) and
		-- (a, d, c) are front faces outside (checked in Studio with CloudShellNormals)
		for i = 1, rows - 1 do
			for j = 1, cols do
				local a, b, c, d = v(i, j), v(i, j + 1), v(i + 1, j + 1), v(i + 1, j)
				for _, tri in { { a, c, b }, { a, d, c } } do
					local f = em:AddTriangle(tri[1], tri[2], tri[3])
					em:SetFaceNormals(f, { up, up, up })
				end
			end
		end
		local cids = table.create(rows * cols)
		for k, vid in vids do
			local c = em:AddColor(Color3.new(1, 1, 1), 1)
			cids[k] = c
			for _, f in em:GetVertexFaces(vid) do
				em:SetVertexFaceColor(vid, f, c)
			end
		end
		-- (opaque: one vertex alpha under 1 sends the whole mesh to the see-through pass)
		local hidden = em:AddColor(Color3.new(1, 1, 1), 1)
		for _, vid in { b1, b2, b3 } do
			for _, f in em:GetVertexFaces(vid) do
				em:SetVertexFaceColor(vid, f, hidden)
			end
		end
		local part = AssetService:CreateMeshPartAsync(Content.fromObject(em))
		part.Name = name
		part.Anchored, part.CanCollide, part.CanQuery, part.CanTouch = true, false, false, false
		part.CastShadow = false
		-- self-lit: Roblox's own scene light (SkyLight's exposure under a storm, a low sun on the
		-- one shared normal) flattened the shading; the vertex colours are the whole look
		part.Material = Enum.Material.Neon
		part.Color = Color3.new(1, 1, 1)
		-- opaque: overlapping see-through shells are drawn in part order, not depth order (an
		-- anvil behind the tower drew over it), so a shell is solid and depth-tested
		part.Transparency = if fringe then 0.02 else 0
		part.Parent = parent
		local n = rows * cols
		result = setmetatable({
			mesh = em,
			part = part,
			fringe = fringe == true,
			normalId = up,
			facing = Vector3.yAxis,
			rows = rows,
			cols = cols,
			vids = vids,
			cids = cids,
			world = table.create(n, Vector3.zero),
			normals = table.create(n, Vector3.yAxis),
			opacity = table.create(n, 1),
			albedo = table.create(n, 1),
			sunlit = table.create(n, 1),
			centre = Vector3.zero,
			radius = 1,
			local_ = table.create(n, Vector3.zero),
			colours = table.create(n, Color3.new()),
			alphas = table.create(n, 0),
			k = -1,
			shadedFrom = nil,
			shadedSun = nil,
			shadedShift = nil,
			dirty = true,
		}, CloudShell)
	end)
	if not ok then
		warn("[CloudShell] couldn't build " .. name .. ": " .. tostring(err))
		return nil
	end
	return result
end

-- A new shape: points (rows x cols, world studs), and optionally each point's opacity (0-1:
-- thin, fraying parts), albedo (0-1: darker cloud, a crease between lobes, a rain-filled
-- underside) and sunlit (0-1: the sun reaching it past the rest of the storm, e.g. under the anvil).
function CloudShell.setShape(self: Shell, points: { Vector3 }, opacity: { number }?, albedo: { number }?, sunlit: { number }?)
	local rows, cols = self.rows, self.cols
	local world, normals = self.world, self.normals
	local sum = Vector3.zero
	for k = 1, rows * cols do
		world[k] = points[k]
		sum += points[k]
	end
	local centre = sum / (rows * cols)
	local far = 1
	for k = 1, rows * cols do
		far = math.max(far, (world[k] - centre).Magnitude)
	end
	self.centre, self.radius = centre, far
	-- outward normals: up the rows x round the columns (a pole falls back to out from the centre)
	for i = 1, rows do
		for j = 1, cols do
			local k = (i - 1) * cols + j
			local iu, id = math.min(i + 1, rows), math.max(i - 1, 1)
			local jr, jl = j % cols + 1, (j - 2) % cols + 1
			local along = world[(iu - 1) * cols + j] - world[(id - 1) * cols + j]
			local round = world[(i - 1) * cols + jr] - world[(i - 1) * cols + jl]
			local n = along:Cross(round)
			if n.Magnitude < 1e-6 then
				n = world[k] - centre
			end
			normals[k] = if n.Magnitude > 1e-6 then n.Unit else Vector3.yAxis
		end
	end
	for k = 1, rows * cols do
		self.opacity[k] = if opacity then opacity[k] else 1
		self.albedo[k] = if albedo then albedo[k] else 1
		self.sunlit[k] = if sunlit then sunlit[k] else 1
	end
	self.k = -1 -- the local positions are redone at the next draw
	self.dirty = true
end

-- Whether its colours are out of date: a new shape, the sun moved, or the camera moved enough
-- (relative to its distance) to change what it sees (haze, the silver edge, the fringe's edges).
function CloudShell.needsShade(self: Shell, camPos: Vector3, sun: Vector3, shift: Vector3): boolean
	if self.dirty or not self.shadedFrom or not self.shadedSun or not self.shadedShift then
		return true
	end
	if (sun - self.shadedSun).Magnitude > 0.004 then
		return true
	end
	local d = math.max((self.centre + shift - camPos).Magnitude, 1)
	local moved = ((camPos - shift) - (self.shadedFrom - self.shadedShift)).Magnitude
	return moved > 0.01 * d
end

-- Places the part for scale k, continuously: the vertices are written once a shape at the
-- largest scale that fits (k0), and smaller scales come from shrinking the part (a MeshPart
-- scales its mesh to its Size), so k can change every frame without rewriting the mesh.
local FULL = 2 * BOUNDS -- the part's size at k0 (the mesh's fixed bounds)
local function place(self: Shell, camPos: Vector3, k: number, shift: Vector3)
	if self.k < 0 then
		local k0 = (BOUNDS - 2) / math.max(self.radius, 1)
		self.k = k0
		local loc = self.local_
		for i = 1, self.rows * self.cols do
			loc[i] = (self.world[i] - self.centre) * k0
		end
		self.mesh:BatchSetValues(self.vids, loc)
	end
	local s = math.min(k / self.k, 1)
	local size = FULL * s
	if math.abs(self.part.Size.X - size) > 1e-3 * size then
		self.part.Size = Vector3.new(size, size, size)
	end
	self.part.CFrame = CFrame.new(camPos + (self.centre + shift - camPos) * k)
end

-- Draw it from camPos at scale k (<= 1; the caller keeps one k for a storm), moved by offset
-- (studs: how far the storm has gone since the shape was made, so it glides between reshapes).
-- shade: work out the colours too (costly: the caller does it only when needsShade, a shell a
-- frame); otherwise only the part is placed.
function CloudShell.draw(self: Shell, camPos: Vector3, k: number, light: Light, offset: Vector3?, shade: boolean?)
	local shift = offset or Vector3.zero
	if shade == false then
		place(self, camPos, k, shift)
		return
	end
	self.shadedFrom, self.shadedSun, self.shadedShift, self.dirty = camPos, light.sun, shift, false
	local n = self.rows * self.cols
	local world, normals = self.world, self.normals
	local centre = self.centre
	place(self, camPos, k, shift)
	local sun = light.sun
	-- (the one shared normal kept toward the sun, should the part ever be lit by the scene again)
	local toward = if sun.Y > -0.05 then sun else Vector3.yAxis
	if (toward - self.facing).Magnitude > 0.01 then
		self.facing = toward
		self.mesh:SetNormal(self.normalId, toward)
	end
	local sc, kc, gc, hz = light.sunColour, light.skyColour, light.groundColour, light.haze
	local wrap, silver, exposure = light.wrap, light.silver, light.exposure
	local soft = math.max(light.soft, 1e-3)
	local vis = math.max(light.visibility, 1)
	local cs, as = self.colours, self.alphas
	-- (Workspace attribute CloudShellNormals: colour by normal, x red, up green, z blue)
	local debugNormals = workspace:GetAttribute("CloudShellNormals") == true
	for i = 1, n do
		local p = world[i] + shift
		local nrm = normals[i]
		local toCam = camPos - p
		local dist = toCam.Magnitude
		local v = if dist > 1e-3 then toCam / dist else Vector3.yAxis
		local ndl = nrm:Dot(sun)
		local lit = math.max((ndl + wrap) / (1 + wrap), 0) * self.sunlit[i]
		-- sky light from above, bounce from below
		local skyShare = 0.5 + 0.5 * nrm.Y
		-- the silver lining: the sun behind the cloud, seen through its thin edge
		local behind = math.max(-v:Dot(sun), 0)
		local edge = 1 - math.abs(nrm:Dot(v))
		local rim = silver * behind ^ 4 * edge ^ 8
		local a = self.albedo[i] * exposure
		-- light from below reaches mostly the downward faces (a side sees half the sky, but
		-- little of the ground's light)
		local fromBelow = (1 - skyShare) ^ 2
		local r = a * (sc.R * (lit + rim) + kc.R * skyShare + gc.R * fromBelow)
		local g = a * (sc.G * (lit + rim) + kc.G * skyShare + gc.G * fromBelow)
		local b = a * (sc.B * (lit + rim) + kc.B * skyShare + gc.B * fromBelow)
		-- haze with distance (the real distance: the copy is nearer, and Roblox's own haze sees that)
		local h = 1 - math.exp(-dist / vis)
		r, g, b = r + (hz.R - r) * h, g + (hz.G - g) * h, b + (hz.B - b) * h
		if debugNormals then
			r, g, b = 0.5 + 0.5 * nrm.X, 0.5 + 0.5 * nrm.Y, 0.5 + 0.5 * nrm.Z
		end
		-- past white: scaled down whole, so a warm highlight stays warm (clamping each channel
		-- washed it white)
		local over = math.max(r, g, b, 1)
		cs[i] = Color3.new(math.max(r / over, 0), math.max(g / over, 0), math.max(b / over, 0))
		-- a solid shell stays fully opaque: any vertex alpha under 1 sends the whole mesh to the
		-- see-through pass, where its own faces aren't depth-sorted (the anvil's top drew over its
		-- underside). A fringe fades out toward the silhouette.
		if self.fringe then
			local face = math.abs(nrm:Dot(v))
			local t = math.clamp(face / soft, 0, 1)
			as[i] = self.opacity[i] * t * t * (3 - 2 * t)
		else
			as[i] = 1
		end
	end
	self.mesh:BatchSetValues(self.cids, cs)
	self.mesh:BatchSetValues(self.cids, as)
end

-- Shared with the puff style (StormMesh): outward normals of a rows x cols grid (columns
-- wrapping round), into out.
function CloudShell.gridNormals(points: { Vector3 }, rows: number, cols: number, out: { Vector3 })
	local sum = Vector3.zero
	for k = 1, rows * cols do
		sum += points[k]
	end
	local centre = sum / (rows * cols)
	for i = 1, rows do
		for j = 1, cols do
			local k = (i - 1) * cols + j
			local iu, id = math.min(i + 1, rows), math.max(i - 1, 1)
			local jr, jl = j % cols + 1, (j - 2) % cols + 1
			local along = points[(iu - 1) * cols + j] - points[(id - 1) * cols + j]
			local round = points[(i - 1) * cols + jr] - points[(i - 1) * cols + jl]
			local n = along:Cross(round)
			if n.Magnitude < 1e-6 then
				n = points[k] - centre
			end
			out[k] = if n.Magnitude > 1e-6 then n.Unit else Vector3.yAxis
		end
	end
end

-- The colour of a cloud surface at p (normal nrm) seen from camPos: the same light as a shell's.
function CloudShell.shade(p: Vector3, nrm: Vector3, camPos: Vector3, light: Light, albedo: number, sunlit: number): Color3
	local sun = light.sun
	local sc, kc, gc, hz = light.sunColour, light.skyColour, light.groundColour, light.haze
	local toCam = camPos - p
	local dist = toCam.Magnitude
	local v = if dist > 1e-3 then toCam / dist else Vector3.yAxis
	local lit = math.max((nrm:Dot(sun) + light.wrap) / (1 + light.wrap), 0) * sunlit
	local skyShare = 0.5 + 0.5 * nrm.Y
	local behind = math.max(-v:Dot(sun), 0)
	local edge = 1 - math.abs(nrm:Dot(v))
	local rim = light.silver * behind ^ 4 * edge ^ 8
	local a = albedo * light.exposure
	local fromBelow = (1 - skyShare) ^ 2
	local r = a * (sc.R * (lit + rim) + kc.R * skyShare + gc.R * fromBelow)
	local g = a * (sc.G * (lit + rim) + kc.G * skyShare + gc.G * fromBelow)
	local b = a * (sc.B * (lit + rim) + kc.B * skyShare + gc.B * fromBelow)
	local h = 1 - math.exp(-dist / math.max(light.visibility, 1))
	r, g, b = r + (hz.R - r) * h, g + (hz.G - g) * h, b + (hz.B - b) * h
	local over = math.max(r, g, b, 1)
	return Color3.new(math.max(r / over, 0), math.max(g / over, 0), math.max(b / over, 0))
end

function CloudShell.setVisible(self: Shell, on: boolean)
	self.part.LocalTransparencyModifier = if on then 0 else 1
end

function CloudShell.destroy(self: Shell)
	self.part:Destroy()
	self.mesh:Destroy()
end

return CloudShell
