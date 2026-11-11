# Artifacts

Evidence that `QA_STATE.md` or `CURRENT.md` links to: QA transcripts, screenshot sets, release checklists.

- Keep only evidence someone will cite. Generated run output, logs, and caches go in ignored paths.
- When a gate closes, keep the evidence it cited and delete the rest.
- Text evidence (Markdown, JSON, logs someone will cite) is committed.
- Binary evidence (screenshots, video, PDFs, archives, datasets, models) is never committed; `.gitignore` excludes it here. Keep the files where they were captured, or in external storage for anything another machine needs, and commit a `MANIFEST.md` beside them listing each file's path, SHA-256, and where it is stored. `Get-FileHash -Algorithm SHA256 <file>` (or `sha256sum`) prints the hash.
