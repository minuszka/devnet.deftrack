/**
 * Phase 0 shell. The SCAN design system (tokens, sc-* components, charts) is
 * ported in Phase 3; this only proves the toolchain renders.
 */
import { LitElement, css, html } from 'lit';
import { DEVNET_BANNER } from '@devnet-deftrack/shared';

class DdApp extends LitElement {
  static override styles = css`
    :host {
      display: block;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      background: #0b0e0c;
      color: #e6ede6;
      min-height: 100vh;
      padding: 24px;
    }
    .banner {
      border: 1px solid #a8e64b;
      color: #a8e64b;
      padding: 8px 12px;
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    h1 {
      font-size: 18px;
      font-weight: 700;
      margin: 24px 0 4px;
    }
    p {
      color: #9fac9f;
      font-size: 13px;
      margin: 0;
    }
  `;

  override render() {
    return html`
      <div class="banner">${DEVNET_BANNER}</div>
      <h1>devnet.deftrack</h1>
      <p>Phase 0 scaffolding. No data yet.</p>
    `;
  }
}

customElements.define('dd-app', DdApp);
