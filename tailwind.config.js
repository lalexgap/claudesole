/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}', './index.html'],
  theme: {
    extend: {
      colors: {
        // Dark surface scale for this app's UI
        app: {
          950: '#0a0a0a',
          900: '#111',
          850: '#141414',
          800: '#1a1a1a',
          750: '#1c1c1c',
          700: '#1e1e1e',
          650: '#222',
          600: '#252525',
          550: '#272727',
          500: '#2a2a2a',
          450: '#323232',
          400: '#333',
          350: '#3a3a3a',
        },
        // Gold accent (not in standard Tailwind palette)
        gold: '#f6c90e',
      },
    },
  },
}
