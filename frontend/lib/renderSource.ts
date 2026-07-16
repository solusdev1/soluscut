let sourceVideo: File | null = null;
export const setRenderSource = (file: File) => { sourceVideo = file; };
export const getRenderSource = () => sourceVideo;
