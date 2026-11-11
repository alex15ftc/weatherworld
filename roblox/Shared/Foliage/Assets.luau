--!strict
-- The generated trees' uploaded assets (tools/blender/foliage_trees.py makes them; uploaded with
-- Open Cloud through Studio's MCP, ids recorded here). Each tree: model, the asset id of its
-- imported model (Roblox's importer makes it a Model of the skinned MeshPart "Tree", a "RootPart"
-- holding the Bones, and one MeshPart "Piece_<bone>" per rig bone, all at their rest places, at a
-- stud a metre: FoliageService scales it; the FBX's embedded atlas comes with it), atlas, a
-- texture id to use instead (0 or nil: the importer's own), and impostor, its 8 billboard views'
-- image ids (view k seen from tree-local (-sin a, 0, -cos a), a = k/8 of a turn).
-- Uploaded 2026-11-11 to user 18865611 (the models from the FBX with leaf back faces; asset
-- 132436526420077, the first test upload, is unused).
-- ready: every tree has its model and views. Until then the chunk generator also builds its old
-- part trees (Server/World/Props/Trees) and the clients draw no skinned trees.
local Assets = {}

Assets.trees = {
	hardwood_1 = { model = 127350487501402, impostor = { 109360322912621, 82753771268592, 120496923222138, 121154702520953, 110198097276102, 94837551871450, 93999203533775, 91014357172538 } },
	hardwood_2 = { model = 128804202412900, impostor = { 79216490167971, 78920059736278, 109788182761165, 117885718545801, 109226098123871, 88054375896285, 119918483854030, 114765732459443 } },
	cottonwood_1 = { model = 128103472740166, impostor = { 135802846593818, 98953712365724, 111814243279041, 100948251677323, 78904487866657, 107349911492376, 140550760803335, 119111852962667 } },
	cottonwood_2 = { model = 113722738465899, impostor = { 132083265925711, 72353188206396, 70373650029182, 112334447765119, 130865826498384, 99645043948795, 115680271897322, 99117896594747 } },
	yard_1 = { model = 134772590012469, impostor = { 72150423031378, 107791442882473, 123938091929967, 87249071497404, 113882680553085, 105785360281474, 77477232712630, 87095354554474 } },
	yard_2 = { model = 138248554842606, impostor = { 114361050865979, 90949792062147, 128038439994466, 103441187199160, 121204561161797, 97492856376674, 106052494437931, 77065326547926 } },
	cedar_1 = { model = 111231434669422, impostor = { 98325318082572, 75047167244489, 121046992338975, 97907487848703, 123284921276342, 111267148927738, 104226262789643, 130028824253962 } },
	cedar_2 = { model = 74294062465174, impostor = { 96123084746259, 73567346584943, 73594845169527, 112145808488201, 137585536051736, 107277672512301, 119408240574815, 73104247620891 } },
} :: { [string]: { model: number, atlas: number?, impostor: { number } } }

Assets.ready = true

return Assets
