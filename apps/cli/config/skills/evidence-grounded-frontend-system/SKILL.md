---
name: evidence-grounded-frontend-system
description: Generate, audit, repair, or redesign HTML/CSS and web apps, including HTML reports. Also use for new visual or interactive artifacts such as tools and personal sites when the user specifies no output format or technical stack; default them to standalone HTML with inline CSS and JavaScript. Explicit formats such as DOCX or Excel/XLSX, explicit stacks such as React, and existing file formats always take precedence. Apply evidence-grounded design, truthful interaction, and responsive recomposition.
---

# Evidence-Grounded Frontend System

Create interfaces that feel deliberately designed for their specific content, task, identity, and environment.

The goal is to produce a **strong first result**: clear, usable, visually confident, content-native, and specifically fitted to its content, task, identity, and environment.

Optimize for:

- **content coupling** — form follows actual relationships, not component defaults;
- **task fitness** — the interface supports what the user needs to read, compare, monitor, operate, create, explore, decide, configure, inspect, or navigate;
- **visual coherence** — commit to one direction that is well supported by current evidence;
- **specificity** — visible decisions should reflect this subject, product, behavior, audience, domain, or environment when such evidence exists;
- **truthfulness** — data, imagery, interaction, and copy do not imply unsupported outcomes;
- **responsive continuity** — the design proposition and task relationships survive across widths.

Cards, gradients, dark mode, rounded corners, common icons, system fonts, white canvases, saturated colors, dense layouts, centered layouts, asymmetry, full-bleed imagery, strong typography, shadows, depth, or long continuous pages are not slop by default.

A choice becomes suspicious when it is weakly connected to the current Artifact Mode, domain/topic, audience, content, behavior, identity, scene, or functional need.

The core principle is:

> **Generate the best-supported solution first. Use post-draft checks only to remove unsupported or harmful decisions afterward.**

---

# Default HTML Output

Resolve the output format before choosing Artifact Mode or delivery medium. Apply these rules in order:

1. If the user specifies an output format, use that format. For example, a DOCX request produces DOCX.
2. If the user specifies a technical stack or framework, use it. For example, a React request produces React rather than standalone HTML.
3. If the request names a format-specific artifact such as an Excel spreadsheet, treat that as an explicit format choice and produce `.xlsx`.
4. If the user asks to modify an existing file, preserve that file's format unless the user explicitly requests a conversion.
5. Only if rules 1–4 do not apply and the user requests a new finished artifact, default to a standalone `.html` file.

For the default standalone HTML output:

- deliver exactly one `.html` file;
- place all CSS in `<style>` and all required JavaScript in `<script>` within that file;
- do not add a build step, package manager, framework, separate stylesheet, or separate script file;
- avoid external runtime dependencies so the file remains directly openable and usable;
- include JavaScript only when the artifact requires interaction or behavior.

This is a default format selection, not a fallback after another format fails.

---

# 1. Priority

When rules compete, use this order:

1. function, accessibility, truthfulness, and required content;
2. task flow, audience/domain fit, content relationships, topology, and truthful state representation;
3. grouping, boundary depth, and repeated-record structure;
4. design proposition and macro-composition;
5. hierarchy, density, environmental field, color exposure, and responsive behavior;
6. identity, signature, typography, imagery, icons, effects, and motion;
7. post-draft fit review.

Do not sacrifice usability for spectacle.

Do not force novelty, unusual palettes, or unfamiliar conventions merely to differentiate the artifact.

Clarity, familiarity, and expressiveness are all valid when supported by current evidence.

## Mode Router

Choose the mode before applying visual rules:

- **Generate** — create a new artifact; use the full generation sequence, then diagnose.
- **Audit** — report evidence, impact, and smallest correction without editing.
- **Repair** — preserve the successful direction and make the smallest coherent intervention.
- **Redesign** — preserve required content, behavior, identity evidence, and successful qualities, but allow a new art direction.

For Repair, escalate only as needed:

**Preserve → Local Repair → Structural Repair → Redesign**

Do not make an artifact look more transformed merely to prove that work was done.

---

# 2. Generate First

For new artifacts, begin from the current Artifact Mode, domain/topic, audience, content relationships, scene, identity, and task.

Do not choose palette, card style, border radius, visual genre, or page formula before understanding that evidence. Familiar or conventional structures remain valid when they fit it.

### Artifact Type ≠ Visual Genre

