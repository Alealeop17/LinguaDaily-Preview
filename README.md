# Lingua Daily — Preview

Standalone learning preview for Spanish and English. Changes are developed on a separate branch and must be reviewed before the default branch or existing Netlify site is updated.

## Two practice modes

- **Пишу** — displays the Russian sentence immediately. Exact answers are green; one clear typographical mistake in an otherwise correct sentence is green with a warning; grammatical and conjugation mistakes are red and scheduled for review. Answers and review queues keep using the existing `lingua-daily-iphone-preview-v10` browser storage key.
- **Свободный диалог** — live voice tutoring through OpenAI Realtime and WebRTC, including microphone mute, stop/cleanup, Russian explanations on request, recent turn transcripts for the current page only, and adapting the tutor to written mastery/errors. No separate `Говорю` mode. The preview has a ten-minute session cap, a user-gesture sound recovery action for Safari, and auto-stop when the app is backgrounded.

The written mode does not speak Russian prompts or auto-play the answer. Manual playback of foreign-language words remains available. The red feedback gives a precise conjugation hint when the answer contains a known wrong form (`ella quiero` → `ella quiere`, `she want` → `she wants`).

The voice tutor offers three styles (calm, energetic, demanding), two built-in OpenAI voices (Marin, Cedar), and slow/normal speed. These preferences are saved separately from lesson progress. The access code is kept in page memory only and is never persisted. Explicitly confirmed mistake cards are stored locally under a distinct key; they can be reviewed, removed, or reopened. Unconfirmed suggestions stay in memory and vanish when leaving the dialogue.

## Local verification

Requires Node.js 20 or newer.

```sh
npm test
npm start
```

Open `http://localhost:8787/` to inspect the writing interface. Live voice chat needs HTTPS and a configured OpenAI project, plus microphone permissions.

## Voice preview configuration

The server and client must run on the same HTTPS origin. Configure these **server-only** environment variables on Render or a similar host:

- `OPENAI_API_KEY` — server-only key; never put it in HTML or commit it.
- `PREVIEW_ACCESS_CODE` — separate preview access passphrase, entered in the UI and never stored in localStorage.
- `ALLOWED_ORIGIN` — public HTTPS origin of the preview, e.g. `https://lingua-daily-iphone-preview.onrender.com` (this URL is also the default).
- `OPENAI_REALTIME_MODEL` — optional model override (default `gpt-realtime-2.1`).

The browser POSTs to the same-origin `/api/realtime/token`, receives a short-lived client credential, then establishes WebRTC with OpenAI. The long-lived API key stays on the server. There is an explicit preview code, hourly server rate limit, and ten-minute client-side preview cap. API usage may incur separate costs. The page applies browser CSP, frame restrictions, and same-origin microphone policy.

**Verification:** 34 frontend/browser test cases have been exercised in an isolated JavaScript harness and passed. Another 13 server security/response scenarios passed with mocked Node interfaces. The repository contains 46 Node test definitions. **The complete `npm test` suite has not yet run directly under Node.js.**

**Not yet verified:** live audio with an actual OpenAI API key, real microphone permission and playback on iPhone Safari, and service deployment settings. Voice-generated mistake suggestions can be returned by a Realtime function tool, reviewed and explicitly confirmed by the learner, and then studied in a separate written review without touching the existing 100-slot lesson progress. The end-to-end *live model* function-call path remains unverified; mock event tests have passed. Passing mock tests does not verify live audio or billing.

Do not deploy or merge this preview branch into an existing production site until reviewed.

Browser progress is tied to its website origin; the preview does not migrate Netlify localStorage to Render or back. Do not replace the production origin without an explicit progress-migration plan.
