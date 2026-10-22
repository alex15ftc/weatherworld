--!strict
-- What every layer of the weather screen (Products/init.luau) has. A layer draws one kind of
-- product over the map, shows its options in the side panel while it is turned on, and answers
-- a click on the map with the details of what is there.

local MapCanvas = require(script.Parent.MapCanvas)

export type Detail = {
	title: string,
	subtitle: string?,
	body: string,
	colour: { number }?,
	-- Which item it is (the layer outlines it while its details are open).
	layer: string,
	item: string,
}

-- What the screen gives each layer.
export type Context = {
	-- Draw the map again (the layer's product or options changed).
	redraw: () -> (),
	-- Open an item's details in the side panel.
	showDetail: (Detail) -> (),
	-- The item whose details are open, if it is this layer's ("" when none).
	selected: (layerKey: string) -> string,
	-- Whether another layer is turned on.
	isOn: (layerKey: string) -> boolean,
}

export type Layer = {
	key: string,
	name: string,
	enabled: boolean,
	-- Shown under the layer buttons while the layer is on.
	options: Frame,
	-- Whether a product id is one this layer draws from.
	wants: (self: any, id: string) -> boolean,
	-- Fetch what it draws (yields) and rebuild its options.
	refresh: (self: any) -> (),
	-- Shapes, drawn into the map's product tiles (sharp at every zoom).
	draw: (self: any, draw: MapCanvas.Draw) -> (),
	-- Raster products (radar), drawn into one image of the view under the shapes (optional).
	drawRaster: ((self: any, draw: MapCanvas.Draw) -> ())?,
	labels: (self: any, labels: MapCanvas.Labels) -> (),
	-- The details of what is at a map point, if anything (milesPerPixel: the zoom).
	hit: (self: any, mx: number, my: number, milesPerPixel: number) -> Detail?,
	-- Its legend lines, if it has any.
	legend: (self: any, parent: Instance) -> (),
	-- Turned on or off (optional extra work).
	setEnabled: (self: any, on: boolean) -> (),
}

return {}
