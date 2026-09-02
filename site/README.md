# Receipts landing surface

This is the React/Vite marketing surface published to `docs/` for GitHub Pages.

## Run it

```bash
npm install --prefix site
npm run dev --prefix site -- --host 0.0.0.0
npm run build --prefix site
```

The Vite `base` is `/receipts/` and the build output is `../docs`, so local preview is
`http://localhost:5173/receipts/` and the deployed path is `/receipts/`.

## Design provenance

The hero motion studies are the three supplied CloudFront videos. They are exposed as ten
selectable scene variants (three source videos plus seven color treatments). The high-contrast
motion/stripe direction was checked against the supplied GetDesign reference screenshot and
`/mnt/c/Users/dshakimov/Downloads/rema/web/DESIGN.md`.

Interactive primitives are source-owned implementations from shadcn/ui, with source URLs in the
component headers and in the page's “Sources” section:

- https://ui.shadcn.com/docs/components/button
- https://ui.shadcn.com/docs/components/card
- https://ui.shadcn.com/docs/components/tabs
- https://reactbits.dev/text-animations/blur-text

The page composition, tokens, scene recipes, and content are specific to Receipts. No customer
logos, live run claims, or provider credentials are embedded in the public site.

## Handoff status

The product implementation is on the `main` branch. The last shipped reliability slice is
commit `7e0942b`; this site redesign is the next commit. `receipts doctor` currently reaches the
Solari API but an identity-linked Anthropic key still needs a valid `ANTHROPIC_WORKSPACE_ID` before
agent trials can run. Never commit provider keys; rotate any key pasted into chat after testing.