Artifact labels describe structure or behavior, not appearance. They must not **alone** select a visual genre. Familiar domain conventions remain valid when audience, product, identity, or scene evidence supports them. Do not avoid a convention merely to prove originality.

### Semantic Color Isolation

Semantic color is a local signal by default. Repeated warning/error states do not justify repeated large tinted surfaces. Success, warning, danger, and info should not become brand, accent, button, border, or dominant palette colors unless state itself is a page-level message.

Use this sequence:

**Brief Decode → Delivery Medium → Interaction Archetype → Scene Evidence → Domain Expression → Creative Divergence → Visual Proposition → Topology → Grouping/Boundary Plan → Macro Composition → Art Direction → Color/Exposure/Icon Plan → Identity Continuity → Energy Choreography → Build → Evidence/Fit Gate → Post-Draft Diagnostic → Responsive Recomposition**

---

# 3. Brief Decode

Before styling, extract the real design inputs.

Identify:

- primary task or message;
- audience;
- viewing and interaction context;
- delivery medium;
- content volume and reading duration;
- required entities;
- comparisons;
- sequences;
- dependencies;
- states;
- repeated records;
- evidence;
- primary and secondary actions;
- factual content versus placeholders;
- available imagery, data, product UI, brand, spatial, geographic, environmental, or interaction cues;
- technical and accessibility constraints.

## Delivery Medium Router

Determine delivery medium independently from Artifact Mode.

For HTML/CSS/web deliverables, use **screen-native** as the default delivery medium unless the brief explicitly specifies another medium. Artifact Mode defines content structure and behavior; it does not imply a delivery medium.

Do not infer delivery medium from the artifact label, subject matter, professional tone, reading length, or reporting format.

For screen-native reports and analysis views, derive visual identity from information geometry, analytical hierarchy, data relationships, interaction, domain, audience, product, and brand evidence.

**HTML Report Medium Guard:** When an HTML report lacks brand or environmental evidence for a physical publication treatment, labels such as `report`, `document`, or `research` must not by themselves justify `paper`, `parchment`, `cream`, `sepia`, or other print-medium metaphors. Professionalism, credibility, authority, seriousness, or research depth are content qualities; they are not evidence for canvas temperature or physical-medium styling.

When brand, product, environmental, or delivery-medium evidence does not establish a directional color cast, keep large background fields **chromatically balanced** until stronger evidence exists.

Implementation comments, design rationales, token names, and variable names must not introduce a stylistic premise that is absent from the evidence used to derive the visual system.

## Scene Evidence Gate

Treat domain/category conventions as valid evidence alongside audience, product, identity, scene, content, and task evidence. Translate the situation into observable design requirements before styling.

Identify when relevant:

- **environment** — clinical, domestic, industrial, educational, public, cultural, retail, outdoor, control-room, studio, etc.;
- **user state** — relaxed, hurried, anxious, expert, unfamiliar, distracted, collaborative, safety-critical;
- **task consequence** — exploratory, reversible, transactional, operational, compliance-sensitive, high-risk;
- **attention pattern** — scanning, sustained reading, comparison, monitoring, manipulation, navigation;
- **content density** — sparse, moderate, dense, highly repetitive;
- **brand / product evidence** — existing colors, imagery, product form, architecture, interface language;
- **lighting / media context** — bright public display, personal laptop, mobile outdoors, dark room, kiosk, presentation screen;
- **semantic evidence** — states, categories, severity, confidence, uncertainty, hierarchy.

Translate scene evidence into **visual requirements before visual answers**.

Derive requirements such as:

- attention must remain stable or may deliberately spike;
- exceptional states need stronger or weaker separation;
- dense information needs controlled background competition;
- primary actions need a specific level of recognition;
- the environment permits or discourages high visual intensity;
- identity should be dominant, supporting, or nearly absent;
- semantic states may need stronger separation than brand expression;
- viewing duration and media conditions change readability, density, interaction, and contrast requirements.

Sustained reading, fatigue, monitoring, and density define usability requirements; they must not by themselves select hue temperature, saturation, light/dark mode, type genre, or aesthetic genre. Only after these requirements are understood should the model derive the visual system.

### Domain Expression

Let domain evidence shape **visual character**. Rank relevant qualities as **primary / secondary / unsupported unless evidenced**: technicality, humanity, authority, precision, energy tolerance, image/data emphasis, and semantic-state importance. Let supported priorities influence palette range, typography, imagery, geometry, density, and contrast.

