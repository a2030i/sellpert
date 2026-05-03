export const PLATFORM_MAP: Record<string, string> = {
  salla:     'سلة',
  noon:      'نون',
  amazon:    'أمازون',
  trendyol:  'تراندايول',
  zid:       'زد',
  shopify:   'شوبيفاي',
  other:     'أخرى',
  warehouse: 'مستودع',
  respondly: 'Respondly واتساب',
}

export const PLATFORM_COLORS: Record<string, string> = {
  salla:     '#00b894',  // أخضر سلة
  noon:      '#feee00',  // أصفر نون
  amazon:    '#146eb4',  // أزرق أمازون (الرسمي)
  trendyol:  '#f27a1a',  // برتقالي تراندايول
  zid:       '#7c6bff',
  shopify:   '#96bf48',
  other:     '#5a5a7a',
  warehouse: '#4cc9f0',
  respondly: '#25D366',
}

export const CHART_COLORS = [
  '#7c6bff', '#00e5b0', '#ff9900', '#f27a1a', '#ff6b6b', '#4cc9f0',
]

export const DATE_PRESETS = [
  { key: 'last7',      label: '٧ أيام'         },
  { key: 'last30',     label: '٣٠ يوم'         },
  { key: 'last90',     label: '٩٠ يوم'         },
  { key: 'thisMonth',  label: 'هذا الشهر'      },
  { key: 'lastMonth',  label: 'الشهر الماضي'   },
  { key: 'all',        label: 'الكل'           },
]
