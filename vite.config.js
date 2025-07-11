import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command }) => {
  const isDev = command === "serve";

  return {
    base: isDev ? "/" : "/geo-fence-app/",
    server: {
      hmr: isDev,
    },
    plugins: [react(), tailwindcss()],
  };
});
