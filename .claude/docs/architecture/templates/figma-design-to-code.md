# Architecture Template: Figma Design-to-Code

## When to Use

Use this template when the slice involves implementing a UI from a Figma design. Covers component extraction, design token mapping, and pixel-faithful frontend implementation.

## Architecture Fragment

### Figma Discovery Phase (Atlas)

Atlas uses Figma MCP read-only tools to extract architectural inputs:

1. **`get_file`** — retrieve full design tree; identify top-level frames and page structure
2. **`get_file_components`** — map published components to React component boundaries
3. **`get_file_styles`** — extract design tokens: colors, typography, spacing, effects
4. **`get_file_nodes`** — drill into specific frames for layout analysis (auto-layout, constraints, responsive breakpoints)

### Design Token Mapping

```
Figma Style              →  Code Artifact
─────────────────────────────────────────
Color styles             →  CSS variables / Tailwind theme extension
Typography styles        →  Font family, size, weight, line-height tokens
Effect styles (shadow)   →  Box-shadow tokens
Spacing (auto-layout)    →  Gap, padding values
Corner radius            →  Border-radius tokens
```

Atlas specifies the token extraction contract. Forge executes it.

### Component Decomposition

```
Figma Structure          →  React Component
─────────────────────────────────────────
Top-level frame          →  Page / route layout
Section frame            →  Section component
Component instance       →  Reusable React component
Variant set              →  Component with props/variants
Auto-layout frame        →  Flex/Grid container
```

### File Structure

```
app/[route]/
├── page.tsx                # Page composition from design frames
├── components/
│   ├── [Component].tsx     # Maps 1:1 to Figma component
│   └── [Component].tsx
└── styles/
    └── tokens.css          # Design tokens extracted from Figma (if not using Tailwind)
```

### Implementation Contract (Forge)

Forge uses Figma MCP to verify implementation fidelity:

1. **`get_file_styles`** — extract exact color hex values, font specs, spacing values
2. **`get_file_nodes`** — retrieve specific frame dimensions, padding, gaps for pixel-accurate layout
3. **`get_images`** — export assets (icons, illustrations) as SVG or PNG for direct use

```typescript
// Example: Design token extraction pattern
// Forge reads Figma styles and maps to code:
//   Figma "Primary/500" (#2D5F2D) → --color-primary-500: #2D5F2D
//   Figma "Body/Regular" (Inter 16/24) → font-body: Inter 1rem/1.5
```

### Responsive Design

Atlas identifies breakpoints from Figma frames (e.g., Desktop 1440px, Tablet 768px, Mobile 375px) and specifies the responsive contract. Forge implements responsive behavior matching the Figma frame variants.

## Acceptance Criteria Template

- AC-1: Component structure matches Figma component hierarchy — one React component per Figma published component
- AC-2: Design tokens (colors, typography, spacing) match Figma styles exactly — no approximation
- AC-3: Layout matches Figma auto-layout properties (direction, gap, padding, alignment)
- AC-4: Responsive breakpoints match Figma frame variants (if present)
- AC-5: Exported assets (icons, images) match Figma exports at correct resolution
- AC-6: Interactive states (hover, focus, active, disabled) match Figma variant states (if defined)
- AC-7: Visual regression — rendered output is pixel-faithful to the Figma design at each breakpoint

## Trust Surfaces

- **Asset export:** Exported images/SVGs should be reviewed for unexpected content
- **External fonts:** If Figma specifies fonts not already in the project, font licensing must be verified
- **Third-party component mapping:** If Figma components map to third-party UI libraries, dependency additions require review
