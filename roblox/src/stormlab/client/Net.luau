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
		precip = get(R.precip), precipLite = get(R.precipLite), flash = get(R.flash), event = get(R.event), command = get(R.command), hello = get(R.hello),
	}
	ctx.net = net
	local cw = ctx.cw
	local ClientWorld = ctx.Sim.ClientWorld
	net.profiles.OnClientEvent:Connect(function(list)
		ClientWorld.applyProfiles(cw, list)
		ctx.signals.profiles:Fire(list)
	end)
	-- (ctx.frameFed, the game: the storms are built on the client from the engine's shared numbers -
	-- client/FrameWorld - so this server's own storms, tornadoes, cold pool and rain are not taken;
	-- its clock, settings and time of day still are)
	net.state.OnClientEvent:Connect(function(snap, settings)
		if ctx.frameFed then
			cw.clockUtc = snap.clockUtc
			cw.env.clockUtc = snap.clockUtc
		else
			ClientWorld.applySnapshot(cw, snap)
		end
		ctx:noteServerTime(snap.time)
		if settings then
			ctx.state.timeScale = settings.timeScale
			ctx.state.paused = settings.paused
			ctx.serverSettings = settings
		end
		ctx.signals.snapshot:Fire(snap)
	end)
	-- tornadoes arrive one a message (the unreliable remote's size limit): merged by id, and a
	-- tornado not heard from for 1.5 s is gone from the list
	local heard = {}
	net.tornado.OnClientEvent:Connect(function(list, time)
		if ctx.frameFed then
			if time then ctx:noteServerTime(time) end
			return
		end
		local now = os.clock()
		for _, t in list do
			-- (stamped with its server time: Tornado/StateAdapter extrapolates from it; one older
			-- than what we have - the unreliable remote may reorder - is dropped, unless far older:
			-- a new scenario restarted the clock)
			t.simAt = time
			local h = heard[t.id]
			local was = h and h.t.simAt
			if not (time and was and time < was and time > was - 60) then
				heard[t.id] = { t = t, at = now }
			end
		end
		local merged = {}
		for id, h in heard do
			if now - h.at > 1.5 then
				heard[id] = nil
			else
				table.insert(merged, h.t)
			end
		end
		ClientWorld.applyTornadoes(cw, merged)
		if time then
			ctx:noteServerTime(time)
		end
		ctx.signals.tornado:Fire(merged)
	end)
	net.coldPool.OnClientEvent:Connect(function(b)
		if ctx.frameFed then return end
		ClientWorld.applyColdPool(cw, b)
		ctx.signals.coldPool:Fire()
	end)
	net.precip.OnClientEvent:Connect(function(b)
		if ctx.frameFed then return end
		ClientWorld.applyPrecip(cw, b)
		ctx.signals.precip:Fire()
	end)
	net.precipLite.OnClientEvent:Connect(function(b)
		if ctx.frameFed then return end
		ClientWorld.applyPrecipLite(cw, b)
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
