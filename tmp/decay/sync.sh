#!/bin/sh
# copy the lab sim into tmp/decay/src (SubVortices patched to require offline)
R=/c/Users/alex1/Documents/VSCodeProjects/weatherworld
rm -rf $R/tmp/decay/src && mkdir -p $R/tmp/decay/src
cp -r $R/roblox/Shared/StormLab $R/tmp/decay/src/shared
mv $R/tmp/decay/src/shared/Data $R/tmp/decay/src/data
sed -i 's#require(script.Parent.Noise)#require("./Noise")#' $R/tmp/decay/src/shared/Sim/SubVortices.luau
sed -e 's#../../roblox/Shared/StormLab/Data/#./src/data/#; s#../../roblox/Shared/StormLab/#./src/shared/#' $R/tools/stormlab/diag_decay.luau > $R/tmp/decay/diag_decay.luau
