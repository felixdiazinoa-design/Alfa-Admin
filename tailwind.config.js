/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Sora', 'Inter', 'system-ui', 'sans-serif'],
            },
            colors: {
                brand: '#00A7A0',
                'brand-hover': '#008C87',
                'brand-on-primary': '#061011',
                'brand-soft': '#DDF6F3',
                'brand-accent': '#B8E336',
                'brand-sidebar': '#132124',
                'brand-sidebar-deep': '#0B1618',
                'brand-background': '#F4F7F6',
                'brand-surface': '#FFFFFF',
                'brand-border': '#DDE6E4',
                'brand-text': '#172624',
                'brand-text-muted': '#60716E',
                indigo: {
                    50: '#F0FBFA', 100: '#DDF6F3', 200: '#B9EAE6', 300: '#7FD8D2',
                    400: '#35BDB6', 500: '#00A7A0', 600: '#008C87', 700: '#008C87',
                    800: '#0C5A57', 900: '#104A48', 950: '#062C2B',
                },
            }
        },
    },
    plugins: [],
}
