/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Bright-morning palette: sunrise warmth + clear-sky blue
        sunrise: {
          50:  '#FFFBF0',
          100: '#FFF4D6',
          200: '#FFE6A6',
          300: '#FFD166',
          400: '#FBBF24',
          500: '#F59E0B',
          600: '#D97706',
          700: '#B45309'
        },
        sky: {
          50: '#F0FAFF',
          100: '#E0F4FE',
          200: '#BAE6FD',
          300: '#7DD3FC',
          400: '#38BDF8',
          500: '#0EA5E9'
        },
        coral: {
          400: '#FB923C',
          500: '#F97316'
        },
        ink: '#1F2937'
      },
      fontFamily: {
        sans: ['"Inter"', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Fraunces"', 'Georgia', 'serif']
      },
      backgroundImage: {
        'morning-sky': 'linear-gradient(135deg, #FFF4D6 0%, #FFE6A6 35%, #BAE6FD 100%)',
        'soft-dawn': 'linear-gradient(180deg, #FFFBF0 0%, #FFF4D6 100%)'
      },
      boxShadow: {
        warm: '0 1px 2px rgba(180, 83, 9, 0.06), 0 8px 24px rgba(180, 83, 9, 0.08)'
      }
    }
  },
  plugins: []
}
