/* ---------------------------------------------------------------------------
 * playtest — the public face of @c15r/playtest. Hash routes:
 *   #/            what this is, how it works, live numbers, recent changes
 *   #/games       every game; create one        #/g/<slug>   a game's climb + definition
 *   #/eval/<id>   one eval                       #/run/<id>   one played game
 *   #/mechanics   what the engine implements     #/changes    the change log
 * Mobile first; reads are anonymous, writes need sign-in.
 * ------------------------------------------------------------------------- */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Home } from './pages/Home';
import { Games } from './pages/Games';
import { Game } from './pages/Game';
import { Eval } from './pages/Eval';
import { Run } from './pages/Run';
import { Mechanics } from './pages/Mechanics';
import { Changelog } from './pages/Changelog';

const { useEffect, useState } = React;

function useRoute(): string[] {
  const read = () => location.hash.replace(/^#\/?/, '').replace(/\?.*$/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [r, setR] = useState(read);
  useEffect(() => {
    const on = () => {
      setR(read());
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return r;
}

const TABS: Array<[string, string, string[]]> = [
  ['', 'About', ['']],
  ['games', 'Games', ['games', 'g', 'eval', 'run']],
  ['mechanics', 'Mechanics', ['mechanics']],
  ['changes', 'Changes', ['changes']],
];

function App() {
  const [head, a] = useRoute();
  const at = head ?? '';
  let body: React.ReactNode;
  if (at === 'games') body = <Games />;
  else if (at === 'g' && a) body = <Game slug={a} key={a} />;
  else if (at === 'eval' && a) body = <Eval id={a} key={a} />;
  else if (at === 'run' && a) body = <Run id={a} key={a} />;
  else if (at === 'mechanics') body = <Mechanics />;
  else if (at === 'changes') body = <Changelog />;
  else body = <Home />;
  return (
    <div className="shell">
      <nav className="top" aria-label="sections">
        <a className="brand" href="#/">
          playtest
        </a>
        {TABS.map(([h, label, on]) => (
          <a key={h} href={`#/${h}`} className={`tab${on.includes(at) ? ' on' : ''}`} aria-current={on.includes(at) ? 'page' : undefined}>
            {label}
          </a>
        ))}
      </nav>
      <main>{body}</main>
    </div>
  );
}

createRoot(document.getElementById('app')!).render(<App />);
