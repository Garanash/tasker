/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg0: "#0A0A0A",
        card: "#111111",
        line: "#2A2A2A",
        text0: "#E0E0E0",
        text1: "#A0A0A0",
        accentA: "#8A2BE2",
        accentB: "#4B0082"
      },
      boxShadow: {
        tech: "0 10px 40px rgba(0,0,0,0.55)"
      }
    }
  },
  plugins: []
};

