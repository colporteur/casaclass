# Casa Class

The official app of our Wednesday-morning discussion group. A bright, install-to-your-phone PWA that tracks speakers, programs, transcripts, AI summaries, resources, questions, and topic ideas.

## What's inside

- **React + Vite + Tailwind** frontend, installable as a PWA
- **Supabase** for the shared database, realtime sync, and the Claude API proxy
- **GitHub Pages** for static hosting (no servers to babysit)
- **Claude Sonnet 4.6** for transcript summaries

The app is "truly open" — no logins. Anyone with the URL can read and edit. A name picker in the corner attaches your name to questions, resources, and topic suggestions you contribute. (To tighten this later, see *Locking it down* at the bottom.)

---

## One-time setup (about 30 minutes)

### 1. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → **New project**.
2. Pick a name (e.g. `casa-class`), set a database password, choose the region closest to your group.
3. After it provisions (~2 min), open **Project Settings → API**. Copy:
   - **Project URL** (looks like `https://xxxx.supabase.co`)
   - **anon / public key** — *not* the service-role key.

### 2. Run the database migration

In the Supabase dashboard, open **SQL Editor → New query**, paste the contents of `supabase/migrations/0001_init.sql`, and click **Run**. This creates the five tables, opens up RLS for the `anon` role, and turns on realtime.

### 3. Deploy the Claude summarizer (Edge Function)

You need the [Supabase CLI](https://supabase.com/docs/guides/cli) installed. Once you have it:

```bash
# From the project root
supabase login
supabase link --project-ref <your-project-ref>     # find ref in your project URL
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...  # your Anthropic key
supabase functions deploy summarize --no-verify-jwt
```

Note `--no-verify-jwt`: this is correct for "truly open" mode. The function is still callable only with the project's anon key, so it's not wide-open to the public internet.

To get an Anthropic API key: [console.anthropic.com](https://console.anthropic.com) → **API Keys → Create Key**. Add at least a small balance ($5 covers many months for a weekly group).

### 4. Push to GitHub

```bash
cd casa-class
git init
git add .
git commit -m "Casa Class — initial commit"
gh repo create casa-class --public --source=. --push   # or use github.com → New repo
```

### 5. Configure repo variables and enable Pages

In your repo on GitHub:

1. **Settings → Pages**: under *Build and deployment*, set **Source** to **GitHub Actions**.
2. **Settings → Secrets and variables → Actions → Variables → New repository variable** — add three:
   - `VITE_SUPABASE_URL` = your Supabase project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon key
   - `VITE_SUMMARIZE_FUNCTION_URL` = `https://<project>.supabase.co/functions/v1/summarize`

These are *variables*, not *secrets*, because the anon key is meant to be public. (The Anthropic key, which is sensitive, lives only in Supabase secrets and never in the browser.)

If your repo isn't named `casa-class`, edit `vite.config.js`'s `base` default — or set a `VITE_BASE` repo variable to `/your-repo-name/`. If you point a custom domain at the site, set `VITE_BASE` to `/`.

### 6. First deploy

The included GitHub Actions workflow (`.github/workflows/deploy.yml`) runs on every push to `main`. After your first push, watch the **Actions** tab — when the workflow turns green, your app is live at:

```
https://<your-username>.github.io/casa-class/
```

Share that URL with the group. They can tap **Add to Home Screen** on iOS/Android or **Install app** in Chrome to get a real app icon.

---

## Local development

```bash
cp .env.example .env.local           # then fill in your three values
npm install
npm run dev                          # http://localhost:5173
```

The dev server hits the same live Supabase database — handy, but be aware your edits during development are visible to everyone.

---

## How the app is meant to be used

- **Speakers page**: add your 7-8 regulars in the order you want them to lead, then click **Auto-schedule 8 weeks**. Guests can be added with the *Regular* checkbox unchecked — they're skipped by the auto-scheduler but you can still drop them on a specific Wednesday from the Calendar.
- **Calendar**: every Wednesday is clickable. Clicking opens (or creates) that week's program page.
- **Program page**: edit topic, paste transcript, click **Generate summary**, add resources and questions. Everything autosaves and syncs to everyone in real time.
- **Topics**: anyone can suggest a future topic and (optionally) tag a speaker. Vote with ▲/▼, mark as `scheduled` when it goes on the calendar.
- **History**: searchable archive of everything past.

---

## Locking it down later (optional)

The "truly open" choice is great until somebody shares the URL on social media. When that day comes, two minutes of work tightens things up:

- **Add a passcode gate.** Wrap `<App/>` in a check that asks for a shared passcode (stored in `localStorage` after the first entry). I left a comment in `src/main.jsx` you can build on.
- **Use Supabase auth.** Switch the policies in `supabase/migrations/0001_init.sql` from `to anon` to `to authenticated`, enable email-magic-link auth in Supabase, and add a tiny sign-in screen.

---

## Troubleshooting

- **Page is blank after deploy.** Check `vite.config.js`'s `base`. It must match `/<repo-name>/` for GitHub Pages, or `/` for a custom domain.
- **Realtime not syncing.** Make sure step 2 (the migration) ran cleanly — the last block adds tables to `supabase_realtime`.
- **"Summarizer failed (401)".** The function call needs the anon key in `apikey` and `Authorization` headers; the frontend already does this. Make sure `VITE_SUPABASE_ANON_KEY` is set in repo variables and you redeployed.
- **"Anthropic returned 401".** The Anthropic key isn't set. Run `supabase secrets set ANTHROPIC_API_KEY=...`.

---

## Cost expectations

- Supabase free tier: covers a 7-8 person group with room to spare.
- GitHub Pages: free.
- Anthropic: pay-per-use. A typical hour-long transcript summary on Sonnet 4.6 runs roughly **$0.05–0.20**. A weekly group should expect $1-3/month.
