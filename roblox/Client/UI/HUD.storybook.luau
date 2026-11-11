-- UI Labs discovers this module (name ends in ".storybook") and mounts
-- every descendant "*.story" under storyRoots.
-- https://ui-labs.luau.page/docs/stories/advanced/react

return {
    name = "HUD",
    storyRoots = {
        script.Parent.Components,
        script.Parent.Developer,
    },
}
