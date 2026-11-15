// Vite's `?raw` import, for the SFZ fixtures; the package is typed without vite/client.
declare module '*?raw' {
  const text: string;
  export default text;
}
