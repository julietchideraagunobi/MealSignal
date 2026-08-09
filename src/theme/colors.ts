export const COLORS = {
  // Brand Palette (Green Primary)
  primary: '#10B981', // Main Green Accent
  primaryDark: '#059669',
  
  // Traffic Light System
  safeAccent: '#10B981',   // Green
  safeBg: '#D1FAE5',
  cautionAccent: '#B45309', // Dark Amber/Yellow for readable text
  cautionBg: '#FEF3C7',
  dangerAccent: '#EF4444',  // Red
  dangerBg: '#FEE2E2',

  // Backgrounds & Surface
  background: '#F5F5F7',
  card: '#FFFFFF',
  
  // Text & Borders
  textPrimary: '#1C1C1E',
  textSecondary: '#3A3A3C',
  textMuted: '#8E8E93',
  border: '#E5E5EA',
  
  // Badges & Chips
  chipBg: '#E6F4EA',
  badgeBg: '#E5E5EA',
};

export type SeverityLevel = 'safe' | 'caution' | 'danger';

export const severityColors = (severity: SeverityLevel = 'caution') => {
  switch (severity) {
    case 'safe':
      return { text: COLORS.safeAccent, bg: COLORS.safeBg, border: COLORS.safeAccent };
    case 'danger':
      return { text: COLORS.dangerAccent, bg: COLORS.dangerBg, border: COLORS.dangerAccent };
    case 'caution':
    default:
      return { text: COLORS.cautionAccent, bg: COLORS.cautionBg, border: COLORS.cautionAccent };
  }
};