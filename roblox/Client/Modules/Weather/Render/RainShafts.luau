--!nonstrict
-- Rain and hail shafts as billboards (CloudParts/Shafts: curtains slanting with the storm-relative
-- wind, opacity from the optical depth of the rain, capped by the rain cloud). Re-binned when the
-- server sends a new precipitation volume; hidden with the "rain" layer.
-- Debug attribute on ctx.root: CloudShafts (shafts drawn).
local Parts = script.Parent:WaitForChild("CloudParts")
local Util = require(Parts:WaitForChild("Util"))
local Shafts = require(Parts:WaitForChild("Shafts"))

local RainShafts = {}

function RainShafts.new(ctx: any): any
	Util.init(ctx.Sim)
	local self = {}
	local D = ctx.Config.LIMITS.farDraw
	local shafts = Shafts.new(ctx)
	shafts.t0 = ctx:simTime()
	local connections = {}
	local statAt = -math.huge
	table.insert(connections, ctx.signals.precip:Connect(function()
		shafts.dirty = true
		shafts.t0 = ctx:simTime()
	end))
	table.insert(connections, ctx.signals.scenario:Connect(function()
		shafts:hide()
		shafts.dirty = true
	end))

	function self:update(_dt: number)
		local t0 = os.clock()
		local n = 0
		if ctx.state.show.rain ~= false then
			n = shafts:draw(ctx.camera.CFrame.Position, ctx:simTime(), D)
		elseif shafts.count > 0 then
			shafts:hide()
		end
		if t0 - statAt > 0.5 then
			statAt = t0
			ctx.root:SetAttribute("CloudShafts", n)
		end
	end

	function self:destroy()
		for _, c in connections do
			c:Disconnect()
		end
		shafts:destroy()
	end

	return self
end

return RainShafts
