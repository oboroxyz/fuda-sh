# Shared UI

`@fuda/ui` is the shared Preact UI for all three frontends. Renderer-independent helpers remain on `/short`, `/theme`, `/camera` and `/scanner`. The API imports `/wallet-button`, a `hono/html` helper independent of Preact.

`test` exports the shared DOM mount, update, disposal and async-settle helpers. `hooks` exports a stable callback that calls the latest render's closure. `preferences` owns language and theme effects and cookie persistence, with cookie names and refresh behavior supplied by each app. `vite-pages` shares the pinned adapter setup and browser test compilation for app and dash; gate remains directly mounted.

`wallet-view` is a separate Preact entry so bundled Wallet artwork stays out of unrelated routes. Its buttons render ordinary escaped JSX and share bundled artwork with the API's Hono helper. QR markup is generated locally by the SDK. Scanner shares its camera lifecycle and labels with the renderer-independent UI modules.
