// Codex CLI identity headers for ChatGPT backend requests. OpenAI gates some
// models (and returns 404 otherwise) on the originator matching the User-Agent
// version, so the two must always move together. Keep them here as the single
// source of truth rather than re-declaring the version string per call site.
export const CODEX_ORIGINATOR = 'codex_cli_rs'
export const CODEX_CLIENT_VERSION = '0.146.0'
export const CODEX_USER_AGENT = `${CODEX_ORIGINATOR}/${CODEX_CLIENT_VERSION} (Ubuntu 22.4.0; x86_64) xterm-256color`
