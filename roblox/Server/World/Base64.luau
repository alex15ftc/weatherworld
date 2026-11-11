--!strict
-- Decodes base64 text (the generated world data) into a buffer.

local Base64 = {}

local VALUES = {}
do
	local alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	for i = 1, 64 do
		VALUES[string.byte(alphabet, i)] = i - 1
	end
	VALUES[string.byte("=")] = 0
end

function Base64.decode(text: string): buffer
	local len = #text
	local pad = if string.sub(text, -2) == "==" then 2 elseif string.sub(text, -1) == "=" then 1 else 0
	local size = len // 4 * 3 - pad
	local out = buffer.create(size)
	local o = 0
	for i = 1, len, 4 do
		local a, b, c, d = string.byte(text, i, i + 3)
		local v = VALUES[a] * 262144 + VALUES[b] * 4096 + VALUES[c] * 64 + VALUES[d]
		buffer.writeu8(out, o, v // 65536)
		if o + 1 < size then
			buffer.writeu8(out, o + 1, (v // 256) % 256)
		end
		if o + 2 < size then
			buffer.writeu8(out, o + 2, v % 256)
		end
		o += 3
	end
	return out
end

return Base64
