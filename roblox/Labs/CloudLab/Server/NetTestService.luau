--!strict
-- The Studio network tests (docs/cloudlab/NETWORK.md, "Tests before building on this", 1 and 2).
-- Runs only when workspace has the attribute NetTest = true, with tools/cloudlab/worker/nettest.mjs
-- serving on port 8792 (and "Allow HTTP Requests" on in the game settings).
--   1. HttpService RequestAsync: 256 bytes 0-255 compared byte for byte; a real frame raw and
--      Zstd-compressed, the compressed one unpacked with EncodingService and compared to the raw.
--   2. The compressed frame sent to each client as a RemoteEvent buffer, ten storms' worth every
--      7.5 s (one frame a storm every 60 game seconds at the 8x clock), for 45 s after a 10 s
--      quiet baseline; the client (NetTest.client.luau) checks and measures it.

local NetTestService = {}

function NetTestService.Start()
	if workspace:GetAttribute("NetTest") ~= true then return end

	local HttpService = game:GetService("HttpService")
	local EncodingService = game:GetService("EncodingService")
	local Players = game:GetService("Players")
	local ReplicatedStorage = game:GetService("ReplicatedStorage")

	local BASE = "http://127.0.0.1:8792"
	local STORMS, EVERY_S, BASELINE_S, SEND_S = 10, 7.5, 10, 45

	local function fnv(b: buffer): number
		local h = 0x811c9dc5
		for i = 0, buffer.len(b) - 1 do
			h = bit32.bxor(h, buffer.readu8(b, i))
			-- (h * 16777619) mod 2^32, without losing digits to doubles
			h = (bit32.band(h, 0xffff) * 16777619 + bit32.lshift(bit32.rshift(h, 16) * 16777619 % 0x10000, 16)) % 0x100000000
		end
		return h
	end

	local function get(path: string): (boolean, string)
		local ok, res = pcall(function()
			return HttpService:RequestAsync({ Url = BASE .. path, Method = "GET" })
		end)
		if not ok then return false, tostring(res) end
		if not res.Success then return false, ("HTTP %d"):format(res.StatusCode) end
		return true, res.Body
	end

	local function report(name: string, pass: boolean, detail: string)
		print(("[NetTest] %s %s: %s"):format(pass and "PASS" or "FAIL", name, detail))
	end

	-- (a moment first, so a tool reading the output is attached before anything is printed)
	task.wait(5)
	print("[NetTest] HttpEnabled =", HttpService.HttpEnabled)
	local ok, infoText = get("/info")
	if not ok then
		report("info", false, infoText)
		return
	end
	local info = HttpService:JSONDecode(infoText)

	-- 1a. 256 bytes 0-255.
	do
		local okB, body = get("/bytes")
		if not okB then report("bytes", false, body) else
			local b = buffer.fromstring(body)
			local wrong, first = 0, -1
			for i = 0, 255 do
				if i >= buffer.len(b) or buffer.readu8(b, i) ~= i then wrong += 1; if first < 0 then first = i end end
			end
			report("bytes 0-255", buffer.len(b) == 256 and wrong == 0, ("length %d (want 256), %d wrong, first wrong at %d"):format(buffer.len(b), wrong, first))
		end
	end

	-- 1b. The raw frame.
	local raw: buffer? = nil
	do
		local okR, body = get("/frame.raw")
		if not okR then report("frame raw", false, body) else
			raw = buffer.fromstring(body)
			local h = fnv(raw :: buffer)
			report("frame raw", buffer.len(raw :: buffer) == info.rawLength and h == info.rawHash, ("%d bytes (want %d), hash %08x (want %08x)"):format(buffer.len(raw :: buffer), info.rawLength, h, info.rawHash))
		end
	end

	-- 1c. The Zstd frame, unpacked with EncodingService.
	local zst: buffer? = nil
	do
		local okZ, body = get("/frame.zst")
		if not okZ then report("frame zstd", false, body) else
			zst = buffer.fromstring(body)
			report("frame zstd download", buffer.len(zst :: buffer) == info.zstLength and fnv(zst :: buffer) == info.zstHash, ("%d bytes (want %d)"):format(buffer.len(zst :: buffer), info.zstLength))
			local t0 = os.clock()
			local okD, out = pcall(function() return EncodingService:DecompressBuffer(zst :: buffer, Enum.CompressionAlgorithm.Zstd) end)
			local ms = (os.clock() - t0) * 1000
			if not okD then report("zstd decompress", false, tostring(out)) else
				local h = fnv(out)
				report("zstd decompress", buffer.len(out) == info.rawLength and h == info.rawHash, ("%d bytes in %.2f ms (want %d), hash %08x (want %08x)"):format(buffer.len(out), ms, info.rawLength, h, info.rawHash))
			end
		end
	end

	-- 2. RemoteEvent buffers to the clients.
	if not zst then return end
	local CloudLabNet = require(ReplicatedStorage.Shared.Net.CloudLabNet)
	local event = CloudLabNet.NetTestFrames:Server() :: any -- (one event, several message shapes)
	local plan = Instance.new("Configuration")
	plan.Name = "NetTestPlan"
	plan:SetAttribute("rawLength", info.rawLength); plan:SetAttribute("rawHash", info.rawHash)
	plan:SetAttribute("zstLength", info.zstLength); plan:SetAttribute("zstHash", info.zstHash)
	plan:SetAttribute("storms", STORMS); plan:SetAttribute("everyS", EVERY_S)
	plan:SetAttribute("baselineS", BASELINE_S); plan:SetAttribute("sendS", SEND_S)
	local ready = false
	CloudLabNet.NetTestReady:Server():On(function() ready = true end)
	plan.Parent = ReplicatedStorage

	local player = Players:GetPlayers()[1] or Players.PlayerAdded:Wait()
	print("[NetTest] client", player.Name, "joined; waiting for it to be ready")
	local waited = 0
	while not ready and waited < 60 do task.wait(0.25); waited += 0.25 end
	if not ready then report("client ready", false, "no word from the client in 60 s"); return end
	event:Fire(player, "baseline")
	task.wait(BASELINE_S)
	event:Fire(player, "start")
	local sent, bytes, startedAt = 0, 0, os.clock()
	while os.clock() - startedAt < SEND_S do
		for s = 1, STORMS do
			event:Fire(player, "frame", s, zst)
			sent += 1; bytes += buffer.len(zst :: buffer)
		end
		task.wait(EVERY_S)
	end
	event:Fire(player, "done")
	print(("[NetTest] sent %d frames, %d bytes of payload in %.0f s (%.2f KB/s of payload)"):format(sent, bytes, os.clock() - startedAt, bytes / 1024 / (os.clock() - startedAt)))
end

return NetTestService
