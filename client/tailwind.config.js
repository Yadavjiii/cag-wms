/** @type {import('tailwindcss').Config} */
// Remap "indigo" (used throughout the pages) to the Samadhaan navy scale, and
// add gold/laurel accents, so the whole app takes the institutional palette
// without editing each page.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        indigo: {
          50: "#F4F6FA",
          100: "#E7ECF3",
          200: "#C7D2E1",
          300: "#95A9C6",
          400: "#5E79A3",
          500: "#14406E",
          600: "#0E3159",
          700: "#0B2447",
          800: "#0A1F3D",
          900: "#071A33",
          950: "#050F22",
        },
        gold: {
          light: "#F3D89A",
          DEFAULT: "#C1922B",
          dark: "#9E7620",
        },
        laurel: {
          light: "#E6F1EC",
          DEFAULT: "#1B6B4A",
          dark: "#14523A",
        },
      },
      fontFamily: {
        serif: ["Spectral", "Georgia", "serif"],
        sans: ["Inter", "Segoe UI", "sans-serif"],
      },
    },
  },
  plugins: [],
};
