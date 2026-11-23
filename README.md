# Lingua Daily — Preview

Standalone learning preview for Spanish and English. Changes are developed on a separate branch and must be reviewed before the default branch or existing Netlify site is updated.

## Two practice modes

- **Пишу** — displays the Russian sentence immediately. Exact answers are green; one clear typographical mistake in an otherwise correct sentence is green with a warning; grammatical and conjugation mistakes are red and scheduled for review. Answers and review queues keep using the existing `lingua-daily-iphone-preview-v10` browser storage key.
- **Свободный диалог** — live voice tutoring through OpenAI Realtime and WebRTC, including microphone mute, stop/cleanup, Russian explanations on request, recent turn transcripts for the current page only, and adapting the tutor to written mastery/errors. No separate `Говорю` mode.

The written mode does not speak Russian prompts or auto-play the answer. Manual playback of foreign-language words remains available.

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

The browser POSTs to the same-origin `/api/realtime/token`, receives a short-lived client credential, then establishes WebRTC with OpenAI. The long-lived API key stays on the server. There is an explicit preview code and session rate limit. API usage may incur separate costs.

**Not yet verified:** end-to-end audio with a live API key, microphone approval and playback on iPhone Safari, and service deployment settings. Passing code checks does not verify those capabilities.

Do not deploy or merge this preview branch into an existing production site until reviewed.
