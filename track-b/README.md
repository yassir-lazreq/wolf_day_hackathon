# Track B starter kit

Everything you need to start Track B, except the dataset, which ships separately.

## The implemented solution

The complete Track B solution (extraction pipeline, batch worker, evaluation,
3D damage mapping, analytics, frontend) lives in `../solution/` — see
`solution/README.md` for architecture, setup and demo instructions. The
frontend pages under `/dashboard` (Übersicht, Vorgänge, Detail mit 3D-Viewer,
Evaluation) were built inside this starter kit and read their data from
`public/data/*.json`, which the solution worker generates.

## What is in here

- `CHALLENGE.md`: the participant hand-out. Read this first.
- `DATASET.md`: where the data comes from and what to expect.
- `frontend/`: the MUI front end skeleton you build into. Next.js 15, React 19, TypeScript, MUI 7.
- `reference-demo/`: a static reference implementation of a customer-facing vehicle status page with a 3D car viewer. Not part of the task, look at it for ideas about the visualization layer.

## Running the front end

Node 20 or newer. Yarn 1.22 is the package manager the lockfile was written with.

```
cd frontend
yarn
yarn dev
```

The dev server listens on http://localhost:8083. `yarn build` produces a production build.

No environment variables are required. `frontend/.env.example` lists every variable the code reads (server URL, assets dir, and credentials for the optional auth providers). Every one of them falls back to an empty string, so copy the file to `.env.local` only if you actually wire up a backend or an auth provider.

## Running the reference demo

It is plain HTML, one ES module, and a few assets. Any static server works:

```
cd reference-demo
python3 -m http.server 8000
```

Then open http://localhost:8000. Opening `index.html` directly from the file system does not work, because the module and the model files are fetched over HTTP.

The demo needs internet access on first load: three.js and the web font come from CDNs. The 3D models, the panorama, and the plate texture are local, under `reference-demo/assets/`.

The page starts on a code gate. The code is 482000 and is printed on the screen. After that you can step through the nine status stages with the rail, the arrow keys, or the buttons, open the technical view under each stage, and deep link to a stage with `#mw6` or to a sub status with `#mw6-2`.

The company name, the logo, the address and the phone number have been removed from this copy.
