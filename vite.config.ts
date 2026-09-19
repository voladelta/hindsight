import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "src/client",
  plugins: [
    {
      name: "private-module-boundary",
      enforce: "pre",
      resolveId(source, importer) {
        if (
          importer?.includes("/src/client/") &&
          /server|fixtures/.test(source)
        ) {
          throw new Error("Client imports may not access private modules");
        }
      },
    },
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { "@": resolve("src/client") } },
  build: { outDir: "../../dist", emptyOutDir: true, sourcemap: false },
  server: { fs: { allow: [resolve("src/client"), resolve("node_modules")] } },
});
