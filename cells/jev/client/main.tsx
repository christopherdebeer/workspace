/* ---------------------------------------------------------------------------
 * jev · lab — an open library of unusual uses of Jev (TypeSafe System One).
 * Hash routes: #/ (library) · #/x/<id> (an experiment). Mobile first.
 * ------------------------------------------------------------------------- */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { EXPERIMENTS, type Experiment } from './experiments/index';
import { TraceStrip } from './ui';

const { useEffect, useState } = React;

const routeOf = (): string | null => {
  const m = location.hash.match(/^#\/x\/([\w-]+)/);
  return m ? m[1] : null;
};

function Library() {
  return (
    <>
      <section className="hero">
        <h1>jev · lab</h1>
        <p>
          Jev is a <em>System One</em> model: it never writes text, it answers typed questions — yes/no, a choice among up to 255 options, a score — with
          calibrated probabilities, many at once, in a few hundred milliseconds. This is a library of experiments that use it for things it was not built for.
        </p>
      </section>
      <div className="lib">
        {EXPERIMENTS.map((x) => (
          <Card key={x.id} x={x} />
        ))}
      </div>
    </>
  );
}

function Card({ x }: { x: Experiment }) {
  const body = (
    <>
      <span className="card-n">{x.n}</span>
      <h3>{x.title}</h3>
      <p>{x.blurb}</p>
      <div className="tags">
        <span className={`tag ${x.status}`}>{x.status}</span>
        {x.exploits.map((e) => (
          <span key={e} className="tag">
            {e}
          </span>
        ))}
      </div>
    </>
  );
  return x.status === 'live' ? (
    <a className="card live" href={`#/x/${x.id}`}>
      {body}
    </a>
  ) : (
    <div className="card idea">{body}</div>
  );
}

function App() {
  const [route, setRoute] = useState(routeOf());
  useEffect(() => {
    const on = () => {
      setRoute(routeOf());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const x = route ? EXPERIMENTS.find((e) => e.id === route && e.component) : undefined;
  const View = x?.component;
  return (
    <div className="shell">
      <nav className="top">
        <a href="#/">jev · lab</a>
        {x ? (
          <span className="crumb">
            {x.n} · {x.title}
          </span>
        ) : null}
      </nav>
      <main>
        {View ? <View /> : <Library />}
        {x?.findings?.length ? (
          <section className="panel notebook">
            <h2>Notebook</h2>
            <p className="sub">What live runs showed (jev-1.13.0). Findings change the experiment; the experiment changes the findings.</p>
            <ol>
              {x.findings.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ol>
          </section>
        ) : null}
      </main>
      <TraceStrip />
    </div>
  );
}

const root = document.getElementById('app')!;
root.textContent = '';
createRoot(root).render(<App />);