Domain conventions are valid positive evidence when they match audience, product, identity, category literacy, or scene. Weigh them together with the rest of the current brief.

### Environmental Field Evidence

Treat the canvas / dominant field as a scene decision, not an archetype default. Lighting, display/viewing context, identity, product evidence, and environment may inform it directly; session duration, reading density, fatigue, or monitoring may only define usability requirements and must not themselves select light/dark mode, chromatic direction, temperature, or saturation. Choose the field that best supports actual use, hierarchy, and the visual proposition.

If scene evidence is weak, do not invent a genre. Prefer the direction best supported by task, content, identity, and usability.

---

# 4. Interaction Archetype

Identify the dominant user behavior:

- **Read** — continuity, comprehension, hierarchy, evidence.
- **Compare** — aligned dimensions, common baselines, matrices.
- **Monitor** — persistent state, stable scanning, compact repetition.
- **Operate** — action clarity, efficient controls, feedback, recoverability.
- **Create** — work surface, direct manipulation, tools, inspectors.
- **Explore** — maps, canvases, filters, progressive reveal.
- **Decide** — evidence, tradeoffs, confidence, consequences.
- **Configure** — dependency clarity, defaults, validation, preview.
- **Inspect** — detail, provenance, metadata, traceability.
- **Navigate** — orientation, destination recognition, location, state.

A page may combine several, but establish one dominant behavior.

Use the archetype to shape structure, interaction, reading/scanning behavior, information organization, affordance visibility, control density, surface hierarchy, state prominence, and feedback—not palette, type genre, light/dark mode, or aesthetic genre.

# 5. Creative Divergence

Before selecting a structure, silently formulate at least **three plausible design directions**.

The directions must differ in meaningful design logic, not merely color or typography.

Vary one or more of:

- macro-composition;
- dominant spatial relationship;
- information geometry;
- image or media role;
- density;
- scale;
- crop and bleed;
- edge behavior;
- interaction model;
- spatial depth;
- narrative rhythm;

Alternative candidates should remain plausible for the same evidence; do not reward a direction merely because it is less obvious or less conventional.

When color materially contributes to the art direction, candidate directions may explore different **color relationships** when current evidence supports meaningful alternatives. Possible differences include canvas-to-content contrast, chroma distribution, lightness structure, hue relationships, focal color concentration, semantic color visibility, and identity color exposure.

Reject a direction when its structure or styling is weakly connected to current evidence, harms task fitness, or depends on unsupported decoration.

Select the direction with the strongest combination of:

**content coupling + task fitness + domain/scene fit + identity fit + implementation viability**

Commit to the best-supported direction; familiarity or conventionality is not a penalty.

---

# 6. Visual Proposition Lock

Before locking the page structure, define one compact internal proposition **directly from Artifact Mode + delivery medium + domain/topic + scene evidence + content/task + identity**.

The proposition may organize or emphasize existing evidence; it must not introduce unsupported stylistic premises, fictional context, or a new interpretive layer that is absent from the brief and actual use.

It must answer four questions.

## Core relationship

What relationship, behavior, subject quality, analysis pattern, or reading behavior deserves deliberate emphasis?

## Dominant spatial gesture

What should this proposition visibly do to:

- scale;
- position;
- axis;
- framing;
- crop;
- overlap;
- density;
- grouping;
- depth;
- navigation;
- interaction?

## Identity carrier

Which **evidenced property or behavior** will make the result recognizably belong to this content even if the logo and marketing adjectives disappear?

Possible carriers:

- imagery;
- spatial rhythm;
- geometry;
- product UI;
- interaction behavior;
- motion;
- environmental cues;
- physical product properties when directly evidenced.

Typography, data formatting, or contextual notes may support identity when strongly evidenced, but should not become the default identity carrier for reports, technical content, or data-heavy artifacts.

## Contrast strategy

What receives visual intensity, and what intentionally stays quiet?

Generic adjectives such as clean, premium, modern, futuristic, minimal, elegant, playful, bold, or less AI do not qualify by themselves.

A useful proposition changes the actual composition or behavior.

Examples:

- make dependency between source and consequence spatially unavoidable;
- treat comparison as one shared measurement field instead of isolated feature cards;
- let one uninterrupted evidence stream carry the page instead of repeated titled sections;
- turn editing history into a visible spatial layer rather than a hidden utility panel.

