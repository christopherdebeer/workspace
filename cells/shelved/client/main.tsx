import * as React from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { App } from './App';

const root = document.getElementById('app')!;
if (root.dataset.ssr === '1') hydrateRoot(root, <App />);
else createRoot(root).render(<App />);
