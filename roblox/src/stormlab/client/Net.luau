--!nonstrict
-- The client side of the lab's replication: listens to the server's remotes and feeds the
-- ClientWorld and the context's signals.
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Net = {}

function Net.connect(ctx: any)
	local C = ctx.Config
	local folder = ReplicatedStorage:WaitForChild(C.NET_FOLDER)
	local R = C.REMOTES
	local function get(name: string): any
		return folder:WaitForChild(name)
	end
	local net = {
		state = get(R.state), profiles = get(R.profiles), tornado = get(R.tornado), coldPool = get(R.coldPool),
		precip = get(R.precip), flash = get(R.flash), event = get(R.event), command = get(R.command), hello = get(R.hello),
	}
	ctx.net = net
	local cw = ctx.cw
	local ClientWorld = ctx.Sim.ClientWorld
	net.profiles.OnClientEvent:Connect(function(list)
		ClientWorld.applyProfiles(cw, list)
		ctx.signals.profiles:Fire(list)
	end)
	net.state.OnClientEvent:Connect(function(snap, settings)
		ClientWorld.applySnapshot(cw, snap)
		ctx:noteServerTime(snap.time)
		if settings then
			ctx.state.timeScale = settings.timeScale
			ctx.state.paused = settings.paused
			ctx.serverSettings = settings
		end
		ctx.signals.snapshot:Fire(snap)
	end)
	net.tornado.OnClientEvent:Connect(function(list, time)
		ClientWorld.applyTornadoes(cw, list)
		if time then
			ctx:noteServerTime(time)
		end
		ctx.signals.tornado:Fire(list)
	end)
	net.coldPool.OnClientEvent:Connect(function(b)
		ClientWorld.applyColdPool(cw, b)
		ctx.signals.coldPool:Fire()
	end)
	net.precip.OnClientEvent:Connect(function(b)
		ClientWorld.applyPrecip(cw, b)
		ctx.signals.precip:Fire()
	end)
	net.flash.OnClientEvent:Connect(function(list)
		for _, f in list do
			ctx.signals.flash:Fire(f)
		end
	end)
	net.event.OnClientEvent:Connect(function(e)
		ctx.signals.event:Fire(e)
	end)
	return net
end

return Net
