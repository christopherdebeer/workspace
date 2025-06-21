import { createGlobalStyle } from 'styled-components';

const GlobalStyle = createGlobalStyle`
  *, *::before, *::after {
    box-sizing: border-box;
  }
  body {
    margin: 0;
    font-family: 'Inter', sans-serif;
    background: #f5f5f5;
    color: #222;
    -webkit-font-smoothing: antialiased;
  }
`;

export default GlobalStyle;
