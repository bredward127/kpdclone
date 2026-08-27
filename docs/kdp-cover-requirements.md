# Verified KDP paperback cover requirements

Sources retrieved 2026-08-27 from official Amazon KDP help pages:

- Paperback cover is a single PDF containing back cover, spine, and front cover: https://kdp.amazon.com/help/topic/G201953020
- KDP says spine text requires at least 79 pages; Cover Creator separately states 80 pages. The application requirement requested by the product owner is the conservative current paperback threshold of 79 pages, implemented as `pageCount >= 79` for permitted spine text. Source: https://kdp.amazon.com/help/topic/G201953020
- Spine text needs at least 0.0625 in / 1.6 mm clearance on both sides of the spine. Source: https://kdp.amazon.com/help/topic/G201953020 and https://kdp.amazon.com/help/topic/G201857950
- Cover bleed is 0.125 in / 3.2 mm on top, bottom, and outside edges. Source: https://kdp.amazon.com/help/topic/G201953020
- Content not intended to be trimmed should be at least 0.25 in / 6.4 mm from the outside cover edge. Source: https://kdp.amazon.com/help/topic/G201857950
- Cover images should be at least 300 DPI/PPI, with fonts embedded in the deterministic final PDF. Source: https://kdp.amazon.com/help/topic/G201953020 and https://kdp.amazon.com/help/topic/G201857950
- A creator may upload a cover with or without a barcode. If omitted, KDP adds one; if supplying a barcode, it must be at least 0.25 in from spine and trim, with a solid white background. Suggested size is 2 in x 1.2 in; minimum is 1.4 in x 0.8 in. Source: https://kdp.amazon.com/help/topic/G5HDYGP4BXLX4RUW
- Official cover calculator/template inputs include ink and paper choices, trim size, and page count; the calculator generates the full-cover layout and zones. Source: https://kdp.amazon.com/help/topic/G201953020
- RTL paperback covers reverse the front/back placement and barcode lower-left placement. Source: https://kdp.amazon.com/help/topic/G201953020

Implementation decision: import/store the official calculator/template output as a versioned template snapshot tied to a finalized interior fingerprint. Any page-count or print-input change invalidates the snapshot and requires re-import plus explicit creator confirmation.
