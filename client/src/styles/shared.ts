/**
 * Shared component styles, ported from the SCAN explorer so this site reads as
 * part of the same family. Do not invent a second design language here.
 *
 * Sizes come from the type scale and the spacing scale in global.css; a value
 * typed here by hand is a value that will drift from every other component.
 */
import { css } from 'lit';

/** Base styles shared by every component (host reset + common utilities). */
export const baseStyles = css`
  :host {
    display: block;
    font-family: var(--font-sans);
    color: var(--ink);
  }
  a {
    color: var(--accent);
    text-decoration: none;
    transition: color var(--t-fast) var(--ease);
  }
  a:hover {
    color: var(--accent-strong);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  /* Keyboard focus is a state the eye must find: the same ring everywhere. */
  :focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
    border-radius: var(--radius);
  }
  .mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .muted { color: var(--ink-2); }
  .subtle { color: var(--ink-3); }
  .num { font-variant-numeric: tabular-nums; }
  .up { color: var(--good); }
  .down { color: var(--crit); }

  .microlabel {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-3);
  }

  /* Status badges. Text carries the state; the colour only agrees with it. */
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    line-height: 1;
    padding: 5px 8px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    color: var(--ink-2);
    background: var(--surface-2);
    white-space: nowrap;
  }
  .pill::before {
    content: '';
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
    flex: none;
  }
  .pill.formed, .pill.committed, .pill.good, .pill.ok, .pill.closed {
    color: var(--good);
    border-color: color-mix(in srgb, var(--good) 45%, transparent);
    background: var(--good-wash);
  }
  .pill.failed, .pill.crit, .pill.bad, .pill.banned {
    color: var(--crit);
    border-color: color-mix(in srgb, var(--crit) 45%, transparent);
    background: var(--crit-wash);
  }
  .pill.pending, .pill.warn, .pill.running, .pill.absent {
    color: var(--warn);
    border-color: color-mix(in srgb, var(--warn) 45%, transparent);
    background: var(--warn-wash);
  }
  .pill.impossible, .pill.muted {
    color: var(--ink-3);
  }
  .pill.accent {
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    background: var(--accent-wash);
  }

  /* A hash: monospace, tabular, and never the reason a row wraps. */
  .hash {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.01em;
  }

  /* Loading placeholders that hold the layout still while data is on its way. */
  .skeleton {
    display: block;
    border-radius: var(--radius);
    background: linear-gradient(90deg, var(--surface-2) 0%, var(--surface-3) 50%, var(--surface-2) 100%);
    background-size: 200% 100%;
    animation: shimmer 1.4s var(--ease) infinite;
    min-height: 1em;
  }
  @keyframes shimmer {
    from { background-position: 200% 0; }
    to { background-position: -200% 0; }
  }

  /* First paint of a panel: a short settle, never a slide-show. */
  .enter {
    animation: enter var(--t-slow) var(--ease) both;
  }
  @keyframes enter {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: none; }
  }

  /* A value that just changed says so for a moment, then goes quiet. */
  .changed {
    animation: changed 700ms var(--ease) both;
  }
  @keyframes changed {
    from { background: var(--accent-wash-2); box-shadow: 0 0 0 4px var(--accent-wash-2); }
    to { background: transparent; box-shadow: 0 0 0 4px transparent; }
  }

  /* A dot that says "live": it breathes, and it stops when asked to. */
  .live-dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 0 0 var(--accent-wash-2);
    animation: breathe 2.4s var(--ease) infinite;
    flex: none;
  }
  @keyframes breathe {
    0% { box-shadow: 0 0 0 0 rgba(168, 230, 75, 0.45); }
    70% { box-shadow: 0 0 0 7px rgba(168, 230, 75, 0); }
    100% { box-shadow: 0 0 0 0 rgba(168, 230, 75, 0); }
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
    }
  }
`;

/** Card / panel chrome. */
export const cardStyles = css`
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow);
  }
  .card.link {
    transition: border-color var(--t-base) var(--ease), box-shadow var(--t-base) var(--ease);
  }
  .card.link:hover {
    border-color: var(--line-strong);
    box-shadow: var(--shadow-2);
  }
  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--sp-3);
    padding: var(--sp-3) var(--sp-4);
    border-bottom: 1px solid var(--line-soft);
  }
  .card-title {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-2);
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .card-title::before {
    content: '';
    width: 7px;
    height: 7px;
    background: var(--accent);
    display: inline-block;
  }
  .card-body { padding: var(--sp-4); }
  .card-body.flush { padding: 0; }
`;

