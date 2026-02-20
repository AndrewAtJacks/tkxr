import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// Read tkxr server config to know which port to proxy to
function getTkxrServerConfig() {
	try {
		const configPath = resolve('../../.tkxr-server');
		if (existsSync(configPath)) {
			const config = JSON.parse(readFileSync(configPath, 'utf8'));
			return {
				host: config.host || 'localhost',
				port: config.port || 8080,
				url: config.url || `http://localhost:${config.port || 8080}`
			};
		}
	} catch (error) {
		console.warn('Could not read .tkxr-server config:', error);
	}
	
	// Fallback to defaults
	return {
		host: 'localhost',
		port: 8080,
		url: 'http://localhost:8080'
	};
}

const tkxrConfig = getTkxrServerConfig();
console.log('🔗 Proxying to tkxr server:', tkxrConfig.url);

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 3001,
		proxy: {
			// Proxy all API requests to the tkxr server
			'/api': {
				target: tkxrConfig.url,
				changeOrigin: true,
				secure: false
			},
			// Proxy WebSocket connections
			'/ws': {
				target: tkxrConfig.url.replace('http', 'ws'),
				ws: true,
				changeOrigin: true
			}
		}
	}
});