Do not invent theatrical concepts for routine tasks.

A dense operational interface may be authored through information geometry, column behavior, keyboard flow, state clarity, and interaction continuity.

---

# 7. Content Topology → Spatial Primitive

Translate real content relationships into spatial candidates before choosing visual components.

| Relationship | Spatial candidates |
| --- | --- |
| chronology / progression | timeline, track, ordered sequence, temporal field |
| hierarchy / containment | tree, nesting, indentation, scale levels, grouped regions |
| comparison | shared axis, aligned rows, split field, matrix, table |
| dependency / causality | connector, graph, directional composition, upstream/downstream field |
| repeated records | list, rows, table, compact repeated modules, clusters |
| quantitative change | plot, scale, ranked field, common baseline |
| process / state | state model, step sequence, transition diagram, task flow |
| dominant claim | focused field, poster-like composition, single anchor |
| exploration | canvas, map, spatial navigation, progressive reveal |
| editing / manipulation | workbench, viewport + inspector, direct manipulation surface |
| reference / supporting evidence | linked references, indexed navigation, contextual notes, evidence markers |
| spatial data | map, layered field, coordinates, region comparison |
| relationship network | node-link field, adjacency system, connected clusters |
| allocation / composition | partition, proportional field, stacked structure |
| before / after | shared frame, synchronized split, overlay, reveal |

Do not translate every semantic node into a card.

A code-component boundary is not automatically a visual boundary.

A React, Vue, or Svelte component may render as:

- row;
- inline group;
- typography;
- table cell;
- overlay;
- track;
- unboxed region;
- direct manipulation target.

Conversely, one semantic module may contain several code components while reading as one continuous visual field.

Use the **most expressive representation that preserves clarity, task efficiency, and semantic truth**.

Prefer the simpler representation only when additional spatial treatment adds no meaningful hierarchy, identity, interaction, or understanding.

---

# 8. Macro Composition

Choose macro-composition only after the proposition and topology are understood.

Valid options include:

- centered;
- offset;
- split;
- asymmetric;
- symmetric;
- continuous;
- full-bleed;
- grid;
- matrix;
- timeline;
- table;
- map;
- canvas;
- workbench;
- poster-like field;
- dense control surface;
- layered viewport;
- image-led;
- data-led;
- mixed-media.

These are spatial options, not templates.

## First-Viewport Rule

The first viewport should make the primary task, message, hierarchy, and interaction model immediately legible.

Its composition may be quiet or expressive. Do not force spectacle, oversized type, crop, bleed, overlap, asymmetry, or any other stylistic move unless the current proposition and content relationships support it.

At a representative laptop viewport, the primary task or message, focal point, and primary action when required should form a complete composition.

Do not push all meaningful content below the fold merely to create a giant hero.

Do not force everything above the fold either.

---

# 9. Visual Field, Not Container Tree

Judge the page as a visual field, not only as a component tree.

Check:

- **mass** — visual weight has an intentional center or direction;
- **negative space** — space clarifies relationships and rhythm rather than acting as generic luxury;
- **edge behavior** — meaningful type, imagery, diagrams, or data may crop, bleed, break containers, or sit directly on the canvas;
- **depth** — overlap, foreground/background, translucency, or occlusion should communicate hierarchy, continuity, state, or causality;
- **grid** — use alignment for coherence, but allow justified spans, offsets, crop, overlap, compression, expansion, or off-grid moments.

Not every semantic region requires a visible rectangle.

The grid serves the proposition.

# 10. Identity Continuity

No visual signature is required.

When repeated visual language is directly supported by identity, content, interaction, product behavior, or environment, keep it coherent across the artifact. Otherwise use the simplest evidence-compatible solution without adding an unsupported chromatic direction, motif, framing system, or stylistic premise.

Repeat only what improves identity recognition, hierarchy, interaction, or continuity.

---

# 11. Evidence-Anchored Art Direction

Typography, canvas, color, imagery, geometry, depth, boundary grammar, and motion may reinforce one another as one art direction.

Do **not** demand a separate essay for every variable. Instead require an **evidence anchor**.

A high-impact visual choice is supported when it either:

1. contributes to the shared proposition **and is traceable to Artifact Mode, delivery medium, domain/topic, scene, content, identity, or actual product evidence**; or
2. performs an independent functional role such as hierarchy, state, readability, interaction, evidence, or accessibility.

A proposition is not evidence by itself.

Valid shared anchors include:

