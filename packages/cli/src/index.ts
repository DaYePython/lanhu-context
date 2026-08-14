// @lanhu-context/cli — programmatic surface (mainly for tests). The bin entry
// is src/main.ts.
export {
  globalArgs,
  toConfigFlags,
  toTransformOptions,
  transformArgs
} from './args';
export {
  DEFAULT_RETRIES,
  type ResolvedConfig,
  requireToken,
  resolveConfig
} from './config/index';
export { exitCodeForError, finishWith } from './exit';
export {
  failureEnvelope,
  serializeEnvelope,
  strictFailureEnvelope,
  successEnvelope
} from './io/envelope';
export { type CommandKind, shouldEmitJson } from './io/output';
export { executeCommand } from './runner';
export { CLI_PKG_NAME, CLI_VERSION } from './version';
