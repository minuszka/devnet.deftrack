/**
 * Shared component styles, ported from the SCAN explorer so this site reads as
 * part of the same family. Do not invent a second design language here.
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
  }
  a:hover {
    color: var(--accent-strong);
    text-decoration: underline;
    text-underline-offset: 3px;
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
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-3);
  }
`;

/** Card / panel chrome. */
export const cardStyles = css`
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
  }
  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--line-soft);
  }
  .card-title {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--ink-2);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .card-title::before {
    content: '';
    width: 6px;
    height: 6px;
    background: var(--accent);
    display: inline-block;
  }
  .card-body { padding: 14px; }
  .card-body.flush { padding: 0; }
`;

/** Data table chrome. */
export const tableStyles = css`
  .twrap { overflow-x: auto; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
  }
  thead th {
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-3);
    text-align: left;
    padding: 8px 12px;
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
    background: var(--surface-2);
  }
  tbody td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--line-soft);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }
  tbody tr:last-child td { border-bottom: none; }
  tbody tr:hover td { background: var(--accent-wash); }
  th.r, td.r { text-align: right; }
  th.c, td.c { text-align: center; }
  .empty {
    padding: 28px 16px;
    text-align: center;
    color: var(--ink-3);
    font-family: var(--font-mono);
    font-size: 12.5px;
  }
`;

/** Page scaffolding: header row, grids. */
export const pageStyles = css`
  .page { display: flex; flex-direction: column; gap: 16px; }
  .page-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
  }
  h1 {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 19px;
    font-weight: 700;
    letter-spacing: 0.02em;
  }
  h1 .dim { color: var(--ink-3); font-weight: 400; }
  .page-sub { color: var(--ink-2); font-size: 13px; }
  .grid { display: grid; gap: 14px; }

  /* Stat tiles read as a row of figures to compare, not as a stack of cards to
     scroll past. auto-fit rather than a fixed count so a page with three or
     five tiles lays out on the same rule. */
  .tiles {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
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
    font-size: 12px;
    letter-spacing: 0.06em;
    padding: 6px 12px;
    background: var(--surface-2);
    color: var(--ink);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    cursor: pointer;
    transition: background 120ms, border-color 120ms;
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
    font-size: 13px;
    padding: 7px 10px;
    background: var(--bg-raised);
    color: var(--ink);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius);
    outline: none;
  }
  input:focus, select:focus, textarea:focus {
    border-color: var(--accent-dim);
    box-shadow: 0 0 0 2px var(--accent-wash-2);
  }
  .seg { display: inline-flex; border: 1px solid var(--line-strong); border-radius: var(--radius); overflow: hidden; }
  .seg button {
    font-family: var(--font-mono);
    font-size: 11.5px;
    letter-spacing: 0.05em;
    padding: 5px 11px;
    background: var(--surface-2);
    color: var(--ink-2);
    border: none;
    border-right: 1px solid var(--line-strong);
    cursor: pointer;
  }
  .seg button:last-child { border-right: none; }
  .seg button.on { background: var(--accent-wash-2); color: var(--accent); font-weight: 700; }
`;
