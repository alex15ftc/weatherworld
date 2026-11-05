-- One detailed storm's cloud model, run beside the weather engine (docs/cloudlab/PLAN.md, phase A).
-- A small local HTTP service: the engine starts the storm, posts each new engine record for it,
-- and fetches its latest frame (FrameCodec). The model keeps pace with the engine's clock: it
-- steps until its time reaches the storm's engine time (the last record's sim hour, run on at the
-- clock rate since it arrived), so a faster machine doesn't run ahead and a slower one reports
-- how far behind it is.
--   lune run tools/cloudlab/worker/worker.luau <port>
-- Endpoints (JSON bodies; localhost only):
--   POST /start   { record, startRows?, opts?, clockRate, frameEvery?, nestProcess? } -> { ok }
--                 record: the storm as /api/game/v1/lab/storms?inflow=1 serves it, plus
--                 simHourUtc; startRows: the sounding where it started (default its inflow);
--                 nestProcess (default true): the 250 m nest runs in its own process on the
--                 next port (nest_worker.luau), so box and nest use two cores
--   POST /update  record (with simHourUtc), or { ended = true } once the engine has ended it
--   GET  /frame   the newest frame (application/octet-stream; header x-frame-seq)
--   GET  /status  { time, simHour, behind (model s), stepMs, seq, ended, nest }
--   POST /stop    stops the worker
local net = require("@lune/net")
local serde = require("@lune/serde")
local process = require("@lune/process")
local task = require("@lune/task")
local EngineRun = require("../../../roblox/src/cloudlab/shared/Model/EngineRun")
local FrameCodec = require("../../../roblox/src/cloudlab/shared/Model/FrameCodec")
local NestLink = require("./nestlink")

local port = tonumber(process.args[1]) or 8790
local run: any = nil
local clockRate = 8 -- game seconds per real second
local frameEvery = 15 -- model seconds between frames
local startHour = 0 -- engine sim hour the run started at
local lastHour, lastClock = 0, os.clock() -- the newest record's sim hour, and when it came
local frame: string? = nil
local seq = 0
local nextFrame = 0
local stepMs = 0
local running = true

local function targetTime(): number
	-- the storm's engine time, in model seconds since the start
	return (lastHour - startHour) * 3600 + (os.clock() - lastClock) * clockRate
end

local function reply(status: number, body: any, ctype: string?)
	return { status = status, headers = { ["content-type"] = ctype or "application/json" }, body = if type(body) == "string" then body else serde.encode("json", body) }
end

local server = net.serve(port, function(req)
	local path, method = req.path, req.method
	if method == "POST" and path == "/start" then
		local body = serde.decode("json", req.body)
		clockRate = body.clockRate or clockRate
		frameEvery = body.frameEvery or frameEvery
		local opts = body.opts or {}
		opts.startRows = body.startRows
		if run and run.nestLink then
			run.nestLink:stop()
		end
		run = EngineRun.new(body.record, opts)
		run.simHour = body.record.simHourUtc
		if opts.nest ~= false and body.nestProcess ~= false then
			run.nestLink = NestLink.start(port + 1, run.initRecord, run.initOpts)
		end
		startHour, lastHour, lastClock = body.record.simHourUtc, body.record.simHourUtc, os.clock()
		seq, nextFrame, frame = 0, 0, nil
		return reply(200, { ok = true })
	elseif method == "POST" and path == "/update" then
		if not run then
			return reply(409, { error = "not started" })
		end
		local body = serde.decode("json", req.body)
		if body.ended then
			run:update(nil)
		else
			run:update(body)
			run.simHour = body.simHourUtc
			lastHour, lastClock = body.simHourUtc, os.clock()
		end
		return reply(200, { ok = true, behind = targetTime() - run.model.time })
	elseif method == "GET" and path == "/frame" then
		if not frame then
			return reply(404, { error = "no frame yet" })
		end
		return { status = 200, headers = { ["content-type"] = "application/octet-stream", ["x-frame-seq"] = tostring(seq) }, body = frame }
	elseif method == "GET" and path == "/status" then
		if not run then
			return reply(200, { started = false })
		end
		return reply(200, { started = true, time = run.model.time, simHour = run.simHour, behind = targetTime() - run.model.time, stepMs = stepMs, seq = seq, ended = run.ended, nest = run.nest ~= nil or run.remote ~= nil, nestProcess = run.nestLink ~= nil })
	elseif method == "POST" and path == "/stop" then
		running = false
		if run and run.nestLink then
			run.nestLink:stop()
		end
		return reply(200, { ok = true })
	end
	return reply(404, { error = "unknown " .. method .. " " .. path })
end)
print(string.format("cloud model worker on port %d", port))

while running do
	if run and run.model.time < targetTime() then
		local t0 = os.clock()
		run:step()
		stepMs = 0.8 * stepMs + 0.2 * 1000 * (os.clock() - t0)
		if run.model.time >= nextFrame then
			nextFrame = run.model.time + frameEvery
			seq += 1
			frame = buffer.tostring(FrameCodec.encode(run, seq))
		end
		task.wait() -- (let the requests in between steps)
	else
		task.wait(0.05)
	end
end
server:stop()