- content relationship;
- task behavior;
- domain / topic;
- audience;
- identity;
- scene / environment;
- evidence level;
- physical product or spatial evidence;
- narrative present in the brief/content;
- interaction model.

Strong coherence and strong expressiveness are allowed.

Reject any reusable aesthetic bundle when several visual variables repeatedly travel together without being independently supported by the current content, task, identity, environment, or proposition.

The problem is not any individual visual ingredient. The problem is **automatic bundling**: a familiar combination being selected because it already looks designed rather than because this artifact needs it.

### Bundle Substitution Test

Ask: if canvas, typography, chroma structure, boundaries, image treatment, or effects were swapped for another coherent system, would Artifact Mode, delivery medium, domain/topic, audience, identity, scene, content, or task fit become weaker?

- If **yes**, the bundle is meaningfully anchored.
- If **no**, check whether both systems are equally evidence-compatible before calling the choice a stylistic reflex.

Substitutability among several valid solutions is not a defect. Reject only choices whose character remains equally plausible after the supporting evidence is removed.

Do not replace an unsupported bundle with a different default bundle. Re-derive the art direction from current evidence.

---

# 12. Energy Choreography

Treat visual intensity as a compositional resource.

Energy may come from:

- scale;
- saturation;
- value contrast;
- motion;
- density;
- texture;
- image complexity;
- depth;
- geometry;
- typography;
- crop;
- overlap;
- data density;
- spatial tension.

Do not distribute medium intensity evenly across the entire page.

Plan:

- dominant events;
- supporting events;
- compression;
- expansion;
- low-attention regions;
- transitions;
- evidence moments;
- action moments.

Multiple high-energy elements may coexist when they form **one coordinated visual event**.

Choose intensity from the current content, hierarchy, interaction, and proposition rather than from artifact category or a familiar visual formula. A low-energy composition is fully valid when it better serves the task.

Operational interfaces may keep scanning rhythm stable and information dense; derive their visual system from information geometry, state clarity, direct manipulation, spatial organization, domain, and scene—not from a preset visual tone.

---

# 13. Visual-System Rules

These guide implementation after macro direction is established. They must not weaken a coherent proposition.

## Typography

Choose type from language, audience, identity, reading behavior, density, and subject character; reading behavior defines legibility, measure, and rhythm needs rather than a preset type genre.

Define stable roles: display, section, subsection, body, label, numeric, and code when relevant.

Display typography may act as a spatial element through crop, bleed, framing, interruption, scale, or interaction with imagery.

Do not create a new size or weight for every component. Test long Chinese/English headings, numbers, controls, URLs, and narrow widths.

## Color

Color must be **derived, not prescribed**.

Before deriving a palette, identify the dominant presentation mode:

- **Operational tool** — only when operating, monitoring, editing, configuring, or manipulating is the primary task. Color should support controls, active/selected states, persistent status, thresholds, and feedback.
- **Report / analysis view** — color should support analytical hierarchy, comparison, data relationships, evidence distinction, clear emphasis, and sustained screen readability.
- **Brand / content site** — company sites, personal sites, portfolios, and campaigns are not operational tools by default. Let identity, content, imagery, audience, narrative, domain priorities, and scene evidence drive color and expression.
- **Hybrid** — keep the color roles of each mode distinct instead of averaging them into one palette grammar.

This routing defines the color-role hierarchy and exposure appropriate to each presentation mode.

Treat delivery medium, domain conventions, audience expectations, product context, identity, scene, and task as valid inputs to palette selection.

For screen-native reports, canvas temperature and large-field color cast require current evidence. If that evidence is absent, keep large fields chromatically balanced rather than deriving a directional cast from the report label or abstract professional qualities.

First determine what color needs to accomplish in this specific artifact.

Use evidence from:

- content hierarchy;
- task and interaction behavior;
- audience and user state;
- environment and viewing context;
- brand or identity evidence;
- imagery and product evidence;
- semantic states;
- data relationships;
- desired focal hierarchy;
- energy choreography;
- accessibility and contrast requirements.

Then independently derive:

- canvas color and value;
- surface relationships;
- text / foreground relationships;
- hue families;
- hue temperature relationships;
- chroma range;
- lightness range;
- contrast structure;
- identity color behavior;
- semantic state colors;
- data color logic;
- accent distribution;
- color repetition;
- color area and visual exposure.

These are design variables, not preset answers.

