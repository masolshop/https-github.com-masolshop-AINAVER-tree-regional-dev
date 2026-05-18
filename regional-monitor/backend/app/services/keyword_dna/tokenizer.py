"""최장일치 토크나이저 (Aho-Corasick 대체 — 순수 파이썬 trie).

상호명을 6 카테고리 라벨이 붙은 토큰 리스트로 분해.
공백/쉼표/구분자가 없는 한글 상호에서도 동작.
"""
from __future__ import annotations

import re
from typing import Dict, List, Tuple

_BLOCK_RE = re.compile(r"[가-힣A-Za-z0-9]+")


class _TrieNode:
    __slots__ = ("children", "token")

    def __init__(self) -> None:
        self.children: Dict[str, "_TrieNode"] = {}
        self.token: str | None = None  # endpoint => token string


class LongestMatchTokenizer:
    """Trie 기반 최장 일치 토크나이저.

    >>> t = LongestMatchTokenizer({"하수구": ..., "막힘": ..., "변기": ...})
    >>> t.tokenize("하수구막힘변기뚫음")  # ['하수구', '막힘', '변기', '뚫음']
    """

    def __init__(self, dictionary_tokens: Dict[str, dict]) -> None:
        self.tokens = dictionary_tokens
        self.root = _TrieNode()
        for tok in dictionary_tokens:
            if not tok:
                continue
            node = self.root
            for ch in tok:
                node = node.children.setdefault(ch, _TrieNode())
            node.token = tok

    def tokenize(self, text: str) -> List[str]:
        """공백/구분자를 무시한 후 최장 일치로 토큰 추출."""
        if not text:
            return []
        out: List[str] = []
        for block in _BLOCK_RE.findall(text):
            i = 0
            while i < len(block):
                node = self.root
                j = i
                last_match: Tuple[int, str] | None = None
                while j < len(block) and block[j] in node.children:
                    node = node.children[block[j]]
                    j += 1
                    if node.token is not None:
                        last_match = (j, node.token)
                if last_match is not None:
                    out.append(last_match[1])
                    i = last_match[0]
                else:
                    i += 1
        return out

    def annotate(self, text: str) -> List[Tuple[str, str]]:
        """[(token, category), ...]"""
        return [(t, self.tokens[t]["category"]) for t in self.tokenize(text)]
