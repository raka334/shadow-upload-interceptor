export const overlayStyles = `
  :host { all: initial; color-scheme: dark; }
  *, *::before, *::after { box-sizing: border-box; }
  .si-scrim {
    position: fixed; inset: 0; display: grid; place-items: center; padding: 24px;
    background: rgba(4, 7, 10, .74); backdrop-filter: blur(8px);
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .si-backdrop { position: absolute; inset: 0; width: 100%; border: 0; background: transparent; cursor: default; }
  .si-card {
    position: relative; width: min(430px, 100%); border: 1px solid #2a343d; border-radius: 18px;
    padding: 22px; background: #10161c; color: #f5f7f9;
    box-shadow: 0 30px 90px rgba(0, 0, 0, .5); text-align: left;
  }
  .si-brand { display: flex; align-items: center; font-size: 13px; font-weight: 720; }
  .si-brand-mark {
    display: grid; width: 25px; height: 25px; place-items: center; margin-right: 8px;
    border: 1px solid rgba(85, 226, 166, .4); border-radius: 8px;
    background: rgba(85, 226, 166, .09); color: #5be0a8;
  }
  .si-brand-mark svg { width: 15px; }
  .si-brand-ai { color: #5be0a8; }
  .si-divider { height: 1px; margin: 18px -22px 24px; background: #222b33; }
  .si-alert-mark {
    display: grid; width: 45px; height: 45px; place-items: center;
    border: 1px solid rgba(255, 105, 118, .28); border-radius: 13px;
    background: rgba(255, 91, 106, .1); color: #ff7581;
  }
  .si-alert-mark svg { width: 26px; }
  svg { fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  h1 { margin: 17px 0 8px; color: #f6f8fa; font-size: 24px; line-height: 1.2; letter-spacing: -.035em; }
  p { margin: 0; color: #9ca8b2; font-size: 13px; line-height: 1.65; }
  p strong { color: #e5eaee; font-weight: 650; overflow-wrap: anywhere; }
  .si-primary {
    width: 100%; margin-top: 23px; border: 0; border-radius: 10px; padding: 11px 16px;
    background: #58dfa7; color: #07110d; cursor: pointer; font: inherit;
    font-size: 13px; font-weight: 760; transition: background 130ms ease, transform 130ms ease;
  }
  .si-primary:hover { transform: translateY(-1px); background: #6ce8b4; }
  .si-primary:focus-visible { outline: 2px solid #d7ffed; outline-offset: 3px; }
  .si-footnote { display: block; margin-top: 13px; color: #65727d; font-size: 10px; text-align: center; }
  @media (prefers-reduced-motion: reduce) { .si-primary { transition: none; } }
`;