/** Data table chrome. */
export const tableStyles = css`
  .twrap { overflow-x: auto; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--fs-sm);
  }
  thead th {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-3);
    text-align: left;
    padding: var(--sp-3) var(--sp-4);
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
    background: var(--surface-2);
  }
  tbody td {
    padding: 11px var(--sp-4);
    border-bottom: 1px solid var(--line-soft);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    vertical-align: middle;
    transition: background var(--t-fast) var(--ease);
  }
  tbody tr:nth-child(even) td { background: var(--zebra); }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:hover td { background: var(--accent-wash); }
  th.r, td.r { text-align: right; }
  th.c, td.c { text-align: center; }
  td.strong { color: var(--ink); font-weight: 600; }
  .empty {
    padding: var(--sp-6) var(--sp-4);
    text-align: center;
    color: var(--ink-3);
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
  }
`;

/** Page scaffolding: header row, grids. */
export const pageStyles = css`
  .page { display: flex; flex-direction: column; gap: var(--sp-4); }
  .page-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--sp-2) var(--sp-4);
    margin-bottom: var(--sp-4);
  }
  .page-title,
  h1 {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--fs-xl);
    font-weight: 700;
    letter-spacing: 0.02em;
    line-height: 1.2;
  }
  h1 .dim { color: var(--ink-3); font-weight: 400; }
  .page-sub { color: var(--ink-2); font-size: var(--fs-sm); margin-top: var(--sp-1); }
  .grid { display: grid; gap: var(--sp-4); }

  /* Stat tiles read as a row of figures to compare, not as a stack of cards to
     scroll past. auto-fit rather than a fixed count so a page with three or
     five tiles lays out on the same rule. */
  .tiles {
    display: grid;
    gap: var(--sp-4);
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  }
  @media (max-width: 520px) {
    .tiles { grid-template-columns: 1fr; }
  }
  .cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  @media (max-width: 1000px) {
    .cols-4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .cols-3 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 640px) {
    .cols-4, .cols-3, .cols-2 { grid-template-columns: 1fr; }
  }
`;

/** Form controls (inputs, selects, buttons) in the SCAN look. */
export const controlStyles = css`
  .btn {
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    letter-spacing: 0.06em;
    padding: var(--sp-2) var(--sp-4);
    background: var(--surface-2);
    color: var(--ink);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    cursor: pointer;
    transition: background var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease);
  }
  .btn:hover:not(:disabled) { background: var(--surface-3); border-color: var(--ink-3); }
  .btn:disabled { opacity: 0.4; cursor: default; }
  .btn.primary {
    background: var(--accent);
    color: var(--accent-ink);
    border-color: var(--accent);
    font-weight: 700;
  }
  .btn.primary:hover:not(:disabled) { background: var(--accent-strong); }
  .btn.on {
    background: var(--accent-wash-2);
    border-color: var(--accent-dim);
    color: var(--accent);
  }
  input[type='text'], input[type='search'], input[type='number'], select, textarea {
    font-family: var(--font-mono);
    font-size: var(--fs-sm);
    padding: var(--sp-2) var(--sp-3);
    background: var(--bg-raised);
    color: var(--ink);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    outline: none;
    transition: border-color var(--t-fast) var(--ease), box-shadow var(--t-fast) var(--ease);
  }
  input:focus, select:focus, textarea:focus {
    border-color: var(--accent-dim);
    box-shadow: 0 0 0 2px var(--accent-wash-2);
  }
  .seg { display: inline-flex; border: 1px solid var(--line-strong); border-radius: var(--radius); overflow: hidden; }
  .seg button {
    font-family: var(--font-mono);
    font-size: var(--fs-xs);
    letter-spacing: 0.05em;
    padding: 7px 13px;
    background: var(--surface-2);
    color: var(--ink-2);
    border: none;
    border-right: 1px solid var(--line-strong);
    cursor: pointer;
    transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
  }
  .seg button:last-child { border-right: none; }
  .seg button:hover { color: var(--ink); }
  .seg button.on { background: var(--accent-wash-2); color: var(--accent); font-weight: 700; }
`;
