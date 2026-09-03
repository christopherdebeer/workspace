import { createGlobalStyle } from './styled';

export const theme = {
  paper: '#f5efe4',
  paperRaised: '#fffaf1',
  ink: '#28211d',
  moss: '#315448',
  mossSoft: '#dce7df',
  clay: '#a84f3e',
  claySoft: '#efd9d1',
  gold: '#cf9b48',
  blue: '#55788a',
  line: '#d9cdbb',
  quiet: '#756c62',
  shadow: '0 12px 36px rgba(72, 53, 37, 0.10)',
  serif: 'Iowan Old Style, Palatino, Georgia, serif',
  sans: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

export const GlobalStyle = createGlobalStyle`
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html { background: ${theme.paper}; scroll-behavior: smooth; }
  body { margin: 0; background: ${theme.paper}; color: ${theme.ink}; font-family: ${theme.sans}; -webkit-font-smoothing: antialiased; }
  button, input, select, textarea { font: inherit; }
  button { touch-action: manipulation; }
  a { color: inherit; }
  ::selection { background: ${theme.mossSoft}; }
`;
