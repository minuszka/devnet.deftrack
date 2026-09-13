import type { ReactiveController, ReactiveControllerHost } from 'lit';

type Host = ReactiveControllerHost & HTMLElement & { renderRoot: ParentNode };

/** Past this many pixels of hidden content a wrapper counts as scrollable. */
const SLACK_PX = 1;

/**
 * Says, on each table wrapper of a page, whether it scrolls sideways and which
 * way there is more.
 *
 * A wide table on a narrow screen scrolls inside its own `.twrap`, which is the
 * right thing -- the document stays put and the table keeps its columns. But
 * nothing said so. On a phone the scrollbar is an overlay that is not drawn
 * until the table is touched, so the columns past the edge were simply not
 * there as far as the reader could tell, and a table cut at "Health" read as a
 * table that ends at "Health".
 *
 * The controller only measures. It sets three attributes and the shared table
 * styles draw from them:
 *
 *   data-scrollable   the table is wider than its wrapper
 *   data-more-start   columns are hidden to the left
 *   data-more-end     columns are hidden to the right
 *
 * A scrollable wrapper is also given `tabindex="0"` and a name, so a keyboard
 * reader can reach it and scroll it with the arrow keys; a wrapper that fits
 * loses both again, rather than leaving a tab stop that does nothing.
 *
 * Measured, never assumed from the viewport: whether a table overflows depends
 * on its contents as much as on the screen, and a breakpoint would be wrong in
 * both directions.
 */
export class TableScrollController implements ReactiveController {
  private readonly _wired = new Map<HTMLElement, () => void>();
  private _observer: ResizeObserver | null = null;

  constructor(private readonly host: Host) {
    host.addController(this);
  }

  hostConnected(): void {
    this._observer = new ResizeObserver((entries) => {
      const wrappers = new Set<HTMLElement>();
      for (const entry of entries) {
        const target = entry.target as HTMLElement;
        const wrapper = target.classList.contains('twrap') ? target : target.closest<HTMLElement>('.twrap');
        if (wrapper && this._wired.has(wrapper)) wrappers.add(wrapper);
      }
      // A frame later, not inside the callback: the hint line these attributes
      // switch on changes the wrapper's height, and resizing an observed element
      // from inside its own callback is the "ResizeObserver loop" error.
      requestAnimationFrame(() => {
        for (const wrapper of wrappers) if (this._wired.has(wrapper)) this._measure(wrapper);
      });
    });
    // Reconnected after a disconnect: whatever was rendered is still there.
    this._scan();
  }

  /**
   * After every render, because that is when a table appears, disappears, or
   * gains the rows that make it wider -- none of which resizes the wrapper.
   */
  hostUpdated(): void {
    this._scan();
  }

  hostDisconnected(): void {
    for (const cleanup of this._wired.values()) cleanup();
    this._wired.clear();
    this._observer?.disconnect();
    this._observer = null;
  }

  private _scan(): void {
    if (this._observer === null) return;
    const wrappers = Array.from(this.host.renderRoot.querySelectorAll<HTMLElement>('.twrap'));
    for (const [wrapper, cleanup] of this._wired) {
      if (!wrappers.includes(wrapper)) {
        cleanup();
        this._wired.delete(wrapper);
      }
    }
    for (const wrapper of wrappers) {
      if (!this._wired.has(wrapper)) this._wire(wrapper);
      this._measure(wrapper);
    }
  }

  private _wire(wrapper: HTMLElement): void {
    const observer = this._observer;
    if (observer === null) return;
    const onScroll = (): void => this._measure(wrapper);
    wrapper.addEventListener('scroll', onScroll, { passive: true });
    observer.observe(wrapper);
    const table = wrapper.querySelector('table');
    if (table) observer.observe(table);
    this._wired.set(wrapper, () => {
      wrapper.removeEventListener('scroll', onScroll);
      observer.unobserve(wrapper);
      if (table) observer.unobserve(table);
    });
  }

  private _measure(wrapper: HTMLElement): void {
    const hidden = wrapper.scrollWidth - wrapper.clientWidth;
    const scrollable = hidden > SLACK_PX;
    toggle(wrapper, 'data-scrollable', scrollable);
    toggle(wrapper, 'data-more-start', scrollable && wrapper.scrollLeft > SLACK_PX);
    toggle(wrapper, 'data-more-end', scrollable && wrapper.scrollLeft < hidden - SLACK_PX);

    if (scrollable) {
      if (!wrapper.hasAttribute('tabindex')) wrapper.setAttribute('tabindex', '0');
      if (!wrapper.hasAttribute('role')) wrapper.setAttribute('role', 'group');
      const caption = wrapper.querySelector('caption')?.textContent?.trim();
      const name = `${caption || 'Table'} (scrolls sideways)`;
      if (wrapper.getAttribute('aria-label') !== name) wrapper.setAttribute('aria-label', name);
    } else {
      wrapper.removeAttribute('tabindex');
      wrapper.removeAttribute('role');
      wrapper.removeAttribute('aria-label');
    }
  }
}

function toggle(element: HTMLElement, attribute: string, on: boolean): void {
  if (on) {
    if (!element.hasAttribute(attribute)) element.setAttribute(attribute, '');
  } else if (element.hasAttribute(attribute)) {
    element.removeAttribute(attribute);
  }
}
