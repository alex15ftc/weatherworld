--!strict
-- Keyboard and gamepad turned into driving controls (from Rally With Your Friends'
-- RacePlace/Client/Modules/InputState). Both are read every frame and the strongest wins, so a
-- player can switch devices while driving.
--
-- Keyboard: W/S or the arrows to drive and brake (S reverses once stopped), A/D to steer, Space
-- for the hand brake. Gamepad: left stick steers, right trigger drives, left trigger brakes,
-- A is the hand brake.

local UserInputService = game:GetService("UserInputService")

local Input = {}

export type Controls = {
	Steer: number, -- -1 (left) .. 1 (right)
	Throttle: number, -- 0..1
	Brake: number, -- 0..1
	Handbrake: boolean,
	Raw: boolean, -- steering is absolute (a racing wheel): skip the assists
}

local STICK_DEADZONE = 0.09
local TRIGGER_DEADZONE = 0.04
local PAD = Enum.UserInputType.Gamepad1

local function keyDown(...: Enum.KeyCode): boolean
	for _, key in { ... } do
		if UserInputService:IsKeyDown(key) then
			return true
		end
	end
	return false
end

-- Rescale past the deadzone, then soften the centre for fine corrections.
local function shapeStick(x: number): number
	local mag = math.abs(x)
	if mag < STICK_DEADZONE then
		return 0
	end
	local t = (mag - STICK_DEADZONE) / (1 - STICK_DEADZONE)
	return math.sign(x) * (0.35 * t + 0.65 * t * t)
end

function Input.read(): Controls
	local padSteer, padThrottle, padBrake, padHandbrake = 0, 0, 0, false
	if UserInputService.GamepadEnabled then
		for _, state in UserInputService:GetGamepadState(PAD) do
			local key = state.KeyCode
			if key == Enum.KeyCode.Thumbstick1 then
				padSteer = shapeStick(state.Position.X)
			elseif key == Enum.KeyCode.ButtonR2 and state.Position.Z > TRIGGER_DEADZONE then
				padThrottle = state.Position.Z
			elseif key == Enum.KeyCode.ButtonL2 and state.Position.Z > TRIGGER_DEADZONE then
				padBrake = state.Position.Z
			end
		end
		padHandbrake = UserInputService:IsGamepadButtonDown(PAD, Enum.KeyCode.ButtonA)
	end

	local keySteer = (if keyDown(Enum.KeyCode.D, Enum.KeyCode.Right) then 1 else 0)
		- (if keyDown(Enum.KeyCode.A, Enum.KeyCode.Left) then 1 else 0)
	local steer = if math.abs(padSteer) > math.abs(keySteer) then padSteer else keySteer

	return {
		Steer = math.clamp(steer, -1, 1),
		Throttle = math.clamp(math.max(if keyDown(Enum.KeyCode.W, Enum.KeyCode.Up) then 1 else 0, padThrottle), 0, 1),
		Brake = math.clamp(math.max(if keyDown(Enum.KeyCode.S, Enum.KeyCode.Down) then 1 else 0, padBrake), 0, 1),
		Handbrake = keyDown(Enum.KeyCode.Space) or padHandbrake,
		Raw = false,
	}
end

return Input
