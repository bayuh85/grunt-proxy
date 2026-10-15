# grunt-proxy

[![MIT license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![CI](https://img.shields.io/badge/CI-GitHub_Actions-2088FF?logo=githubactions&logoColor=white)](.github/workflows/ci.yml)
[![OpenAI + Anthropic](https://img.shields.io/badge/API-OpenAI%20%2B%20Anthropic-412991)](https://atmorouter.dev/integration)

grunt-proxy is a small local HTTP proxy for coding agents. It shortens the prompt you were about to send, asks the model for a terse reply, and prints how many tokens and how many dollars that saved.

Replies stay in normal English. Code, JSON, and tool calls stay intact. The proxy does not role-play and does not rewrite the model's response.

## Powered by AtmoRouter

Powered by [AtmoRouter](https://atmorouter.dev) — cheap API access to frontier models.

[AtmoRouter](https://atmorouter.dev) is the default upstream. One key talks to both the OpenAI Chat Completions API (`https://atmorouter.dev/v1`) and the Anthropic Messages API (`https://atmorouter.dev/v1/messages`). Point grunt-proxy at it and keep using Cursor, Cline, Claude Code, or any other compatible client.

The proxy is provider-agnostic. Set `GRUNT_UPSTREAM_BASE_URL` and `GRUNT_API_KEY` to use OpenAI, Anthropic, or another compatible gateway instead.

## Quickstart

Requires Node.js 20 or newer.

```bash
cp .env.example .env
```

Put your AtmoRouter key in `GRUNT_API_KEY` (keys look like `ar-...`). Then:

```bash
npm install
npm run dev
```

grunt-proxy listens on `http://127.0.0.1:8642`. A chat completion through the proxy:

```bash
curl http://127.0.0.1:8642/v1/chat/completions \
  -H "content-type: application/json" \
  -H "authorization: Bearer $GRUNT_API_KEY" \
  -d '{
    "model": "atmo/deepseek-v4.1-flash",
    "messages": [
      {"role": "user", "content": "Could you please explain the configuration options in the documentation? Thank you!"}
    ]
  }'
```

Model ids change. Confirm the current catalog in the AtmoRouter dashboard before you rely on an example id.

Each request prints a line on stderr:

```text
grunt  atmo/deepseek-v4.1-flash  in 1,204→640 (−46.8%)  out 180  saved $0.001692
```

The full report is `GET /savings.txt`, or Ctrl+C when the server is in the foreground:

```text
grunt-proxy savings
requests              12
failed                0
input tokens          48,200 → 21,040  (−56.3%)
input tokens saved    27,160
output tokens         6,410
est. input $ saved    $0.081480
projected output $    $0.000000
est. $ saved          $0.081480
upstream billed       –
```

Numbers above are an illustration of the layout, not a benchmark.

`npm run build && npm start` runs the compiled server.

## Use with Cursor

1. Start grunt-proxy (`npm run dev`).
2. Open Cursor Settings → Models.
3. Set the OpenAI API key to your AtmoRouter key. If `GRUNT_API_KEY` is already set, any non-empty placeholder works because the proxy replaces the client key.
4. Override the OpenAI base URL with `http://127.0.0.1:8642/v1`.
5. Add a custom model whose id matches a model on AtmoRouter, for example `atmo/deepseek-v4.1-flash`.

Cursor keeps speaking the OpenAI protocol. grunt-proxy compresses the request and forwards it to `https://atmorouter.dev/v1/chat/completions`.

## Use with Cline

1. Start grunt-proxy.
2. In Cline, set the API provider to **OpenAI Compatible**.
3. Base URL: `http://127.0.0.1:8642/v1`
4. API key: your AtmoRouter key (or a placeholder when `GRUNT_API_KEY` is set).
5. Model ID: a catalog id from AtmoRouter.

## Use with Claude Code

Claude Code and the Anthropic SDK append `/v1/messages` themselves, so the base URL is the proxy origin **without** `/v1`.

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8642"
export ANTHROPIC_API_KEY="ar-your-key"
claude
```

grunt-proxy receives `POST /v1/messages` and forwards it to `https://atmorouter.dev/v1/messages`, including the Anthropic SSE event stream. It sets `anthropic-version: 2023-06-01` when the client did not send one.

| Client | Base URL the client uses | Where grunt-proxy sends it |
| --- | --- | --- |
| Cursor, Cline, OpenAI SDKs | `http://127.0.0.1:8642/v1` | `{GRUNT_UPSTREAM_BASE_URL}/chat/completions` |
| Claude Code, Anthropic SDK | `http://127.0.0.1:8642` | `https://atmorouter.dev/v1/messages` with the default upstream |

## Configuration

Copy `.env.example` to `.env`. Real environment variables win over the file. Flags win over both.

| Variable | Default | Meaning |
| --- | --- | --- |
| `GRUNT_UPSTREAM_BASE_URL` | `https://atmorouter.dev/v1` | OpenAI-compatible origin. A base that already ends in `/v1` is not doubled. |
| `GRUNT_API_KEY` | empty | Upstream key. When set, the client key is ignored. `ATMOROUTER_API_KEY` is a fallback. |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | empty | Used only when no override is set **and** the client sent no key. |
| `GRUNT_HOST` | `127.0.0.1` | Bind address. Localhost so the proxy is not a public credit sink. |
| `GRUNT_PORT` | `8642` | Listen port. |
| `GRUNT_LEVEL` | `2` | `0` off, `1` filler, `2` articles and short forms, `3` heavier and lossier. |
| `GRUNT_TERSE` | `auto` | `auto`, `always`, or `off`. |
| `GRUNT_PRICE_IN` / `GRUNT_PRICE_OUT` | table | USD per 1M tokens. Set these to your AtmoRouter rate. |
| `GRUNT_ASSUME_OUTPUT_CUT` | `0` | Optional projected output reduction, from `0` up to but not including `0.9`. |
| `GRUNT_LOG_FILE` | empty | Append a JSONL savings ledger. Prompts are not written. |
| `GRUNT_TIMEOUT_MS` | `0` | Upstream timeout. `0` waits without a proxy-side limit. |
| `GRUNT_MAX_BODY_BYTES` | `33554432` | Reject larger request bodies with HTTP 413. |

Flags: `--host`, `--port`, `--level`, `--terse`, `--upstream`, `--report [file]`, `--help`.

Per request, clients can send:

| Header | Effect |
| --- | --- |
| `x-grunt: off` | Forward the body unchanged. |
| `x-grunt-level: 0–3` | Override `GRUNT_LEVEL` for this call. |
| `x-grunt-terse: auto\|always\|off` | Override `GRUNT_TERSE` for this call. |

Response headers `x-grunt-original-tokens`, `x-grunt-compressed-tokens`, and `x-grunt-saved-tokens` report the local estimate. `x-grunt-saved-tokens` can be negative when the terse instruction costs more than the compression saved.

## How compression works

grunt-proxy only edits text the model will read: system and user text, assistant text, tool descriptions, and tool-result text. It leaves these alone:

- fenced code, inline code, and 4-space or tab-indented lines
- URLs, file paths, and filenames
- JSON values, including tool-call arguments and tool parameter schemas
- camelCase and PascalCase identifiers
- image blocks and Anthropic `tool_use` / `thinking` blocks

| Level | What changes |
| --- | --- |
| 0 | Nothing. |
| 1 | Courtesy and padded phrases ("could you please", "in order to", "thank you"). |
| 2 | Level 1, plus `a`/`an`/`the` and a few other fillers, plus short forms such as `config`, `fn`, `param`, `impl`. |
| 3 | Level 2, plus `of`/`that`, a few contractions, and shorter forms such as `cfg`, `btwn`, `w/o`. |

Level 2 is the default. Drop to level 1 if a client starts misreading instructions. Level 3 is for people who have checked the output and want the extra cut.

`GRUNT_TERSE=auto` adds a stable one-paragraph instruction when compression already pays for that paragraph, or when the prompt is at least about 800 estimated tokens. The instruction tells the model to answer in normal English, skip the greeting and the recap, and keep code and tool calls valid. It is the same bytes for a given level, so a provider prompt cache can reuse the prefix. `always` inserts it on every compressible call. `off` never does.

The proxy also sets OpenAI `stream_options.include_usage` on streamed chat calls unless you already set it to `false`, so the savings line can show output tokens.

## Savings math

The token delta is a local before/after estimate, not a clone of any provider tokenizer. It is consistent, which is what a savings figure needs. When the upstream returns usage, the report also stores those actual prompt and completion counts.

Dollars are `tokens saved × price / 1,000,000`.

- Known model families use an approximate **public list price** (for example gpt-4o-mini, Claude Sonnet, DeepSeek).
- Unknown ids use `$1` / `$3` per million and are labeled `default` in the ledger.
- `GRUNT_PRICE_IN` and `GRUNT_PRICE_OUT` override the table. Set them to the rate AtmoRouter actually charges or the estimate will not match your invoice. AtmoRouter is often cheaper than list price, so the built-in table can overstate savings.
- Failed upstream calls (any non-2xx) count as failures and add `$0`.
- Output terseness is requested, not measured. `projected output $` stays `$0` unless you set `GRUNT_ASSUME_OUTPUT_CUT`. That knob is a labeled guess: it assumes the reply would have been longer by that fraction, and nothing in the report pretends it was observed.
- If AtmoRouter sends `X-Atmorouter-Cost`, the line and the report show that amount as **upstream billed**. That number is what you paid for the compressed call, not the savings.

`grunt-proxy --report .grunt-savings.jsonl` reprints a report from `GRUNT_LOG_FILE` without starting the server.

## Local HTTP API

| Method and path | Response |
| --- | --- |
| `GET /` | Short plain-text description. |
| `GET /health` | `{"ok":true,"service":"grunt-proxy"}` |
| `GET /savings` | JSON totals for this process. |
| `GET /savings.txt` | The same report the server prints on Ctrl+C. |
| `POST /v1/chat/completions` and `POST /chat/completions` | Compressed, then proxied. |
| `POST /v1/messages` and `POST /v1/messages/count_tokens` | Compressed, then proxied. |
| Anything else (`GET /v1/models`, …) | Proxied as-is. |

The server does not apply Node's default request timeout, so a long Claude Code or Cursor stream is not cut off by the proxy. The provider can still enforce its own limit. Disconnecting the client aborts the upstream request.

## Development

```bash
npm install
npm test
npm run typecheck
npm run build
```

CI runs typecheck, tests, and the build on Node 20 and 22.

## License

[MIT](LICENSE). Copyright (c) 2026 grunt-proxy contributors.

## Acknowledgements

Inspired by caveman (https://github.com/JuliusBrussee/caveman).
