/// <reference types="vite/client" />

// `?url` imports of ffmpeg core assets resolve through Vite's asset pipeline.
declare module '*?url' {
  const url: string;
  export default url;
}
