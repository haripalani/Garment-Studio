// Export choices shared by the dialog and the builders (kept tiny: the builders load on demand).
export type Dpi = 150 | 300;
export const VIDEO_SIZES = ['1080x1080', '1080x1920', '1920x1080'] as const;
export type VideoSize = (typeof VIDEO_SIZES)[number];
export const FPS = 30;
