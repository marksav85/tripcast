/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: 'var(--color-primary)', secondary: 'var(--color-secondary)',
        canvas: 'var(--color-canvas)', surface: 'var(--color-surface)',
        ink: 'var(--color-text)', muted: 'var(--color-text-muted)',
      },
      fontFamily: { heading: ['var(--font-heading)'], body: ['var(--font-body)'] },
      maxWidth: { page: 'var(--page-width)' },
      boxShadow: { surface: 'var(--shadow-surface)', floating: 'var(--shadow-floating)' },
      borderRadius: { card: 'var(--radius-card)', control: 'var(--radius-control)' },
      height: {
        "600px": "600px", // Custom height for card
        "400px": "400px", // Custom height for card
      },
    },
  },
  plugins: [],
};
