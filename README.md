# Mise — food journal

[Open the deployed app](https://mise-food-journal.isabelarvelo87.chatgpt.site)

Mise is a food and nutrition journal. Capture meals with text, photos, or voice notes; review nutrition estimates; save reusable foods and recipes; and compare daily intake with your goals. Receipt capture helps add purchased foods to your library.

The link above opens the published version. Checking out `visual-diversity` only changes your local code; use the local server below to test that branch before publishing.

## Run locally and test `visual-diversity`

Requires **Node.js 22.13 or newer** and npm. Run these commands from the repository root (`nutrition-tracker/` in the surrounding workspace):

```bash
git switch visual-diversity
npm ci
```

If Git reports conflicting local edits, commit or stash them before switching. If the branch exists only on your remote, fetch it first with `git fetch origin`. An unpublished local branch must be pushed before another checkout can fetch it.

If you do not already have a `.env`, copy the example:

```bash
cp -n .env.example .env
```

Configure the features you want to exercise:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | AI meal/photo parsing, receipt reading, web food research, and voice transcription. |
| `OPENAI_MODEL` | Text and web-research model; example values are in `.env.example`. |
| `OPENAI_VISION_MODEL` | Image-parsing model. |
| `OPENAI_TRANSCRIBE_MODEL` | Optional voice-transcription override; defaults to `whisper-1`. |
| `USDA_API_KEY` | Optional USDA FoodData Central lookup key. |

Use models available to your API account. Basic journaling and built-in food matching can be tested without AI credentials; AI-dependent flows need a working key. Open Food Facts lookup does not require a key. Keep credentials in ignored environment files, never in source control.

### Initialize the local database

The Vite configuration provides local Cloudflare D1 (`DB`) and R2 (`FILES`) bindings. Data persists under `.wrangler/state/`, separately from the deployed app. On a fresh checkout, apply the SQL migrations before using the journal.

Create an ignored, local-only Wrangler configuration:

```bash
mkdir -p .wrangler
cat > .wrangler/local-db.json <<'JSON'
{
  "name": "mise-local",
  "d1_databases": [{
    "binding": "DB",
    "database_name": "site-creator-d1",
    "database_id": "00000000-0000-4000-8000-000000000000",
    "migrations_dir": "../drizzle"
  }]
}
JSON
npm run db:migrate -- DB --local --config .wrangler/local-db.json --persist-to .wrangler/state
npm run dev -- --port 3000
```

Open [http://localhost:3000](http://localhost:3000). Development supports a local user; production uses the identity supplied by Sites. Local data is not synced to the live app. Re-run the migration command after pulling new migrations. A `no such table` error usually means migrations have not been applied to the local database.

### Validate changes

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

The test suite covers date handling, portions, meal parsing, estimates, receipts, and food-research validation. For a manual check, add a meal, edit its portion, reload to confirm persistence, check daily totals, and save/reuse a library item. With API credentials configured, also try photo, receipt, and voice capture. Camera and microphone access require browser permission and a secure context such as localhost or HTTPS.

`npm run start` invokes the production preview command. Use `npm run dev` for local branch testing with the configured local bindings and development authentication.

## How it works

1. **Capture:** The React interface collects meal descriptions and optional evidence. Voice recordings are transcribed through `/api/transcribe`; files are stored through `/api/files`; receipts are parsed through `/api/receipt`.
2. **Resolve nutrition:** Server logic parses foods and portions, matches saved foods and built-in entries, and can consult USDA, Open Food Facts, and AI-assisted web research. Results carry source and confidence information, with unresolved foods left available for review.
3. **Store:** `/api/state` reads and updates meals, logged foods, evidence, the food library, and goals in D1. R2 stores uploaded files. Records are scoped to the authenticated user.
4. **Review:** The journal presents meals by date, nutrient totals, goals, and reusable library items. Nutrition values may be estimates and can be reviewed and corrected.

The app uses React and Next.js App Router conventions, served by **vinext + Vite** on a Cloudflare Workers-compatible runtime. Drizzle defines the database schema and generates SQL migrations.

| Location | Responsibility |
| --- | --- |
| `app/MiseApp.tsx`, `app/components/`, `app/globals.css` | Journal interface and styling. |
| `app/api/` | State, uploads, search, receipt, and transcription endpoints. |
| `app/lib/resolve/`, `app/food-research.ts` | Food parsing, portion handling, and nutrition lookup. |
| `db/schema.ts`, `drizzle/` | Database schema and versioned migrations. |
| `vite.config.ts` | Build plugins and local Worker bindings. |
| `.openai/hosting.json` | Existing Sites project and logical D1/R2 bindings. |

## Deploy with Sites

This repository is configured for **OpenAI Sites**. Deployment requires access to the existing Sites project and the Sites tools in Codex. It is a server-backed app, so uploading static assets alone is insufficient. There is no `npm run deploy` script.

1. Check out the branch you intend to publish and run the validation commands above. If you changed `db/schema.ts`, run `npm run db:generate`, review the generated SQL, and include it in the source change before building.
2. Configure runtime secrets and model settings in Sites. Local `.env` files are not deployed. Retain the existing project ID and the `DB` / `FILES` bindings in `.openai/hosting.json`.
3. Ask Codex, with the Sites plugin available: **“Deploy this nutrition-tracker checkout from visual-diversity to the existing Mise site.”** Review which local changes will be included before publishing.
4. The Sites workflow commits and pushes the validated source, packages the Worker build and migrations with the plugin's `package-site.sh` helper, saves a version tied to that commit, and deploys it according to the site's access settings. It then checks deployment status and returns the live URL.
5. Open the deployed app and verify authentication, meal persistence, uploads, and the enabled AI flows.

Publishing updates the live site; it does not create an isolated branch preview. For testing without changing the live app, use the local instructions above. Hosting elsewhere would require real Cloudflare resources and a trusted authentication integration; the database ID in `vite.config.ts` is only a local placeholder.
