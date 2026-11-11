--!nonstrict
--!native
-- Shared helpers for the storm lab's radar and map panels (UI/Radar.luau, UI/Map.luau):
--   panel / label / button builders in one dark translucent style,
--   a pixel canvas (one EditableImage, or a coarse grid of Frames if that can't be made),
--   colour ramps with matching UIGradient legends,
--   lines drawn as rotated Frames in a square overlay's Scale units (clip them yourself:
--   ClipsDescendants does not clip rotated GuiObjects),
--   and the shared right-side layout (the left 300 px belong to the lab's control panel).
local AssetService = game:GetService("AssetService")
local Workspace = game:GetService("Workspace")

local W = {}

W.FONT = Enum.Font.BuilderSans
W.FONT_BOLD = Enum.Font.BuilderSansBold
W.BG = Color3.fromRGB(14, 17, 23)
W.BG2 = Color3.fromRGB(28, 33, 42)
W.TEXT = Color3.fromRGB(226, 232, 240)
W.DIM = Color3.fromRGB(148, 160, 176)
W.ACCENT = Color3.fromRGB(86, 156, 255)

-- panel sizes before UIScale (logical pixels)
W.RADAR_W, W.RADAR_H = 500, 604
W.MAP_W, W.MAP_H = 440, 540
W.LEFT_RESERVED = 300
W.GAP = 10

function W.corner(parent: Instance, r: number?)
	local c = Instance.new("UICorner")
	c.CornerRadius = UDim.new(0, r or 6)
	c.Parent = parent
	return c
end

function W.panel(parent: Instance, name: string, w: number, h: number): (Frame, UIScale)
	local f = Instance.new("Frame")
	f.Name = name
	f.AnchorPoint = Vector2.new(1, 0)
	f.Position = UDim2.new(1, -W.GAP, 0, W.GAP)
	f.Size = UDim2.fromOffset(w, h)
	f.BackgroundColor3 = W.BG
	f.BackgroundTransparency = 0.12
	f.BorderSizePixel = 0
	f.Active = true
	f.Visible = false
	W.corner(f, 8)
	local s = Instance.new("UIStroke")
	s.Color = Color3.fromRGB(60, 70, 86)
	s.Transparency = 0.3
	s.Thickness = 1
	s.Parent = f
	local sc = Instance.new("UIScale")
	sc.Parent = f
	f.Parent = parent
	return f, sc
end

function W.label(parent: Instance, text: string, x: number, y: number, w: number, h: number, size: number?, align: Enum.TextXAlignment?, bold: boolean?): TextLabel
	local l = Instance.new("TextLabel")
	l.BackgroundTransparency = 1
	l.Position = UDim2.fromOffset(x, y)
	l.Size = UDim2.fromOffset(w, h)
	l.Font = if bold then W.FONT_BOLD else W.FONT
	l.TextSize = size or 13
	l.TextColor3 = W.TEXT
	l.TextXAlignment = align or Enum.TextXAlignment.Left
	l.TextYAlignment = Enum.TextYAlignment.Center
	l.TextTruncate = Enum.TextTruncate.AtEnd
	l.Text = text
	l.Parent = parent
	return l
end

function W.button(parent: Instance, text: string, x: number, y: number, w: number, h: number, onClick: () -> ()): TextButton
	local b = Instance.new("TextButton")
	b.AutoButtonColor = true
	b.BackgroundColor3 = W.BG2
	b.BackgroundTransparency = 0.05
	b.BorderSizePixel = 0
	b.Position = UDim2.fromOffset(x, y)
	b.Size = UDim2.fromOffset(w, h)
	b.Font = W.FONT_BOLD
	b.TextSize = 13
	b.TextColor3 = W.TEXT
	b.Text = text
	W.corner(b, 4)
	b.Parent = parent
	b.MouseButton1Click:Connect(onClick)
	return b
end

function W.setActive(b: GuiObject, on: boolean)
	b.BackgroundColor3 = if on then W.ACCENT else W.BG2
end

-- right-side layout shared by both panels: one UI scale for both, and their right offsets
function W.layout(showRadar: boolean, showMap: boolean): (number, number, number)
	local cam = Workspace.CurrentCamera
	local vp = if cam then cam.ViewportSize else Vector2.new(1280, 720)
	local needW = 0
	if showRadar then
		needW += W.RADAR_W + W.GAP
	end
	if showMap then
		needW += W.MAP_W + W.GAP
	end
	local s = 1
	s = math.min(s, (vp.Y - 2 * W.GAP) / (math.max(W.RADAR_H, W.MAP_H)))
	if needW > 0 then
		s = math.min(s, (vp.X - W.LEFT_RESERVED - W.GAP) / needW)
	end
	s = math.clamp(s * 1.0, 0.45, 1.25)
	local radarRight = W.GAP
	local mapRight = if showRadar then W.GAP + (W.RADAR_W + W.GAP) * s else W.GAP
	return s, radarRight, mapRight
end

-- RGBA bytes packed little-endian into one u32 (r, g, b, a byte order in the buffer)
function W.pack(r: number, g: number, b: number): number
	return bit32.bor(r, bit32.lshift(g, 8), bit32.lshift(b, 16), 0xFF000000)
end

function W.pack01(r: number, g: number, b: number): number
	return W.pack(math.clamp(math.floor(r * 255 + 0.5), 0, 255), math.clamp(math.floor(g * 255 + 0.5), 0, 255), math.clamp(math.floor(b * 255 + 0.5), 0, 255))
end

-- A colour ramp from stops { {value, r, g, b} } (r, g, b in 0..1, values ascending):
-- returns a function(v) -> r, g, b (0..1), clamped at the ends.
function W.ramp(stops: { { number } }): (number) -> (number, number, number)
	local n = #stops
	return function(v: number): (number, number, number)
		if v <= stops[1][1] then
			local s = stops[1]
			return s[2], s[3], s[4]
		end
		for i = 2, n do
			local b = stops[i]
			if v < b[1] then
				local a = stops[i - 1]
				local f = (v - a[1]) / (b[1] - a[1])
				return a[2] + (b[2] - a[2]) * f, a[3] + (b[3] - a[3]) * f, a[4] + (b[4] - a[4]) * f
			end
		end
		local s = stops[n]
		return s[2], s[3], s[4]
	end
end

-- A legend bar: `count` flat swatches of colourFn over [vmin, vmax] (works for stepped
-- tables too), with tick labels. Returns the holder frame (rebuilt by calling again).
function W.legend(parent: Instance, x: number, y: number, w: number, h: number, colourFn: (number) -> (number, number, number), vmin: number, vmax: number, ticks: { number }, fmt: (number) -> string, unit: string, old: Instance?): Frame
	if old then
		old:Destroy()
	end
	local holder = Instance.new("Frame")
	holder.BackgroundTransparency = 1
	holder.Position = UDim2.fromOffset(x, y)
	holder.Size = UDim2.fromOffset(w, h + 14)
	holder.Parent = parent
	local count = 48
	local barW = w - 52
	for i = 0, count - 1 do
		local v = vmin + (i + 0.5) / count * (vmax - vmin)
		local r, g, b = colourFn(v)
		local f = Instance.new("Frame")
		f.BorderSizePixel = 0
		f.BackgroundColor3 = Color3.new(r, g, b)
		f.Position = UDim2.fromOffset(math.floor(i * barW / count), 0)
		f.Size = UDim2.fromOffset(math.ceil(barW / count) + 1, h)
		f.Parent = holder
	end
	for _, t in ticks do
		local fx = (t - vmin) / (vmax - vmin)
		local l = W.label(holder, fmt(t), math.floor(fx * barW) - 20, h, 40, 13, 11, Enum.TextXAlignment.Center)
		l.TextColor3 = W.DIM
	end
	local u = W.label(holder, unit, barW + 6, -1, 46, h + 2, 12, Enum.TextXAlignment.Left)
	u.TextColor3 = W.DIM
	return holder
end

-- A line in a square overlay, in Scale units (0..1 both ways); returns nothing, edits `f`.
function W.placeLine(f: GuiObject, x0: number, y0: number, x1: number, y1: number, thick: number)
	local dx, dy = x1 - x0, y1 - y0
	local len = math.sqrt(dx * dx + dy * dy)
	f.AnchorPoint = Vector2.new(0.5, 0.5)
	f.Position = UDim2.fromScale((x0 + x1) * 0.5, (y0 + y1) * 0.5)
	f.Size = UDim2.new(len, 1, 0, thick)
	f.Rotation = math.deg(math.atan2(dy, dx))
end

-- Clip the segment to [lo, hi]^2 (Liang-Barsky). Returns the clipped ends or nil.
function W.clip(x0: number, y0: number, x1: number, y1: number, lo: number, hi: number): (number?, number?, number?, number?)
	local t0, t1 = 0, 1
	local dx, dy = x1 - x0, y1 - y0
	local p = { -dx, dx, -dy, dy }
	local q = { x0 - lo, hi - x0, y0 - lo, hi - y0 }
	for i = 1, 4 do
		if p[i] == 0 then
			if q[i] < 0 then
				return nil
			end
		else
			local t = q[i] / p[i]
			if p[i] < 0 then
				if t > t1 then
					return nil
				end
				if t > t0 then
					t0 = t
				end
			else
				if t < t0 then
					return nil
				end
				if t < t1 then
					t1 = t
				end
			end
		end
	end
	return x0 + dx * t0, y0 + dy * t0, x0 + dx * t1, y0 + dy * t1
end

-- A pool of GuiObjects made by `make(parent)`: begin() before a redraw, take() each, finish()
-- hides the unused ones.
function W.pool(parent: Instance, make: (Instance) -> GuiObject)
	local p = { items = {}, used = 0 }
	function p:begin()
		self.used = 0
	end
	function p:take(): any
		self.used += 1
		local it = self.items[self.used]
		if not it then
			it = make(parent)
			self.items[self.used] = it
		end
		it.Visible = true
		return it
	end
	function p:finish()
		for i = self.used + 1, #self.items do
			local it = self.items[i]
			if it.Visible then
				it.Visible = false
			end
		end
	end
	return p
end

-- A square pixel canvas of n x n (an EditableImage), or fallbackN x fallbackN Frames if the
-- image can't be made. Paint into c.pix (u32 per pixel, index (px + py * c.n) * 4) through
-- c:put, mark rows dirty, and c:flush() writes the dirty row blocks.
function W.canvas(parent: GuiObject, n: number, fallbackN: number, bg: number, resample: Enum.ResamplerMode?)
	local c = { ok = false }
	local okMade, img = pcall(function()
		return AssetService:CreateEditableImage({ Size = Vector2.new(n, n) })
	end)
	local label: ImageLabel? = nil
	if okMade and img then
		local l = Instance.new("ImageLabel")
		l.Name = "Canvas"
		l.BackgroundTransparency = 1
		l.Size = UDim2.fromScale(1, 1)
		l.ResampleMode = resample or Enum.ResamplerMode.Default
		local okSet = pcall(function()
			l.ImageContent = Content.fromObject(img)
		end)
		if okSet then
			l.Parent = parent
			label = l
			c.ok = true
			c.image = img
		else
			l:Destroy()
			pcall(function()
				img:Destroy()
			end)
		end
	end
	if not c.ok then
		n = fallbackN
	end
	c.n = n
	c.pix = buffer.create(n * n * 4)
	c.blank = buffer.create(n * n * 4)
	for i = 0, n * n - 1 do
		buffer.writeu32(c.blank, i * 4, bg)
	end
	buffer.copy(c.pix, 0, c.blank, 0)
	c.label = label
	local BLOCK = if c.ok then 32 else 8
	local nBlocks = math.ceil(n / BLOCK)
	c.dirty = table.create(nBlocks, true)
	local scratch = {}
	local cells, shown
	if not c.ok then
		-- fallback: a grid of Frames, one per cell
		local holder = Instance.new("Frame")
		holder.Name = "CanvasCells"
		holder.BackgroundTransparency = 1
		holder.Size = UDim2.fromScale(1, 1)
		holder.Parent = parent
		cells = table.create(n * n)
		shown = table.create(n * n, -1)
		for py = 0, n - 1 do
			for px = 0, n - 1 do
				local f = Instance.new("Frame")
				f.BorderSizePixel = 0
				f.Position = UDim2.fromScale(px / n, py / n)
				f.Size = UDim2.new(1 / n, 1, 1 / n, 1)
				f.Parent = holder
				cells[px + py * n + 1] = f
			end
		end
		c.holder = holder
	end
	function c:put(i: number, col: number)
		buffer.writeu32(self.pix, i * 4, col)
	end
	function c:markRow(py: number)
		self.dirty[py // BLOCK + 1] = true
	end
	function c:markAll()
		for b = 1, nBlocks do
			self.dirty[b] = true
		end
	end
	function c:clear()
		buffer.copy(self.pix, 0, self.blank, 0)
		self:markAll()
	end
	-- write dirty blocks; budgetEnd (os.clock) limits the Frame fallback
	function c:flush(budgetEnd: number?)
		for b = 1, nBlocks do
			if self.dirty[b] then
				local y0 = (b - 1) * BLOCK
				local rows = math.min(BLOCK, n - y0)
				if self.ok then
					local s = scratch[rows]
					if not s then
						s = buffer.create(n * rows * 4)
						scratch[rows] = s
					end
					buffer.copy(s, 0, self.pix, y0 * n * 4, n * rows * 4)
					local okW = pcall(function()
						self.image:WritePixelsBuffer(Vector2.new(0, y0), Vector2.new(n, rows), s)
					end)
					if not okW then
						return
					end
					self.dirty[b] = false
				else
					if budgetEnd and os.clock() > budgetEnd then
						return
					end
					for i = y0 * n, (y0 + rows) * n - 1 do
						local v = buffer.readu32(self.pix, i * 4)
						if shown[i + 1] ~= v then
							shown[i + 1] = v
							local r = bit32.band(v, 255)
							local g = bit32.band(bit32.rshift(v, 8), 255)
							local bb = bit32.band(bit32.rshift(v, 16), 255)
							cells[i + 1].BackgroundColor3 = Color3.fromRGB(r, g, bb)
						end
					end
					self.dirty[b] = false
				end
			end
		end
	end
	function c:destroy()
		if self.image then
			pcall(function()
				self.image:Destroy()
			end)
		end
		if self.label then
			self.label:Destroy()
		end
		if self.holder then
			self.holder:Destroy()
		end
	end
	return c
end

return W
