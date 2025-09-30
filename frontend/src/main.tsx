import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import OAuthPage from './OAuthPage';

function Router() {
  const path = window.location.pathname;

  if (path === '/oauth') {
    return <OAuthPage />;
  }

  return <App />;
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <Router />
  </React.StrictMode>
);
