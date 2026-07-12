// Codex CLI identity headers for ChatGPT backend requests. OpenAI gates some
// models (and returns 404 otherwise) on the originator matching the User-Agent
// version, so the two must always move together. Keep them here as the single
// source of truth rather than re-declaring the version string per call site.
export const CODEX_USER_AGENT = 'codex_cli_rs/0.20.0'
export const CODEX_ORIGINATOR = 'codex_cli_rs'
