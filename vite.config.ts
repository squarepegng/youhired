import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `vite build --mode demo` builds the public web app demo (sample data, no server) into site/.
export default defineConfig(({ mode }) => ({
  root: "web",
  base: "/",
  plugins: [react()],
  define: mode === "demo" ? { "import.meta.env.VITE_DEMO": JSON.stringify("1") } : {},
  build: { outDir: mode === "demo" ? "../site" : "../dist", emptyOutDir: true },
}));
