/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        studio: {
          bg: '#18181b',
          surface: '#27272a',
          border: '#3f3f46',
          hover: '#3f3f46',
          accent: '#3b82f6',
          success: '#10b981',
          warning: '#f59e0b',
          danger: '#ef4444',
          text: '#f4f4f5',
          muted: '#a1a1aa',
          faint: '#71717a'
        }
      }
    },
  },
  plugins: [],
}
