import { installLanhuContextMenu } from '@lanhu-context/ecosystem-core';
import { gmPlatform } from './gm-platform';

// All user-facing behaviour (menu items, wording, toasts) lives in
// ecosystem-core; this entry only supplies the GM_* adapters.
installLanhuContextMenu(document.body, gmPlatform);
