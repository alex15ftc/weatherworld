--!nonstrict
-- JSON decoding for the lab's engine data. Uses HttpService inside Roblox; a small pure decoder
-- otherwise (the offline tests run in the plain Luau command line).
local Json = {}

local function pureDecode(s: string): any
	local pos = 1
	local value: () -> any
	local function ws()
		pos = string.find(s, "[^ \t\r\n]", pos) or #s + 1
	end
	local function str(): string
		local out = {}
		pos += 1
		while true do
			local c = string.sub(s, pos, pos)
			if c == '"' then
				pos += 1
				break
			elseif c == "\\" then
				local e = string.sub(s, pos + 1, pos + 1)
				local map = { n = "\n", t = "\t", r = "\r", b = "\b", f = "\f" }
				if e == "u" then
					table.insert(out, utf8.char(tonumber(string.sub(s, pos + 2, pos + 5), 16) :: number))
					pos += 6
				else
					table.insert(out, map[e] or e)
					pos += 2
				end
			else
				local stop = string.find(s, '["\\]', pos) :: number
				table.insert(out, string.sub(s, pos, stop - 1))
				pos = stop
			end
		end
		return table.concat(out)
	end
	value = function(): any
		ws()
		local c = string.sub(s, pos, pos)
		if c == "{" then
			local t = {}
			pos += 1
			ws()
			if string.sub(s, pos, pos) == "}" then
				pos += 1
				return t
			end
			while true do
				ws()
				local k = str()
				ws()
				pos += 1 -- :
				t[k] = value()
				ws()
				local d = string.sub(s, pos, pos)
				pos += 1
				if d == "}" then
					return t
				end
			end
		elseif c == "[" then
			local t = {}
			pos += 1
			ws()
			if string.sub(s, pos, pos) == "]" then
				pos += 1
				return t
			end
			while true do
				table.insert(t, value())
				ws()
				local d = string.sub(s, pos, pos)
				pos += 1
				if d == "]" then
					return t
				end
			end
		elseif c == '"' then
			return str()
		elseif string.sub(s, pos, pos + 3) == "true" then
			pos += 4
			return true
		elseif string.sub(s, pos, pos + 4) == "false" then
			pos += 5
			return false
		elseif string.sub(s, pos, pos + 3) == "null" then
			pos += 4
			return nil
		else
			local a, b = string.find(s, "^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
			pos = (b :: number) + 1
			return tonumber(string.sub(s, a :: number, b :: number))
		end
	end
	return value()
end

function Json.decode(s: string): any
	local ok, HttpService = pcall(function()
		return (game :: any):GetService("HttpService")
	end)
	if ok and HttpService then
		return HttpService:JSONDecode(s)
	end
	return pureDecode(s)
end

return Json
