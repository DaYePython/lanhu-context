// Shared types for @lanhu-context/core.

export interface DesignMeta {
  id: string;
  name: string;
  url?: string;
  projectName?: string;
}

export interface LanhuDesignRequest {
  teamId: string;
  projectId: string;
  imageId: string;
}

export interface DownloadImageRequest {
  imgUrl: string;
}

// Parsed params from a Lanhu design URL.
export interface LanhuUrlParams {
  teamId: string;
  projectId: string;
  docId: string;
  versionId?: string;
}

// A node in the DDS schema tree.
export interface SchemaNode {
  type?: string;
  props?: {
    className?: string;
    style?: Record<string, unknown>;
    src?: string;
    text?: string;
    [key: string]: unknown;
  };
  data?: { value?: string };
  style?: Record<string, unknown>;
  children?: SchemaNode[];
  alignJustify?: { justifyContent?: string; alignItems?: string };
  loop?: unknown[];
  loopData?: unknown[];
  loopType?: boolean;
  uiType?: string;
  uiTypeProb?: { placeholder?: string };
  [key: string]: unknown;
}

// Common response wrapper used by Lanhu APIs.
export interface LanhuApiResponse<T = unknown> {
  code?: string | number;
  msg?: string;
  data?: T;
  result?: T;
}

// Sketch-JSON fragments used by design-token extraction.
export interface FillObj {
  isEnabled?: boolean;
  fillType?: number;
  color?: { value?: string; alpha?: number; a?: number };
  gradient?: {
    colorStops?: Array<{ color?: { value?: string }; position?: number }>;
    from?: { x?: number; y?: number };
    to?: { x?: number; y?: number };
  };
}

export interface BorderObj {
  isEnabled?: boolean;
  color?: { value?: string };
  thickness?: number;
  position?: string;
}

export interface ShadowObj {
  isEnabled?: boolean;
  color?: { value?: string };
  offsetX?: number;
  offsetY?: number;
  blurRadius?: number;
  spread?: number;
}
