/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'climate-darker': '#060810',
        'climate-dark': '#0a0e1a',
        'climate-accent': '#06b6d4',
        'climate-accent-bright': '#0891b2',
      },
    },
  },
  plugins: [],
};
