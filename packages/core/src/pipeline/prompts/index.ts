import * as enUS from './en-US';
import * as zhCN from './zh-CN';

export type PromptLang = 'en-US' | 'zh-CN';

// Widened shape shared by both language packs.
export interface PromptPack {
  TOOL_DESCRIPTION: string;
  URL_INPUT_DESCRIPTION: string;
  ERROR_STOP_INSTRUCTION: string;
  HTML_CODE_LABEL: string;
  HTML_CODE_LABEL_TAILWIND: string;
  DESIGN_TOKENS_HEADER: string;
  imageMappingText: (count: number, curlLines: string) => string;
  guideText: (projectName: string | undefined, designName: string) => string;
  ERROR_HTML_GENERATION: (msg: string) => string;
  ERROR_IMAGE_DOWNLOAD: (msg: string) => string;
  ERROR_DESIGN_TOKENS: (msg: string) => string;
}

const PACKS: Record<PromptLang, PromptPack> = {
  'en-US': enUS,
  'zh-CN': zhCN
};

export function getPrompts(lang: PromptLang = 'en-US'): PromptPack {
  return PACKS[lang] ?? PACKS['en-US'];
}

export { enUS, zhCN };
