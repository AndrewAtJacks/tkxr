// vite.config.ts
import { sveltekit } from "file:///C:/Users/andrew.hein/UserRoot/Code/tkxr/src/web/node_modules/@sveltejs/kit/src/exports/vite/index.js";
import { defineConfig } from "file:///C:/Users/andrew.hein/UserRoot/Code/tkxr/src/web/node_modules/vite/dist/node/index.js";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
function getTkxrServerConfig() {
  try {
    const configPath = resolve("../../.tkxr-server");
    if (existsSync(configPath)) {
      const config = JSON.parse(readFileSync(configPath, "utf8"));
      return {
        host: config.host || "localhost",
        port: config.port || 8080,
        url: config.url || `http://localhost:${config.port || 8080}`
      };
    }
  } catch (error) {
    console.warn("Could not read .tkxr-server config:", error);
  }
  return {
    host: "localhost",
    port: 8080,
    url: "http://localhost:8080"
  };
}
var tkxrConfig = getTkxrServerConfig();
console.log("\u{1F517} Proxying to tkxr server:", tkxrConfig.url);
var vite_config_default = defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 3001,
    proxy: {
      // Proxy all API requests to the tkxr server
      "/api": {
        target: tkxrConfig.url,
        changeOrigin: true,
        secure: false
      },
      // Proxy WebSocket connections
      "/ws": {
        target: tkxrConfig.url.replace("http", "ws"),
        ws: true,
        changeOrigin: true
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFxVc2Vyc1xcXFxhbmRyZXcuaGVpblxcXFxVc2VyUm9vdFxcXFxDb2RlXFxcXHRreHJcXFxcc3JjXFxcXHdlYlwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiQzpcXFxcVXNlcnNcXFxcYW5kcmV3LmhlaW5cXFxcVXNlclJvb3RcXFxcQ29kZVxcXFx0a3hyXFxcXHNyY1xcXFx3ZWJcXFxcdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0M6L1VzZXJzL2FuZHJldy5oZWluL1VzZXJSb290L0NvZGUvdGt4ci9zcmMvd2ViL3ZpdGUuY29uZmlnLnRzXCI7aW1wb3J0IHsgc3ZlbHRla2l0IH0gZnJvbSAnQHN2ZWx0ZWpzL2tpdC92aXRlJztcclxuaW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XHJcbmltcG9ydCB7IHJlYWRGaWxlU3luYywgZXhpc3RzU3luYyB9IGZyb20gJ2ZzJztcclxuaW1wb3J0IHsgcmVzb2x2ZSB9IGZyb20gJ3BhdGgnO1xyXG5cclxuLy8gUmVhZCB0a3hyIHNlcnZlciBjb25maWcgdG8ga25vdyB3aGljaCBwb3J0IHRvIHByb3h5IHRvXHJcbmZ1bmN0aW9uIGdldFRreHJTZXJ2ZXJDb25maWcoKSB7XHJcblx0dHJ5IHtcclxuXHRcdGNvbnN0IGNvbmZpZ1BhdGggPSByZXNvbHZlKCcuLi8uLi8udGt4ci1zZXJ2ZXInKTtcclxuXHRcdGlmIChleGlzdHNTeW5jKGNvbmZpZ1BhdGgpKSB7XHJcblx0XHRcdGNvbnN0IGNvbmZpZyA9IEpTT04ucGFyc2UocmVhZEZpbGVTeW5jKGNvbmZpZ1BhdGgsICd1dGY4JykpO1xyXG5cdFx0XHRyZXR1cm4ge1xyXG5cdFx0XHRcdGhvc3Q6IGNvbmZpZy5ob3N0IHx8ICdsb2NhbGhvc3QnLFxyXG5cdFx0XHRcdHBvcnQ6IGNvbmZpZy5wb3J0IHx8IDgwODAsXHJcblx0XHRcdFx0dXJsOiBjb25maWcudXJsIHx8IGBodHRwOi8vbG9jYWxob3N0OiR7Y29uZmlnLnBvcnQgfHwgODA4MH1gXHJcblx0XHRcdH07XHJcblx0XHR9XHJcblx0fSBjYXRjaCAoZXJyb3IpIHtcclxuXHRcdGNvbnNvbGUud2FybignQ291bGQgbm90IHJlYWQgLnRreHItc2VydmVyIGNvbmZpZzonLCBlcnJvcik7XHJcblx0fVxyXG5cdFxyXG5cdC8vIEZhbGxiYWNrIHRvIGRlZmF1bHRzXHJcblx0cmV0dXJuIHtcclxuXHRcdGhvc3Q6ICdsb2NhbGhvc3QnLFxyXG5cdFx0cG9ydDogODA4MCxcclxuXHRcdHVybDogJ2h0dHA6Ly9sb2NhbGhvc3Q6ODA4MCdcclxuXHR9O1xyXG59XHJcblxyXG5jb25zdCB0a3hyQ29uZmlnID0gZ2V0VGt4clNlcnZlckNvbmZpZygpO1xyXG5jb25zb2xlLmxvZygnXHVEODNEXHVERDE3IFByb3h5aW5nIHRvIHRreHIgc2VydmVyOicsIHRreHJDb25maWcudXJsKTtcclxuXHJcbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XHJcblx0cGx1Z2luczogW3N2ZWx0ZWtpdCgpXSxcclxuXHRzZXJ2ZXI6IHtcclxuXHRcdHBvcnQ6IDMwMDEsXHJcblx0XHRwcm94eToge1xyXG5cdFx0XHQvLyBQcm94eSBhbGwgQVBJIHJlcXVlc3RzIHRvIHRoZSB0a3hyIHNlcnZlclxyXG5cdFx0XHQnL2FwaSc6IHtcclxuXHRcdFx0XHR0YXJnZXQ6IHRreHJDb25maWcudXJsLFxyXG5cdFx0XHRcdGNoYW5nZU9yaWdpbjogdHJ1ZSxcclxuXHRcdFx0XHRzZWN1cmU6IGZhbHNlXHJcblx0XHRcdH0sXHJcblx0XHRcdC8vIFByb3h5IFdlYlNvY2tldCBjb25uZWN0aW9uc1xyXG5cdFx0XHQnL3dzJzoge1xyXG5cdFx0XHRcdHRhcmdldDogdGt4ckNvbmZpZy51cmwucmVwbGFjZSgnaHR0cCcsICd3cycpLFxyXG5cdFx0XHRcdHdzOiB0cnVlLFxyXG5cdFx0XHRcdGNoYW5nZU9yaWdpbjogdHJ1ZVxyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0fVxyXG59KTsiXSwKICAibWFwcGluZ3MiOiAiO0FBQStVLFNBQVMsaUJBQWlCO0FBQ3pXLFNBQVMsb0JBQW9CO0FBQzdCLFNBQVMsY0FBYyxrQkFBa0I7QUFDekMsU0FBUyxlQUFlO0FBR3hCLFNBQVMsc0JBQXNCO0FBQzlCLE1BQUk7QUFDSCxVQUFNLGFBQWEsUUFBUSxvQkFBb0I7QUFDL0MsUUFBSSxXQUFXLFVBQVUsR0FBRztBQUMzQixZQUFNLFNBQVMsS0FBSyxNQUFNLGFBQWEsWUFBWSxNQUFNLENBQUM7QUFDMUQsYUFBTztBQUFBLFFBQ04sTUFBTSxPQUFPLFFBQVE7QUFBQSxRQUNyQixNQUFNLE9BQU8sUUFBUTtBQUFBLFFBQ3JCLEtBQUssT0FBTyxPQUFPLG9CQUFvQixPQUFPLFFBQVEsSUFBSTtBQUFBLE1BQzNEO0FBQUEsSUFDRDtBQUFBLEVBQ0QsU0FBUyxPQUFPO0FBQ2YsWUFBUSxLQUFLLHVDQUF1QyxLQUFLO0FBQUEsRUFDMUQ7QUFHQSxTQUFPO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixNQUFNO0FBQUEsSUFDTixLQUFLO0FBQUEsRUFDTjtBQUNEO0FBRUEsSUFBTSxhQUFhLG9CQUFvQjtBQUN2QyxRQUFRLElBQUksc0NBQStCLFdBQVcsR0FBRztBQUV6RCxJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMzQixTQUFTLENBQUMsVUFBVSxDQUFDO0FBQUEsRUFDckIsUUFBUTtBQUFBLElBQ1AsTUFBTTtBQUFBLElBQ04sT0FBTztBQUFBO0FBQUEsTUFFTixRQUFRO0FBQUEsUUFDUCxRQUFRLFdBQVc7QUFBQSxRQUNuQixjQUFjO0FBQUEsUUFDZCxRQUFRO0FBQUEsTUFDVDtBQUFBO0FBQUEsTUFFQSxPQUFPO0FBQUEsUUFDTixRQUFRLFdBQVcsSUFBSSxRQUFRLFFBQVEsSUFBSTtBQUFBLFFBQzNDLElBQUk7QUFBQSxRQUNKLGNBQWM7QUFBQSxNQUNmO0FBQUEsSUFDRDtBQUFBLEVBQ0Q7QUFDRCxDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=
