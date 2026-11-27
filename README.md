# AuraGen

AuraGen is a React form demo that monitors interaction friction and can switch
to a guided, schema-driven form. The browser uses structured instructions
rendered by React; it **never evaluates or injects generated JavaScript**.

## Architecture

- **Frontend:** React, TypeScript, and Vite (`frontend/`). The form state remains
  in the browser while users move between the full form and the guided wizard.
- **Backend:** Node.js, Express, and the native `ws` WebSocket server (`server/`).
  It validates origins, caps WebSocket frames at 64 KB, limits each connection
  to 100 messages per second, scores telemetry, and coordinates redesigns.
- **Friction pipeline:** The frontend batches interaction metadata without
  input values. The backend computes a cognitive-load score and triggers a
  redesign after the configured threshold is sustained.
- **Privacy boundary:** A snapshot contains only non-sensitive schema fields
  and their values. Sensitive fields such as SSN stay in local form state and
  are removed again at the backend before generation. The LLM receives masked
  non-sensitive values, never their contents.
- **Redesign rendering:** The backend currently returns a validated compiled
  component in `redesign:ready`. The frontend treats that code as data only and
  builds safe, structured wizard instructions from the form schema instead.

## Requirements

- Node.js 20 or newer
- npm

No paid API, API key, or external hosting is needed in mock mode.

## Setup and run

Install backend and frontend dependencies from the project root:

```powershell
npm install
Set-Location frontend
npm install
Set-Location ..
```

Create a root `.env` file for local development:

```dotenv
MOCK_LLM=true
PORT=4000
ALLOWED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
```

`MOCK_LLM=true` is the default development mode and does not require an API
key. Start the backend and frontend in separate terminals:

```powershell
# Terminal 1, project root
npm run dev
```

```powershell
# Terminal 2, project root
Set-Location frontend
npm run dev
```

Open the Vite URL (normally `http://localhost:5173`). The backend health check
is available at `http://localhost:4000/health`. Keep the configured
`ALLOWED_ORIGINS` limited to the exact frontend origins you intend to serve.

## Friction detection and redesign

1. The browser sends batched mouse/field interaction metadata over the native
   WebSocket, including empty half-second heartbeats while the form is active
   so idle hesitation can continue to be scored. It does not send typed values
   as telemetry.
2. The backend scores velocity variance, hesitation, rage clicks, and errors.
   Defaults are a score threshold of `70` sustained for `3000 ms`; configure
   these with `CLS_THRESHOLD` and `CLS_SUSTAIN_MS`.
3. When friction is sustained, the backend sends `redesign:started` and asks
   for a `snapshot:request`.
4. The frontend responds with the non-sensitive schema and values. The backend
   strips sensitive fields and values again before generation.
5. On `redesign:ready`, the frontend ignores executable code and generates
   data-only wizard instructions from the safe form schema. The simplified UI
   activates automatically; the manual **Simulate AI Redesign** action remains
   available for testing.
6. Form values are merged into the original state throughout the wizard.
   Review, Back/Continue, and final submission retain fields that were not
   changed in the simplified flow.

## Testing

From the project root, run backend tests:

```powershell
npm test
```

From the `frontend/` directory, type-check and create a production build:

```powershell
npx tsc --noEmit
npm run build
```

The backend tests cover the security controls, snapshot coordination,
redesign pipeline, and mock mode. For a live manual flow, run both servers,
use **Simulate AI Redesign** to check wizard rendering/navigation/submission,
and optionally use `server/tests/manual/redesign-smoke.js` for the backend WebSocket
snapshot-to-redesign exchange.

## Limitations and future improvements

- The demo backend acknowledges a submission but does not persist applications
  or connect to a lending service.
- Mock mode returns deterministic generated output; a configured external LLM
  is optional and is not required for local development.
- The current application schema describes the loan form. The schema-to-wizard
  conversion is reusable, but connecting a different form also requires
  adapting the application's typed state and submission handler.
- Generated components are validated and compiled on the backend but are not
  executed in the browser. A future redesign protocol could return a strictly
  validated structured layout instead of compiled code.
- The current friction thresholds and weights are demo defaults and should be
  calibrated with representative usability sessions before production use.
