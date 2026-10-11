import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // listen on every IP of this PC (both VLAN NICs), not just localhost — so other PCs/the TV can open it
    open: true,
    proxy: { "/api": "http://127.0.0.1:3001" },
  },
});
