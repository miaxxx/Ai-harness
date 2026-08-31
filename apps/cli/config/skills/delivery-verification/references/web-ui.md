# Web UI acceptance

- Start the real application path that contains the change. Use the actual server and data flow when the task changes product-visible behavior.
- Inspect every requested page and state at the target viewport. Cover loading, empty, error, populated, disabled, hover, focus, and responsive states when the request or change affects them.
- Capture or view current screenshots after the final UI change. Compare layout, spacing, typography, colors, assets, clipping, overflow, and stacking against the supplied design or explicit requirements.
- Exercise interactions end to end: navigation, controls, keyboard focus, form submission, and state transitions. Check the browser console and failed network requests when available.
- Repair visual or behavioral defects and repeat both screenshot inspection and affected interactions. A successful build is not visual acceptance.

Acceptance requires the requested states to work through the real UI and the final screenshots to show no visible defect. If the browser or application cannot run, report that visual acceptance remains unverified.