The same scene may support several high-quality palettes, but the dominant presentation mode should keep their color-role hierarchy comparable. Choose the system whose relationships best reinforce the selected visual proposition, content hierarchy, environment, identity evidence, and interaction.

### Palette Evidence

Derive the palette from current domain/category conventions, audience, product, identity, scene, content, task, hierarchy, interaction, and accessibility evidence.

Similar briefs may legitimately produce related palette characteristics when their evidence is similar.

Vivid, restrained, monochrome, multicolor, dark, light, chromatic-field, and image-led systems are all valid when supported by current evidence.

### Color Is Relational

Judge colors by their relationships, not by isolated hue preference.

Evaluate:

- hierarchy;
- simultaneous contrast;
- foreground/background separation;
- chroma contrast;
- lightness contrast;
- repetition;
- rhythm;
- focal concentration;
- semantic consistency;
- visual balance;
- accessibility.

A palette succeeds when its relationships make the artifact clearer, more coherent, and more appropriate to its actual delivery medium, domain, audience, content, identity, scene, and use.

### Color Exposure Strategy

A palette is not defined only by which colors exist. Its perceived character depends on how much visual territory, contrast, repetition, and attention each color receives.

Judge perceived color weight through:

**area × saturation × value contrast × repetition × positional prominence**

Determine exposure from hierarchy and composition rather than a fixed ratio.

Do not use fixed formulas such as 60/30/10.

Do not assume that the canvas must have low chroma, that accents must occupy only a small area, or that more restraint automatically produces better taste.

A chromatic field may dominate when it strengthens the proposition. A nearly monochromatic system may be correct when hierarchy is carried elsewhere. Several hue families may coexist when they form a controlled system with stable roles.

For each color role ask:

- What does this color make easier to understand?
- What does it make easier to recognize?
- What receives attention because of it?
- How often does it repeat?
- How much visual area does it occupy?
- Is that visual weight proportional to its importance?
- Does another color already perform the same role?
- Would changing this relationship weaken the composition or meaning?

Reduce color only when it creates noise, redundancy, false hierarchy, accessibility problems, or semantic ambiguity.

Add, expand, or intensify color only when it improves hierarchy, identity, state recognition, information distinction, scene fit, interaction, or the selected visual proposition.

Do not equate restraint with quality.

## Grouping

Choose grouping from semantic independence, scanning frequency, comparison needs, interaction boundary, affordance visibility, state, hierarchy, and density.

Choose grouping cues as peer options rather than an enclosure hierarchy. Proximity, alignment, typography, whitespace, surfaces/cards, dividers/tracks, indentation, and state treatment are all valid when they best express the current semantic or interaction boundary.

Do not assume either cards or unboxed regions are the default.

### Container Depth Gate

Before nesting any visible surface inside another visible surface, require the child to add at least one independent semantic boundary:

- independent interaction;
- independent state;
- independent destination;
- independent movable/editable object;
- independent scrolling or focus context;
- semantic exception such as warning, selection, current step, or protected content.

If none exists, simplify the boundary treatment without assuming that flattening, spacing, dividers, or surfaces are inherently preferable.

Avoid:

**page surface → section card → item card → inner card**

when the levels merely mirror code components.

A parent card does not require its children to be cards. A React/Vue/Svelte component boundary is not a visual-boundary requirement.

When changing a boundary, reassign grouping from the relationship rather than from a preferred container style.

## Imagery

Assign image roles: evidence, identity, representation, context, or decoration.

If visible form, environment, identity, or scale matters, use a medium that preserves it. Do not replace meaningful subjects with generic icons or schematic SVGs without reason.

Do not present generated or unrelated stock imagery as factual evidence.

## Icons

Treat icons as a functional vocabulary, not decorative filler.

Use one established icon system or one coherent SVG family. Keep stroke/fill, optical weight, container logic, sizing, and alignment consistent.

**Do not use emoji or arbitrary Unicode glyphs as UI chrome, navigation icons, action icons, state icons, or substitutes for a coherent icon system.** Emoji are acceptable only when they are genuine user content, reactions, culturally meaningful expression, or an intentional brand/content element.

Apply an **Icon Utility Gate**:

**Add / keep** an icon when it materially improves:

- scan speed across repeated destinations, actions, states, or object types;
- compact interaction in toolbars, tables, maps, media controls, or mobile layouts;
- non-color state recognition;
- persistent wayfinding;
- concept recognition;
- multilingual resilience.

