/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 페이지/표면
        bg: {
          DEFAULT: "#F4F6FA",   // 페이지 배경 (옅은 쿨 그레이)
          subtle: "#ECEFF4",    // 보조 카드 (연그레이)
          panel: "#FFFFFF",     // 화이트 카드
        },
        // 브랜드 블루
        brand: {
          50:  "#EEF2FB",
          100: "#DCE3F4",
          200: "#B6C2E5",
          300: "#8FA0D6",
          400: "#6883C7",
          500: "#536FC6",       // ★ 프라이머리 (CTA, 진행바)
          600: "#4F6FC5",
          700: "#3B559E",
          800: "#2F3F73",       // ★ 딥 네이비 (강조 다크 카드)
          900: "#22335B",
          950: "#1F2D4D",       // ★ 다크 텍스트
        },
        // 텍스트 시스템
        ink: {
          DEFAULT: "#1F2D4D",   // 진한 텍스트
          muted: "#6D7893",     // 미디엄 (서브 텍스트)
          soft: "#9BA5BD",
          watermark: "#C9D2E6", // 워터마크 번호 (01,02,03)
        },
        // 상태 색상
        status: {
          success: "#22C55E",
          warning: "#F59E0B",
          danger:  "#EF4444",
          info:    "#3B82F6",
        },
      },
      fontFamily: {
        // Pretendard 우선, 시스템 폰트 백업
        sans: [
          'Pretendard',
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          'Roboto',
          '"Helvetica Neue"',
          '"Apple SD Gothic Neo"',
          '"Noto Sans KR"',
          'sans-serif',
        ],
      },
      fontSize: {
        // 디자인 시스템 정의
        'hero':       ['44px', { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '800' }],
        'hero-sm':    ['36px', { lineHeight: '1.2',  letterSpacing: '-0.02em', fontWeight: '800' }],
        'h1':         ['28px', { lineHeight: '1.3',  letterSpacing: '-0.01em', fontWeight: '700' }],
        'h2':         ['22px', { lineHeight: '1.35', letterSpacing: '-0.01em', fontWeight: '700' }],
        'h3':         ['18px', { lineHeight: '1.4',  fontWeight: '600' }],
        'body':       ['14px', { lineHeight: '1.6',  fontWeight: '400' }],
        'body-sm':    ['13px', { lineHeight: '1.55', fontWeight: '400' }],
        'caption':    ['12px', { lineHeight: '1.5',  fontWeight: '400' }],
        'watermark':  ['56px', { lineHeight: '1',    fontWeight: '300' }],
      },
      borderRadius: {
        'card':    '24px',   // 카드 기본
        'card-lg': '28px',   // 큰 카드
        'pill':    '999px',
      },
      boxShadow: {
        'card':       '0 4px 24px rgba(20, 30, 60, 0.08)',
        'card-hover': '0 8px 32px rgba(20, 30, 60, 0.12)',
        'card-dark':  '0 8px 32px rgba(47, 63, 115, 0.25)',
      },
      spacing: {
        'card-sm': '24px',
        'card':    '32px',
        'card-lg': '40px',
      },
    },
  },
  plugins: [],
}
