/**
 * 타지역키워드 DNA 솔루션 — 탭 공유 상수/유틸.
 */
import type { DnaCategory } from '@/api/keywordDna'

export const CATEGORIES: DnaCategory[] = ['main', 'action', 'material', 'place', 'brand', 'tag']

export const CAT_LABEL: Record<DnaCategory, string> = {
  main: '메인 키워드',
  action: '동작/서비스',
  material: '재료/원인',
  place: '장소/대상',
  brand: '브랜드',
  tag: '수식어/태그',
}

export const CAT_DESC: Record<DnaCategory, string> = {
  main: '핵심 명사 — 검색 시 가장 많이 노출되는 본 키워드',
  action: '뚫음·설치·수리·청소 등 행동 동명사 (네이버 봇이 매칭)',
  material: '변기·싱크대·도어락·폐기물 등 대상 자재/원인',
  place: '아파트·사무실·화장실 등 위치/대상 공간',
  brand: 'LG·삼성·린나이 등 제조사/브랜드',
  tag: '24시·전문·업체·당일 등 수식어/태그',
}

export const CAT_PILL: Record<DnaCategory, string> = {
  main: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  action: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  material: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  place: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  brand: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
  tag: 'bg-slate-50 text-slate-700 ring-1 ring-slate-200',
}

export const CAT_BAR: Record<DnaCategory, string> = {
  main: 'bg-blue-500',
  action: 'bg-emerald-500',
  material: 'bg-violet-500',
  place: 'bg-amber-500',
  brand: 'bg-rose-500',
  tag: 'bg-slate-400',
}

export const CAT_FILL: Record<DnaCategory, string> = {
  main: '#3b82f6',
  action: '#10b981',
  material: '#8b5cf6',
  place: '#f59e0b',
  brand: '#f43f5e',
  tag: '#94a3b8',
}

export const CAT_ICON: Record<DnaCategory, string> = {
  main: '🎯',
  action: '⚙️',
  material: '🧱',
  place: '📍',
  brand: '🏷️',
  tag: '✨',
}

export const SAMPLE_KEYWORDS = ['흥신소', '하수구', '누수', '보일러', '열쇠', '에어컨', '폐기물', '유품정리']

export function todayKstDate(): string {
  const d = new Date()
  const kst = new Date(d.getTime() + (9 * 60 + d.getTimezoneOffset()) * 60000)
  return kst.toISOString().slice(0, 10)
}

export function safeFilename(s: string): string {
  return (s || '').replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, '_').slice(0, 80)
}

export function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('ko-KR')
}

export function pctOf(n: number, base: number): number {
  if (!base) return 0
  return Math.min(100, Math.round((n / base) * 100))
}