**Reduce / remove** an icon when:

- it merely repeats an obvious label;
- every peer item receives a different symbol just to fill space;
- icons appear at several nested levels and create competing anchors;
- mixed libraries or weights break coherence;
- decorative icons outnumber meaningful actions or states.

**Replace** an icon when:

- emoji or arbitrary glyphs are performing a functional role;
- the symbol is ambiguous or culturally unstable;
- an enlarged UI icon stands in for a person, product, place, environment, or primary subject that needs richer media.

Use a coverage map rather than an icon quota. Navigation, repeated actions, states, important object types, and wayfinding should be covered where symbols materially improve recognition; do not equalize icon count for symmetry.

## Effects and Motion

Effects are valid when they support state, focus, continuity, data, identity, or depth.

Motion should explain causality, continuity, state, feedback, object permanence, hierarchy, or temporal storytelling.

Avoid universal fade-up, card lift, stagger, parallax, or `transition: all`. Use a finite motion vocabulary and respect reduced motion.

# 14. Copy and Evidence

Make visible text earn its space.

A text block should:

- explain;
- distinguish;
- instruct;
- prove;
- contextualize;
- label;
- reveal state;
- support a real persuasive claim.

Do not invent:

- metrics;
- customers;
- testimonials;
- partners;
- certifications;
- operating results;
- quotations;
- real identities.

Clearly label demo or sample values.

Avoid generic filler such as:

- unlock the power of;
- seamlessly transform;
- everything you need;
- built for modern teams;
- next-generation experience;
- smarter workflows;
- powerful insights.

Prefer concrete nouns, verbs, constraints, outcomes, and product behavior.

Do not mechanically attach a title + subtitle pair to every region.

A section may begin with:

- data;
- image;
- question;
- table header;
- control;
- quote;
- annotation;
- transition;
- no explicit heading.

More text must add information, not merely hierarchy wrappers.

---

# 15. Interaction Integrity

Every visible affordance must have an honest outcome.

Do not use fake links, buttons, tabs, filters, submissions, persistence, payment, publication, or success states.

When external behavior is unavailable, implement truthful local behavior such as filtering, selection, disclosure, validation, modal/drawer state, copy feedback, preview, or clearly labeled simulation.

If an action is out of scope, remove interactive styling, disable it with a reason, or render it as non-interactive content.

Verify representative paths for each distinct interaction family and check keyboard access, focus, validation, disabled, loading, success, empty, and error behavior where relevant.

# 16. Accessibility as Design Input

Accessibility participates in design:

- semantic and visual hierarchy should agree;
- DOM order should remain meaningful when layouts collapse;
- color must not be the only carrier of important meaning;
- controls need understandable names and visible focus;
- contrast must survive imagery, gradients, overlays, and states;
- reduced-motion behavior must preserve understanding.

# 17. Responsive Recomposition

Responsive design is not desktop sections stacked vertically.

Preserve:

- proposition;
- hierarchy;
- task path;
- primary relationships;
- important evidence;
- interaction integrity.

When needed, reinterpret:

- order;
- scale;
- overlap;
- crop;
- axis;
- navigation;
- comparison structure;
- annotation;
- interaction density;
- grouping.

The mobile layout may use a different composition while remaining recognizably the same design system.

Verify at least:

- wide desktop;
- intermediate width;
- mobile around 390 px.

The intermediate state matters.

Many layouts work at 1440 px and 390 px but fail around 768–1024 px.

---

# 18. Evidence / Fit Gate

Before accepting the first draft, ask:

- Does spatial structure expose actual relationships?
- Does hierarchy support the primary task or message?
- Are high-impact visual choices traceable to Artifact Mode, delivery medium, domain/topic, audience, content, identity, scene, interaction, or accessibility?
- Does the composition materially fit the current content and task?
- Does the proposition survive implementation without invented style evidence?
- For screen-native reports, does any large-area canvas treatment, token naming, or rationale imply a delivery medium that the brief did not establish?
- Are clarity, usability, and responsive behavior intact?

A successful draft is clear, usable, coherent, and evidence-grounded. Familiarity or conventionality are not defects.

If a choice is unsupported, remove or re-derive that choice only. Do not add decoration merely to differentiate the artifact.

---

# 19. Post-Draft Anti-Slop Diagnostic

Run only after a coherent first draft exists.

Do not use this as a pre-generation style target.

Inspect:

