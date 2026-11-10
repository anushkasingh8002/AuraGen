/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        aura: {
          50:  '#f0f4ff',
          100: '#e0eaff',
          200: '#c7d7fe',
          300: '#a5bcfc',
          400: '#8098f9',
          500: '#6172f3',
          600: '#444fe8',
          700: '#3838d4',
          800: '#3030ab',
          900: '#2e2f87',
        },
      },
    },
  },
  plugins: [],
}
