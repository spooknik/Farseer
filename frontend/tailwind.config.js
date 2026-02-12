/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"JetBrains Mono"', '"Cascadia Code"', '"Fira Code"', '"SF Mono"', 'Menlo', 'Monaco', '"Courier New"', 'monospace'],
      },
      colors: {
        term: {
          black: '#0a0e14',
          surface: '#11151c',
          'surface-alt': '#161b24',
          border: '#1e2530',
          'border-focus': '#2a3545',
          fg: '#b0bec5',
          'fg-bright': '#e0e6ed',
          'fg-dim': '#cacaca',
          'fg-muted': '#4d5a66',
          cyan: '#56d4c8',
          'cyan-dim': '#2a6b64',
          green: '#5af78e',
          'green-dim': '#1a3d28',
          yellow: '#f3f99d',
          'yellow-dim': '#3d3a1a',
          red: '#ff5c57',
          'red-dim': '#3d1a1a',
          magenta: '#ff6ac1',
          'magenta-dim': '#3d1a2e',
          blue: '#57c7ff',
          orange: '#f9a959',
        },
      },
    },
  },
  plugins: [],
}
