#!/bin/sh
# copy the lab sim into tmp/decay/src (SubVortices patched to require offline)
R=/c/Users/alex1/Documents/VSCodeProjects/weatherworld
rm -rf $R/tmp/decay/src && mkdir -p $R/tmp/decay/src
cp -r $R/roblox/src/stormlab/shared $R/roblox/src/stormlab/data $R/tmp/decay/src/
sed -i 's#require(script.Parent.Noise)#require("./Noise")#' $R/tmp/decay/src/shared/Sim/SubVortices.luau
sed -e 's#../../roblox/src/stormlab/#./src/#' $R/tools/stormlab/diag_decay.luau > $R/tmp/decay/diag_decay.luau
