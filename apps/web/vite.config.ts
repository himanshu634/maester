import { defineConfig } from 'vitest/config';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';

// The browser only ever talks to this origin; auth, API and dev routes go to the API.
// Same paths as nginx.conf.template, so the session cookie is first-party everywhere.
const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:8787';
const apiProxy = Object.fromEntries(
	['/api/auth/', '/v1/', '/dev/'].map((path) => [path, { target: API_PROXY_TARGET }])
);

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			// Fully static output: every route must prerender (see src/routes/+layout.ts).
			adapter: adapter({
				pages: 'build',
				assets: 'build',
				fallback: undefined,
				precompress: false,
				strict: true
			}),
			prerender: {
				// TEMPORARY: /login and /signup link to /forgot-password, which Task 11 adds. Remove
				// this hook once it exists; any other broken link still fails the build.
				handleHttpError: ({ path, referrer, message }) => {
					if (['/login', '/signup'].includes(referrer ?? '') && path === '/forgot-password') return;
					throw new Error(message);
				}
			},
			paths: {
				// Served at the domain root. Set BASE_PATH="/some-prefix" only for sub-path hosts.
				base: (process.env.BASE_PATH as '' | `/${string}` | undefined) ?? ''
			}
		})
	],
	server: { proxy: apiProxy },
	preview: { proxy: apiProxy },
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});