## Information topology

Do spatial relationships reflect real relationships, or merely package content into generic modules?

## Semantic compression

Has simple information been over-packaged into icon + badge + card + helper + sparkline + border + surface without added meaning?

## Componentization

Did code-component boundaries become unnecessary visual boundaries?

## Hierarchy and energy

Is there a clear focal order, or is every region medium-emphasized?

## Typography

Do type roles follow hierarchy and reading behavior?

## Color

Does the color system trace directly to current Artifact Mode, delivery medium, domain/topic, audience, content, task, scene, identity, state model, and functional needs without relying on an invented aesthetic rationale?

Do colors carry stable roles without manufacturing arbitrary variety?

## Palette evidence

Check whether canvas character, base color family, temperature, saturation, accent placement, light/dark balance, semantic treatment, and overall exposure are supported by current evidence.

Re-derive color decisions only when they are unsupported by the current domain, audience, product, identity, scene, content, task, hierarchy, interaction, or accessibility evidence.

## Grouping

Are cards, surfaces, dividers, pills, and whitespace being repeated mechanically?

Check container depth specifically: does each nested surface represent an independent semantic, interaction, state, destination, or editing boundary? If not, flatten it.

## Color exposure

Even if color roles are semantically valid, is their visual area, saturation, contrast, repetition, or prominence disproportionate to hierarchy and the selected proposition?

Is color being reduced merely to appear tasteful, or expanded merely to appear creative? If so, re-balance exposure from function and composition rather than aesthetic habit.

## Imagery

Does the medium preserve the subject information required?

## Copy

Is the text specific, truthful, and useful?

## Rhythm

Do consecutive regions change according to content role, or repeat the same section formula?

## Motion and interaction

Does behavior communicate state, continuity, causality, or feedback?

Flag only issues that materially weaken relevance, identity, hierarchy, readability, authenticity, or task fitness.

Do not suppress strong expressive choices when they are supported by current evidence.

---

# 20. Minimal Audit / Repair Support

Generation is the primary mode.

For Audit, report evidence, impact, smallest correction, and quality worth preserving.

For Repair, choose the smallest coherent intervention:

- **Preserve** — no high-impact defect.
- **Local repair** — hierarchy, spacing, contrast, overflow, isolated media/effects, icon misuse, color exposure, redundant containers.
- **Structural repair** — task flow, topology, responsive model, grouping model, or primary interaction is materially wrong.
- **Redesign** — only when explicitly requested or when the existing direction cannot satisfy the brief.

Repair in this order and stop as soon as the named defect is resolved:

1. broken task flow, false affordances, factual/content problems;
2. topology and composition;
3. hierarchy, density, grouping, container depth, color exposure;
4. typography, palette roles, imagery, identity;
5. effects, icon detail, motion, borders, radii, shadows.

Do not turn Repair into a restyle pass. Removing one formula must not install its opposite as a new formula.

# 21. Delivery Gate

Before completion, verify when runtime access exists:

- proposition is visible in the rendered result;
- first viewport has a deliberate identity;
- long-page rhythm does not collapse into one repeated section formula;
- desktop, intermediate, and mobile layouts avoid unintended overflow, clipping, broken wrapping, and obscured content;
- important comparisons and relationships survive responsive recomposition;
- every visible affordance has an honest result;
- primary flows, focus, disabled, loading, success, empty, and error states behave appropriately;
- semantic structure, contrast, keyboard access, accessible names, and reduced-motion behavior remain valid;
- images load, crop correctly, and do not fabricate factual evidence;
- required content is present and copy is specific;
- nested surfaces pass the Container Depth Gate;
- functional UI uses coherent icons rather than emoji/glyph chrome;
- color roles and color exposure are derived from current evidence, hierarchy, and the selected proposition rather than a recurring palette default;
- no uncaught runtime error or overlay blocks the default evaluable state.

Fix failures directly. Do not compensate with more decoration.

If runtime verification is unavailable, state that limitation.

# Final Principle

The purpose of this skill is to make each artifact fit its actual Artifact Mode, delivery medium, domain/topic, audience, content, task, identity, and scene.

Conventional, familiar, expressive, light, dark, minimal, or visually rich solutions are all valid when supported.

The failure mode is **mismatch or unsupported styling**, not familiarity or similarity.

Generate the best-supported proposition first.

Then remove only decisions that weaken function, clarity, evidence fit, identity fit, or interaction.
