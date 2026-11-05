--!strict
-- A small JSON reader for the command-line runs (Roblox has HttpService:JSONDecode): objects,
-- arrays, strings (basic escapes), numbers, true / false / null (null -> nil).
local function decode(text: string): any
	local pos = 1
	local value: () -> any
	local function skip()
		pos = string.find(text, "[^%s]", pos) or #text + 1
	end
	local function str(): string
		local out = {}
		pos += 1
		while true do
			local c = string.sub(text, pos, pos)
			if c == '"' then
				pos += 1
				return table.concat(out)
			elseif c == "\\" then
				local e = string.sub(text, pos + 1, pos + 1)
				local map = { n = "\n", t = "\t", r = "\r", b = "\b", f = "\f" }
				if e == "u" then
					table.insert(out, utf8.char(tonumber(string.sub(text, pos + 2, pos + 5), 16) :: number))
					pos += 6
				else
					table.insert(out, map[e] or e)
					pos += 2
				end
			else
				local s2 = string.find(text, '["\]', pos) :: number
				table.insert(out, string.sub(text, pos, s2 - 1))
				pos = s2
			end
		end
	end
	value = function(): any
		skip()
		local c = string.sub(text, pos, pos)
		if c == "{" then
			local t = {}
			pos += 1
			skip()
			if string.sub(text, pos, pos) == "}" then
				pos += 1
				return t
			end
			while true do
				skip()
				local k = str()
				skip()
				pos += 1 -- ':'
				t[k] = value()
				skip()
				local d = string.sub(text, pos, pos)
				pos += 1
				if d == "}" then
					return t
				end
			end
		elseif c == "[" then
			local t = {}
			pos += 1
			skip()
			if string.sub(text, pos, pos) == "]" then
				pos += 1
				return t
			end
			local n = 0
			while true do
				n += 1
				t[n] = value()
				skip()
				local d = string.sub(text, pos, pos)
				pos += 1
				if d == "]" then
					return t
				end
			end
		elseif c == '"' then
			return str()
		elseif string.sub(text, pos, pos + 3) == "true" then
			pos += 4
			return true
		elseif string.sub(text, pos, pos + 4) == "false" then
			pos += 5
			return false
		elseif string.sub(text, pos, pos + 3) == "null" then
			pos += 4
			return nil
		end
		local s1, e1 = string.find(text, "^-?[%d%.eE+-]+", pos)
		assert(s1, "bad JSON at " .. pos)
		pos = (e1 :: number) + 1
		return tonumber(string.sub(text, s1 :: number, e1 :: number))
	end
	return value()
end
return decode
