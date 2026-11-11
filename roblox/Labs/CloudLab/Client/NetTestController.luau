--!strict
-- The client half of the Studio network tests (NetTestService): checks each frame
-- buffer it is sent, unpacks one, and measures what arrives against a quiet baseline.

local NetTestController = {}

function NetTestController.Start()
	if workspace:GetAttribute("NetTest") ~= true then return end

	local ReplicatedStorage = game:GetService("ReplicatedStorage")
	local EncodingService = game:GetService("EncodingService")
	local Stats = game:GetService("Stats")

	local CloudLabNet = require(ReplicatedStorage.Shared.Net.CloudLabNet)
	local event = CloudLabNet.NetTestFrames:Client()
	local plan = ReplicatedStorage:WaitForChild("NetTestPlan", 60) :: Configuration
	if not plan then warn("[NetTest] client: the test plan never arrived"); return end

	local function fnv(b: buffer): number
		local h = 0x811c9dc5
		for i = 0, buffer.len(b) - 1 do
			h = bit32.bxor(h, buffer.readu8(b, i))
			h = (bit32.band(h, 0xffff) * 16777619 + bit32.lshift(bit32.rshift(h, 16) * 16777619 % 0x10000, 16)) % 0x100000000
		end
		return h
	end

	-- The whole client's receive rate (Stats, KB/s), sampled each second, in the current phase.
	local phase = "wait"
	local samples: { [string]: { number } } = { baseline = {}, frames = {} }
	local statsOk = true
	task.spawn(function()
		while phase ~= "done" do
			if samples[phase] then
				local ok, kbps = pcall(function() return Stats.DataReceiveKbps end)
				if ok then table.insert(samples[phase], kbps) else statsOk = false end
			end
			task.wait(1)
		end
	end)

	local got, gotBytes, bad, decodedOk, startedAt = 0, 0, 0, nil :: boolean?, 0
	event:On(function(kind: string, storm: number?, frame: buffer?)
		if kind == "baseline" then phase = "baseline"
		elseif kind == "start" then phase = "frames"; startedAt = os.clock()
		elseif kind == "frame" and frame then
			got += 1; gotBytes += buffer.len(frame)
			if buffer.len(frame) ~= plan:GetAttribute("zstLength") or fnv(frame) ~= plan:GetAttribute("zstHash") then bad += 1 end
			if decodedOk == nil then
				local ok, out = pcall(function() return EncodingService:DecompressBuffer(frame, Enum.CompressionAlgorithm.Zstd) end)
				decodedOk = ok and buffer.len(out) == plan:GetAttribute("rawLength") and fnv(out) == plan:GetAttribute("rawHash")
				if not ok then warn("[NetTest] client decompress failed: " .. tostring(out)) end
			end
		elseif kind == "done" then
			local seconds = os.clock() - startedAt
			phase = "done"
			local function mean(t: { number }): number local s = 0 for _, v in t do s += v end return #t > 0 and s / #t or 0 end
			local base, during = mean(samples.baseline), mean(samples.frames)
			print(("[NetTest] %s client buffers: %d received, %d damaged, %d bytes"):format(bad == 0 and got > 0 and "PASS" or "FAIL", got, bad, gotBytes))
			print(("[NetTest] %s client zstd decompress of a received frame"):format(decodedOk and "PASS" or "FAIL"))
			print(("[NetTest] payload %.2f KB/s over %.0f s (%d storms, a frame each every %.1f s)"):format(gotBytes / 1024 / seconds, seconds, plan:GetAttribute("storms") :: number, plan:GetAttribute("everyS") :: number))
			if statsOk then
				print(("[NetTest] Stats.DataReceiveKbps: baseline %.2f, with frames %.2f, difference %.2f (budget about 4 KB/s for 10 storms)"):format(base, during, during - base))
			else
				print("[NetTest] Stats.DataReceiveKbps cannot be read from a script here")
			end
		end
	end)
	CloudLabNet.NetTestReady:Client():Fire()
	print("[NetTest] client ready")
end

return NetTestController
