// Error model for lanhu-context (DESIGN.md §6).
//
// Three severity levels:
// - fatal: core artifact cannot be produced — abort with a non-zero exit class
// - degraded: core artifact is fine, an auxiliary stage failed — collect as warning
// - notice: improvement hints only
//
// Exit classes (DESIGN.md §6.2): 1 unknown, 2 usage/URL, 3 config/credentials,
// 4 auth/permission/empty result, 5 upstream API/network, 6 transform, 7 local IO,
// 8 reserved for --strict escalation (assigned by the CLI layer),
// 9 batch partial failure (--keep-going).

export type LanhuSeverity = 'fatal' | 'degraded' | 'notice';

export interface LanhuErrorSpec {
  severity: LanhuSeverity;
  exitClass: number;
  retryable: boolean;
  hint: string;
}

export const ERROR_REGISTRY = {
  // --- usage / URL (exit class 2) ---
  URL_INVALID: {
    severity: 'fatal',
    exitClass: 2,
    retryable: false,
    hint: 'Provide a full Lanhu design detail URL (https://lanhuapp.com/web/#/item/project/detailDetach?tid=...&pid=...&image_id=...) or a query string with tid/pid/image_id.'
  },
  URL_MISSING_TID: {
    severity: 'fatal',
    exitClass: 2,
    retryable: false,
    hint: 'The URL must contain a tid (team id) parameter. Copy the full design detail URL from the browser address bar.'
  },
  URL_MISSING_PID: {
    severity: 'fatal',
    exitClass: 2,
    retryable: false,
    hint: 'The URL must contain a pid (or project_id) parameter. Copy the full design detail URL from the browser address bar.'
  },
  URL_MISSING_IMAGE_ID: {
    severity: 'fatal',
    exitClass: 2,
    retryable: false,
    hint: 'The URL must contain an image_id (or docId) parameter. Open a specific design in Lanhu before copying the URL.'
  },
  USAGE_ERROR: {
    severity: 'fatal',
    exitClass: 2,
    retryable: false,
    hint: 'The command was invoked with invalid arguments or conflicting flags. Run the command with --help to see valid usage and examples.'
  },
  // --- config / credentials (exit class 3) ---
  CONFIG_INVALID: {
    severity: 'fatal',
    exitClass: 3,
    retryable: false,
    hint: 'The configuration is invalid (e.g. the --cwd directory or the explicitly requested env file does not exist). Fix the path and retry.'
  },
  TOKEN_MISSING: {
    severity: 'fatal',
    exitClass: 3,
    retryable: false,
    hint: 'LANHU_TOKEN is not configured. It is the full browser Cookie of a logged-in lanhuapp.com session. Set it via env, .env.local, or a flag.'
  },
  // --- auth / permission / empty result (exit class 4) ---
  AUTH_EXPIRED: {
    severity: 'fatal',
    exitClass: 4,
    retryable: false,
    hint: 'The token is a browser Cookie and expires. Log in to lanhuapp.com again, copy the fresh Cookie, and update LANHU_TOKEN.'
  },
  ACCESS_DENIED: {
    severity: 'fatal',
    exitClass: 4,
    retryable: false,
    hint: 'The current account has no access to this team/project/design. Verify the account or ask for access.'
  },
  EMPTY_RESULT: {
    severity: 'fatal',
    exitClass: 4,
    retryable: false,
    hint: 'Lanhu returned HTTP 200 with an empty payload — this can mean an incomplete URL, missing access, or an expired token. Check the token first, then verify tid/pid/image_id are complete and untruncated.'
  },
  DESIGN_NOT_FOUND: {
    severity: 'fatal',
    exitClass: 4,
    retryable: false,
    hint: 'The design (image_id) was not found in this project. Verify the URL points to an existing design and the account can see it.'
  },
  // --- upstream API / network (exit class 5) ---
  UPSTREAM_TIMEOUT: {
    severity: 'fatal',
    exitClass: 5,
    retryable: true,
    hint: 'The Lanhu API did not respond in time. Retry, or raise the timeout.'
  },
  UPSTREAM_ERROR: {
    severity: 'fatal',
    exitClass: 5,
    retryable: true,
    hint: 'The Lanhu API request failed (network error or 5xx). Retry later; if it persists, check network access to lanhuapp.com.'
  },
  SCHEMA_FIELD_MISSING: {
    severity: 'fatal',
    exitClass: 5,
    retryable: false,
    hint: 'The upstream payload is missing an expected field (latest_version / data_resource_url / json_url). The design may not be fully processed by Lanhu yet — re-upload or re-process it in Lanhu.'
  },
  // --- transform (exit class 6) ---
  TRANSFORM_FAILED: {
    severity: 'fatal',
    exitClass: 6,
    retryable: false,
    hint: 'Converting the DDS schema to HTML failed. Re-run with the raw schema saved to inspect it, and report the design URL if it persists.'
  },
  // --- local IO (exit class 7) ---
  IO_WRITE_FAILED: {
    severity: 'fatal',
    exitClass: 7,
    retryable: false,
    hint: 'Writing output files failed. Check that the output directory exists, is writable, and has free disk space.'
  },
  // --- degraded warnings (exit class 0: the run still succeeds) ---
  TOKENS_UNAVAILABLE: {
    severity: 'degraded',
    exitClass: 0,
    retryable: false,
    hint: 'Design tokens could not be extracted (missing/unreadable Sketch JSON). The HTML output is unaffected; verify the design version finished processing in Lanhu if tokens are needed.'
  },
  PREVIEW_UNAVAILABLE: {
    severity: 'degraded',
    exitClass: 0,
    retryable: true,
    hint: 'The preview image could not be downloaded. The HTML output is unaffected; retry if the preview is needed.'
  },
  TAILWIND_FALLBACK: {
    severity: 'degraded',
    exitClass: 0,
    retryable: false,
    hint: 'Tailwind conversion failed; the original HTML+CSS was kept. Use it as-is or retry with a different --tw-version.'
  },
  ASSET_DOWNLOAD_FAILED: {
    severity: 'degraded',
    exitClass: 0,
    retryable: true,
    hint: 'One or more slice assets failed to download; the rest were delivered. Re-run `lanhu assets --download` (idempotent: finished files are skipped), or use --strict to fail fast.'
  },
  // --- batch partial failure (exit class 9) ---
  BATCH_PARTIAL: {
    severity: 'fatal',
    exitClass: 9,
    retryable: false,
    hint: 'Some batch entries failed while --keep-going was active. Parse the NDJSON output and inspect the lines with ok:false; the stderr summary has {total, ok, failed}.'
  },
  // --- unknown / internal (exit class 1) ---
  UNKNOWN: {
    severity: 'fatal',
    exitClass: 1,
    retryable: false,
    hint: 'Unclassified internal error — likely a bug. Please report it with the command and design URL.'
  }
} as const satisfies Record<string, LanhuErrorSpec>;

