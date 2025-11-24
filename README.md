# ZynDash X — Real-Time Analytics Dashboard

ZynDash X is a premium, futuristic dashboard that streams live crypto, weather, and currency intelligence with adaptive dark/light theming, glassmorphic UI, and animated Chart.js visualizations.

## Features
- Live BTC and ETH pricing from CoinCap with 20s refresh cadence, WebSocket streaming, and animated line updates
- Scarborough weather via Open-Meteo with animated atmospheric bars
- USD→EUR/GBP conversions from Frankfurter in a responsive pie split
- Glassmorphism UI with neon glows, animated hovers, and expressive Space Grotesk typography
- Dark/Light Zyntriax themes with persisted preference and auto-updating chart palettes
- Fully responsive grid and flex layout with mobile bottom navigation

## APIs Used
- **CoinCap** — `https://api.coincap.io/v2/assets/bitcoin`, `https://api.coincap.io/v2/assets/ethereum`, `https://api.coincap.io/v2/assets?ids=bitcoin,ethereum`, `wss://ws.coincap.io/prices?assets=bitcoin,ethereum`
- **Open-Meteo** — `https://api.open-meteo.com/v1/forecast?latitude=54.28&longitude=-0.40&current_weather=true`
- **Frankfurter** — `https://api.frankfurter.app/latest?from=USD&to=EUR,GBP`

## Screenshots
- Dark mode: `assets/screenshots/zyndash-dark.png` *(placeholder)*
- Light mode: `assets/screenshots/zyndash-light.png` *(placeholder)*

## Running the Project
1. Open `index.html` in your browser (no build step required).
2. Ensure network access is allowed so live APIs can stream data.
3. Toggle dark/light mode from the header to experience theme sync with charts.

## Technologies
- HTML5, CSS3 (glassmorphism, responsive grid/flex)
- Vanilla JavaScript (fetch API, localStorage, theming)
- Chart.js (via CDN) for animated charts
- Google Fonts — Space Grotesk

## Folder Structure
```
ZynDash-X/
├── index.html
├── style.css
├── script.js
├── assets/
│   ├── icons/
│   └── logos/
└── README.md
```
