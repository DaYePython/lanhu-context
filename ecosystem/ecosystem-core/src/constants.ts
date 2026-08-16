// The CLI receiver (`lanhu auth listen --port`, packages/cli/src/commands/
// auth.ts) must default to the same port; both the browser extension and the
// lanhu-monkey userscript bundle this constant.
export const DEFAULT_BRIDGE_PORT = 7623;
export const BRIDGE_PATH = '/token';
export const LANHU_ORIGIN = 'https://lanhuapp.com';
export const DESIGN_DETAIL_PATH = 'item/project/detailDetach';
