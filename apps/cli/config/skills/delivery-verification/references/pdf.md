# PDF acceptance

- Validate that the final PDF opens, has the expected page count and page size, and contains the requested text, links, forms, metadata, or attachments.
- Render every page to images after the final PDF write. Inspect every page for clipping, overlap, missing fonts or images, raster artifacts, incorrect orientation, unreadable text, broken transparency, and accidental blank pages.
- For fillable forms, inspect field placement and test entering, saving, and reading representative values without damaging the original.
- Recreate or repair the source artifact when defects appear, regenerate the PDF, and repeat structural and visual checks on the regenerated file.

Acceptance requires both structural validation and a clean page-by-page render; file existence or successful export alone is insufficient.
