-- A 250 m nest on its own process (NestRemote), served on localhost for the box's process
-- (nestlink.luau). It builds a mirror of the box from the same start (EngineRun.new), takes the
-- box's region around the nest each box step, steps the nest across it and returns the feedback
-- as a correction.
--   lune run tools/cloudlab/worker/nest_worker.luau <port> <token>
-- (the token is the link's: /ping answers it, so a link never talks to a stray process on the port)
-- POST /init {record, opts}; POST /create (meta, region); POST /step (meta, old?, new) returns at
-- once; GET /reply waits for that step and returns (reply, correction, nest frame section).
local net = require("@lune/net")
local serde = require("@lune/serde")
local process = require("@lune/process")
local task = require("@lune/task")
local stdio = require("@lune/stdio")
local fs = require("@lune/fs")
-- NEST_DEBUG = a file: each request and step is logged there
local DEBUG = process.env.NEST_DEBUG
local logText = ""
local function log(line: string)
	if DEBUG then
		logText ..= line .. string.char(10)
		fs.writeFile(DEBUG, logText)
	end
end
local EngineRun = require("../../../roblox/Shared/CloudModel/EngineRun")
local NestRemote = require("../../../roblox/Shared/CloudModel/NestRemote")
local NestLink = require("./nestlink")

local port = tonumber(process.args[1]) or 8890
local token = process.args[2] or ""

-- (this machine slows normal-priority processes after a few seconds: raise this one)
pcall(function()
	process.exec("powershell", { "-NoProfile", "-Command", "$p = (Get-CimInstance Win32_Process -Filter \"ProcessId=$PID\").ParentProcessId; (Get-Process -Id $p).PriorityClass = 'AboveNormal'" })
end)

local helper: any = nil
local pending: any = nil
local reply: string? = nil
local running = true

local function ok(body: string?)
	return { status = 200, headers = { ["content-type"] = "application/octet-stream" }, body = body or "ok" }
end

-- (a nest process whose box process has gone - crashed or killed - would hold its port for good:
-- with no request for IDLE seconds once the nest is stepping, it exits)
local IDLE = 120
local lastRequest = os.time()

local server = net.serve(port, function(req)
	lastRequest = os.time()
	local path, method = req.path, req.method
	if DEBUG then
		log(string.format("%s %s at %.2f", method, path, os.clock()))
	end
	if path == "/ping" then
		return ok(token)
	elseif method == "POST" and path == "/init" then
		local b = serde.decode("json", req.body)
		helper = NestRemote.helper(EngineRun.new(b.record, b.opts).model)
		return ok()
	elseif method == "POST" and path == "/create" then
		local meta, parts = NestLink.unframe(req.body)
		NestRemote.create(helper, meta, parts[1] :: buffer)
		return ok()
	elseif method == "POST" and path == "/step" then
		local meta, parts = NestLink.unframe(req.body)
		pending, reply = { meta = meta, old = parts[1], new = parts[2] }, nil
		return ok()
	elseif method == "GET" and path == "/reply" then
		local t0 = os.time()
		while not reply do
			if not pending or os.time() - t0 > 60 then
				return { status = 409, body = if pending then "step not done in 60 s" else "no step pending" }
			end
			task.wait()
		end
		local r = reply
		reply = nil
		return ok(r)
	elseif method == "POST" and path == "/stop" then
		-- (the server would keep answering after the step loop ends: exit instead)
		running = false
		task.delay(0.05, function()
			process.exit(0)
		end)
		return ok()
	end
	return { status = 404, body = "unknown " .. method .. " " .. path }
end)

while running do
	if pending then
		local p = pending
		local t0 = os.clock()
		local okStep, meta, delta, frame = pcall(NestRemote.step, helper, p.meta, p.old, p.new :: buffer)
		if not okStep then
			-- (an error here would end this loop but leave the server answering: say so and exit)
			stdio.ewrite("[nest] step failed: " .. tostring(meta) .. "\n")
			log("step failed: " .. tostring(meta))
			process.exit(1)
		end
		if DEBUG then
			log(string.format("step %.0f ms", 1000 * (os.clock() - t0)))
		end
		reply = NestLink.frame(meta, { delta, frame }, 2)
		pending = nil
		task.wait()
	else
		task.wait(0.001)
		if helper and helper.nest and os.time() - lastRequest > IDLE then
			running = false
		end
	end
end
server:stop()
process.exit(0)
