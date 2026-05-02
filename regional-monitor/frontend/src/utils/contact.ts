/**
 * 외부 상담/문의 채널 상수.
 * - 모든 무료 상담/신청/문의 CTA는 이 카카오톡 채팅 URL을 단일 진입점으로 사용한다.
 * - 변경이 필요할 경우 이 파일만 수정하면 사이트 전역에 반영된다.
 */
export const KAKAO_CHAT_URL = 'http://pf.kakao.com/_qemTX/chat'

/** 외부 링크 공통 속성 (새 탭 + 보안 옵션) */
export const EXTERNAL_LINK_PROPS = {
  target: '_blank',
  rel: 'noopener noreferrer',
} as const