export type LanhuErrorCode = keyof typeof ERROR_REGISTRY;

export interface LanhuErrorOptions {
  hint?: string;
  cause?: unknown;
}

export class LanhuError extends Error {
  readonly code: LanhuErrorCode;
  readonly severity: LanhuSeverity;
  readonly exitClass: number;
  readonly retryable: boolean;
  readonly hint: string;

  constructor(
    code: LanhuErrorCode,
    message: string,
    options: LanhuErrorOptions = {}
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : {});
    const spec: LanhuErrorSpec = ERROR_REGISTRY[code];
    this.name = 'LanhuError';
    this.code = code;
    this.severity = spec.severity;
    this.exitClass = spec.exitClass;
    this.retryable = spec.retryable;
    this.hint = options.hint ?? spec.hint;
  }
}

export function isLanhuError(error: unknown): error is LanhuError {
  return error instanceof LanhuError;
}

// Normalize any thrown value into a LanhuError without losing the original.
export function toLanhuError(
  error: unknown,
  fallbackCode: LanhuErrorCode = 'UNKNOWN'
): LanhuError {
  if (error instanceof LanhuError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new LanhuError(fallbackCode, message, { cause: error });
}

// A degraded/notice-level issue collected during a pipeline run instead of thrown.
export interface LanhuWarning {
  code: LanhuErrorCode;
  severity: LanhuSeverity;
  message: string;
  hint: string;
}

export function makeWarning(
  code: LanhuErrorCode,
  message: string,
  hint?: string
): LanhuWarning {
  const spec: LanhuErrorSpec = ERROR_REGISTRY[code];
  return {
    code,
    severity: spec.severity,
    message,
    hint: hint ?? spec.hint
  };
}
