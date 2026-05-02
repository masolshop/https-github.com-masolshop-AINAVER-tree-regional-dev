/**
 * 컴포넌트 마운트 동안 <body>에 지정 클래스를 부착하고
 * 언마운트 시 제거하는 간단한 훅.
 *
 * 4대 솔루션 도구 페이지에서 본문 글씨 키우기 등 전역 스코프
 * 스타일을 안전하게 적용하기 위해 사용한다.
 */
import { useEffect } from 'react'

export function useBodyClass(className: string) {
  useEffect(() => {
    if (!className) return
    const tokens = className.split(/\s+/).filter(Boolean)
    tokens.forEach((t) => document.body.classList.add(t))
    return () => {
      tokens.forEach((t) => document.body.classList.remove(t))
    }
  }, [className])
}
