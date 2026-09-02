# Sigil — interactive demo

A small web app that lets you **build a delegation chain and verify it**, step by step, watching Sigil accept or
deny in real time. It drives the *real* library — `createArchonIssuer`, `verifyPresentation`, `attenuates` —
imported straight from `../src`; there is no mock verification logic. Every ACCEPT/DENY you see comes from
`verifyPresentation`.

## Run it

```bash
cd demo
npm install
npm run dev          # http://localhost:5173
```

`npm run build` produces a static bundle in `dist/` (`npm run preview` serves it).

## What you can do

1. **Cast** — mint a controller and agents (each its own `did:cid`).
2. **Grant & delegate** — issue a root authorization, then delegate *narrowed* slices down a chain. The editor
   greys out anything outside the parent: you can only narrow, never widen (monotonic attenuation).
3. **Chain** — see the chain root → leaf, with each hop's scope; revoke any hop.
4. **Present & verify** — the leaf presents the whole chain and asks to perform an action; the verifier walks it
   root → leaf and accepts or denies, with the check-class reason. Try an action the chain narrowed away, or an
   action for a different verifier, or verify after revoking a hop.
5. **Human step-up** — a **high-consequence** action (`delete`, `admin`) is denied on its own; a toggle lets the
   principal **co-sign** it (a fresh proof-of-human approval), lifting the result to `human-co-signed`.

The **"Load a 2-hop scenario"** button sets up a chain instantly for a quick tour.

## Offline vs. live

- **Offline (simulated)** — the default. The real verifier + issuer run entirely in your browser against an
  in-memory, content-addressed gatekeeper (the same design the library's tests use). Deterministic, no node, no
  network, no footprint.
- **Live node** — point it at a running Archon gatekeeper URL. Minting then creates *real* DIDs on that node, and
  resolution/verification hit it over HTTP. This needs the node to allow the browser's origin (**CORS**); if the
  connection fails, the demo reports it and stays offline.

## How it fits

The demo is a subdirectory of the Sigil repo on purpose: it imports the library from source via the `@sigil`
alias (see `vite.config.ts`), so it always tracks the current API and never needs the library published. It is a
separate npm package (`demo/package.json`) with its own dependencies; it is not part of the library's build or CI.
