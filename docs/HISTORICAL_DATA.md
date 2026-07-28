# Historical Data Architecture

## Dataset roles
Historical information is stored as three independent evidence streams:

- ERA5 or equivalent reanalysis: the atmosphere that occurred.
- SPC outlooks: the forecast that was issued.
- NOAA observations: the weather that was reported or verified.

These streams are joined by event and issuance identifiers, but they remain semantically separate.

## Canonical record
Each record should contain:
- Event identifier and valid window.
- Product issuance time and lead time.
- Atmospheric features available at issuance.
- Original and normalized SPC products.
- Normalized gridded observations.
- Provenance, source version and processing version.

## Analog roles
- Scenario analogs may use an explicitly requested gameplay intensity band to synthesize an interesting world.
- Forecast analogs use atmospheric features only.
- Outlooks and reports are targets for calibration and verification, not hidden forecast inputs.

## Storage policy
Raw ERA5, NOAA and SPC archives are not committed to Git. Git tracks download scripts, manifests, checksums, schemas, compact fixtures and deterministic build scripts.

## Temporal coverage
Important cases should eventually use at least three-hourly data from the previous day through the following day so that moisture return, cap evolution, forcing and nocturnal transitions are represented.

## SPC outlook acquisition (2.34.1)

Historical SPC outlook acquisition is handled by `scripts/fetch-spc-outlooks.mjs` and the pure archive helpers in `js/historical/spc/SPCOutlookArchive.js`.

The acquisition layer enumerates the official yearly SPC web archive, filters issuance pages by date and forecast day, and preserves each original linked artifact. Every artifact record includes its source URL, local relative path, byte length, download/cache status, and SHA-256 checksum. The manifest also stores issuance and valid timestamps recovered from the original product page.

Downloads are resumable. Existing files are checksummed and recorded as cached unless `--overwrite` is supplied. New downloads are written to a `.part` file and atomically renamed only after the response completes. This prevents an interrupted request from masquerading as a complete product.

The acquisition layer does not interpret risk geometry. Shapefile, KML, text, and HTML products remain original source artifacts until the policy-aware parser introduced in 2.34.2 creates normalized hazard products.

The SPC archive describes itself as informational and potentially incomplete. Missing entries are therefore retained explicitly in the manifest rather than silently treated as null outlooks. The archive is available on the SPC site from January 23, 2003 onward.

## SPC product parsing (2.34.2)

`js/historical/spc/SPCOutlookParser.js` converts preserved SPC KML and legacy `LAT...LON` text artifacts into a common polygon contract. It handles categorical, tornado, wind, hail, and hazard-specific significant-severe contours while retaining source labels and provenance.

Parsing and normalization remain separate operations. Parsed products describe what was found in the source artifact, including structured warnings. Normalized products group those contours by hazard and attach the applicable SPC policy era. The original acquisition record remains unchanged beside the parsed and normalized representations.

Malformed, unclassified, or duplicate contours are reported rather than silently interpreted. Rasterization to the simulator grid is intentionally deferred to 2.34.3.


## 2.34.2.2 targeted SPC acquisition

`fetch:spc-outlooks` now uses date-targeted product discovery by default, avoiding slow annual archive listings. Use `--discovery annual` only for completeness audits or broad archive reconciliation.
