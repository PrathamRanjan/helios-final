# HELIOS

A sustainability planning app for Singapore, Bangkok, Hanoi and eight Indian cities: Bengaluru, Delhi NCR, Mumbai, Hyderabad, Chennai, Kolkata, Pune and Ahmedabad.

Implemented: rooftop solar assessment, LCOE and 20-year savings, an India urban scenario sandbox with drag-to-select areas, Singapore planning simulations, reports, AI explanations and agent tools. India sandbox results are screening estimates.

## Repository structure

- `web/` — Next.js interface, API routes, simulation models, bundled datasets/assets and regression checks.
- `engine/` — Python/FastAPI calculations, calibration tools, Google ADK agents, dataset catalogue, provenance and tests.
- `deploy/` — Cloud Run and runtime configuration templates.
- `scripts/deploy/` — cloud setup, build, deploy, data upload and smoke checks.
- `tests/deploy/` — deployment tooling checks.

Only the active application and its supporting code/data are included. Old app versions, research documents, chat logs, credentials, dependencies and build output are excluded.

## Local use

Requires Node.js 22+ and Python 3.11. Run `npm run install:web`, copy `web/.env.example` to `web/.env.local`, and supply your own Google Maps, Solar and Gemini keys. Install `engine/requirements.txt` in a Python virtual environment. Start `uvicorn api.main:app --port 8081` from `engine/` with `GEMINI_API_KEY` and `HELIOS_APP_URL=http://127.0.0.1:3000`; run `npm run dev` from the repository root. Open http://localhost:3000.

Checks: `npm run verify` and `python3 -m unittest discover -s tests/deploy -v`.
