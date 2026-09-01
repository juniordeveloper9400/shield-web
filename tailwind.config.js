/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Anchored on the SHIELD logo mark: body blue #2C57A6 (600),
        // deep blue #224787 (700), navy #16305C (900) — see
        // lib/theme/app_colors.dart in the Flutter app.
        brand: {
          50: '#eff4fc',
          100: '#d9e4f5',
          200: '#b7c9e6',
          300: '#8aa6d2',
          400: '#5b7fba',
          500: '#3b62a1',
          600: '#2c57a6',
          700: '#224787',
          800: '#1b3a6e',
          900: '#16305c',
          950: '#0e1f3d',
        },
        // The logo's check mark: green #93C73F (400), deep #6B9A2E (600),
        // dark #5A8127 (700).
        accent: {
          50: '#f0f7e4',
          100: '#dfecc6',
          200: '#c6dd9c',
          300: '#a9c96a',
          400: '#93c73f',
          500: '#7db233',
          600: '#6b9a2e',
          700: '#5a8127',
          800: '#486620',
          900: '#3a5219',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
