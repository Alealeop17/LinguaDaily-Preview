# Lingua Daily preview — release verification checklist

## Automated tests and safeguards

- [x] Exactly two mode tabs: **Пишу** and **Свободный диалог**
- [x] Russian translation prompt appears instantly, without Russian TTS
- [x] Single unmistakable typo receives a green bar and a correction
- [x] Conjugation mistake is red with a specific explanation and review queue entry
- [x] Full 100-green written exercise cycle terminates
- [x] Language and lesson progress persist independently when reopening the same origin
- [x] Browser JS parses, and inline curriculum matches the server JSON
- [x] WebRTC handshake and ephemeral-token flow simulated, without a paid live call
- [x] Mute, stopping, retry after blocked Safari autoplay, canceled token request, failed access code, app backgrounding, and ten-minute preview cap simulated
- [x] Origin/passcode restrictions, unsafe tutor preferences, oversized bodies, CSP and token rate limits checked with mocked Node interfaces
- [x] Access code is not written to localStorage, and long-lived OpenAI key is not embedded in HTML
- [x] Production default branch and existing Netlify origin remain untouched

## Still required before any deployment

- [ ] Run the repository's actual `npm test` with Node.js >=20
- [ ] Verify live endpoint `POST /api/realtime/client_secrets` against a configured OpenAI project
- [ ] Confirm Realtime model entitlement and billing limits before a paid call
- [ ] Test microphone permission in the native Safari browser on iPhone
- [ ] Test initial remote-audio playback and the **Включить звук преподавателя** fallback
- [ ] Test polite interruptions and pauses with a real speech-to-speech call in both languages
- [ ] Test error handling when network access drops mid-session and Safari goes to background
- [ ] Confirm mobile UI spacing, keyboard overlap and hardware mute controls
- [ ] Confirm language settings, style, voice, and speed persist on iPhone after refresh
- [ ] Make a progress-backup/migration plan before changing the origin of the user's deployed site
- [x] Test opt-in voice-to-writing card creation, deletion, reactivation and separate review using mock Realtime tool events
- [ ] Test the full voice-to-writing function call path with a live OpenAI session, including model quality and transcription accuracy
- [ ] Obtain explicit review approval before merging or publishing

## Practical release gate

Do not move the draft PR into production solely because simulated tests pass.
Do not add an OpenAI API key or preview passcode to GitHub commits, static frontend assets, screenshots, or browser storage.
