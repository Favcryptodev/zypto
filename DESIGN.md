---
version: alpha
name: Zypto Tax Console
description: Ethereum token owner controls with explicit deployment and transaction states.
colors:
  primary: "#dcff85"
  background: "#10131b"
  surface: "#181d27"
  text: "#f1f3f8"
  muted: "#aeb7c7"
  danger: "#ffb4a8"
  border: "#303745"
typography:
  sans:
    fontFamily: "Inter, Arial, sans-serif"
  mono:
    fontFamily: "monospace"
rounded:
  control: "9px"
  panel: "16px"
spacing:
  page-max: "1060px"
  panel-gap: "20px"
components:
  button:
    height: "48px"
  card:
    rounded: "{rounded.panel}"
---

# Zypto Tax Console Design System

## Overview

Product register: one public Ethereum administration screen for ZYPTO holders and the token owner. English is the supported language; no Japan-specific market behavior is requested. Desktop wallet extensions and mobile wallet in-app browsers are the supported connection surfaces. Preserve the existing dark instrument-panel identity: token address, measured percentages, planned allocation and receiver deployment state carry the hierarchy. The oversized 0.1 / 3.9 allocation is its signature. Avoid promotional claims, decorative charts, or a rebrand for the custom domain.

The explicit user request and verified token/receiver contracts govern behavior. The receiver is now deployed at the fixed trusted address in dist/deployment.js. Public reads are available to everyone; only the current token owner on Ethereum may review and confirm the three setup calls, one at a time. The intended 10/390 sell fee plan is prefilled, and buy fees are preserved. No receiver, fee or destination is taken from user input, storage or URLs. The receiver requires fee exemption even with zero buy fees. Connecting does not send or sign; QR pairing is not configured.

Runtime ownership is Model B: `dist/style.css` is canonical. The frontmatter mirrors the accepted runtime values; no generator or framework adapter exists.

## Colors

`--color-action` maps primary to wallet/owner actions; `--color-bg`, `--color-surface`, `--color-text`, `--color-muted`, `--color-error`, and `--color-line` map the other palette roles directly. Existing CSS literals in the original panels retain these same values. Errors also have explanatory text. The deployment notice uses a muted amber surface distinct from primary actions. Forced-colors uses system borders and scrollbars.

## Typography

Use the existing Inter/Arial/system sans stack for controls and prose, monospace for addresses and calldata. Body text is 16px, captions 13px, primary heading 48px (40px below 700px). Addresses wrap without hiding characters. Dynamic wallet names are text, never HTML or SVG.

## Layout

One natural-height document; main width 1060px. The two configuration cards become a single column at 700px. Wallet controls wrap, then use a two-column mobile grid with the wallet choice and Connect action spanning both columns. Keep live-region and help geometry reserved. Scrollbar styling belongs to the global stylesheet with stable gutter and system-operable high contrast.

## Elevation & Depth

Flat tonal surfaces and 1px borders express hierarchy; no shadows or overlay layer is needed. The wallet panel and token panel share the established panel surface.

## Shapes

`--radius-control` is 9px and `--radius-panel` is 16px. Existing input radius 8px remains an established minor variant. The deployment notice uses a left rule to connect the warning to its text.

## Components

### Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Select/Listbox | Native `walletSelect` | `dist/index.html`, `dist/app.js` | Browser/OS popup geometry accepted | Browser keyboard/open popup, wallet tests |
| Scrollbar | Global CSS | `dist/style.css` | Forced-colors system fallback | Browser computed style |
| Toast | Setup flow state and stable live regions | `render`, `walletState`, `readState`, `status` | Persistent inline status; no transient toast | Browser and mocks |

Buttons keep visible focus and stable minimum height. Connecting disables duplicate requests and shows text progress. Disconnect clears the page session; wallet permissions remain controlled by the wallet. Account/network/disconnect events invalidate owner state and pending preflight work. Wrong-network, cancellation, pending-request, authorization, missing-wallet and timeout states provide recovery text. No secret or account state is persisted.

Trusted configuration is owned by dist/deployment.js; the setup state machine and Ethereum adapter in dist/setup.js own checks, ordered steps, quote/review, wallet requests and receipt reconciliation. Review next step opens an inline review; Confirm in wallet is a separate explicit action. Runtime code hashes and receiver destinations must match before each transaction. Gas increases, changed buy fees, account/network changes and expired reviews require fresh review. Rejection/reversion stops; uncertain outcomes lock further writes until checked. No automatic batch or process call is available.

The review is a native document section with a focusable heading, semantic details/summary for calldata and an accessible definition list. Persistent live regions carry status; the transaction explorer link remains available. Destinations and values are text, never editable fields. Mobile review rows stack without clipping. Native controls retain keyboard focus and reduced motion support.

## Do's and Don'ts

- Do preserve the original token percentages and wallet confirmation boundary.
- Do label public read state, wallet state, receiver deployment and transaction state separately.
- Don't describe an ordinary WETH transfer as an automatic processing trigger.
- Don't equate bytecode checks with a security audit or claim connecting a wallet executes a transaction.
